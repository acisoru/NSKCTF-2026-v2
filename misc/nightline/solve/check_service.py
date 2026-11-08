from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
from http.cookies import SimpleCookie
import io
import json
import os
import secrets
import time
import unittest
from urllib.parse import urlsplit
from uuid import uuid4

from PIL import Image

from app.config import read_settings
from app.puzzle import generate
from app.store import Store


class Client:
    def __init__(self):
        self.base = urlsplit(os.environ.get("NIGHTLINE_URL", "http://127.0.0.1:8000"))
        self.token = ""
        self.session = None

    def request(self, method, path, data=None, headers=None):
        headers = dict(headers or {})
        if self.token:
            headers.setdefault("Cookie", f"nightline_session={self.token}")
        if isinstance(data, dict):
            headers.setdefault("Content-Type", "application/json")
            data = json.dumps(data).encode()
        factory = http.client.HTTPSConnection if self.base.scheme == "https" else http.client.HTTPConnection
        connection = factory(self.base.hostname, self.base.port, timeout=60)
        try:
            connection.request(method, self.base.path + path, body=data, headers=headers)
            response = connection.getresponse()
            body = response.read()
            result_headers = {name.lower(): value for name, value in response.getheaders()}
            if "set-cookie" in result_headers:
                cookie = SimpleCookie(result_headers["set-cookie"])
                if "nightline_session" in cookie:
                    self.token = cookie["nightline_session"].value
            if "application/json" in result_headers.get("content-type", ""):
                body = json.loads(body)
            return response.status, result_headers, body
        finally:
            connection.close()

    def create(self):
        status, headers, data = self.request("POST", "/api/session", {})
        if status != 200:
            raise RuntimeError(f"Создание сессии: {status}, {data}")
        self.session = data
        return headers

    def submit(self, route, request_id=None, **overrides):
        data = {"puzzle_id": self.session["puzzle_id"], "request_id": request_id or str(uuid4()), "route": route}
        data.update(overrides)
        return self.request("POST", "/api/submit", data, {"X-CSRF-Token": self.session["csrf_token"]})


class ApiChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.settings = read_settings()
        cls.store = Store(cls.settings.database_url, cls.settings.session_hours)
        cls.store.open()

    @classmethod
    def tearDownClass(cls):
        cls.store.close()

    def setUp(self):
        self.clients = []
        self.client = self.new_client()

    def tearDown(self):
        with self.store.connection() as connection:
            for client in self.clients:
                connection.execute("DELETE FROM sessions WHERE token_hash = %s", (self.store.token_hash(client.token),))

    def new_client(self):
        client = Client()
        client.create()
        self.clients.append(client)
        return client

    def puzzle(self, client=None):
        client = client or self.client
        return generate(self.store.session(client.token)["seed"])

    def make_ready(self, client=None):
        client = client or self.client
        with self.store.connection() as connection:
            connection.execute(
                "UPDATE sessions SET city_created_at = %s, last_submit = 0 WHERE token_hash = %s",
                (time.time() - self.settings.regenerate_interval - 1, self.store.token_hash(client.token)),
            )

    def test_health_static_and_headers(self):
        for path in ("/healthz", "/", "/static/app.js", "/static/style.css", "/static/favicon.svg", "/static/fonts/golos-text.woff2"):
            with self.subTest(path=path):
                status, headers, body = self.client.request("GET", path)
                self.assertEqual(status, 200)
                self.assertEqual(headers["x-content-type-options"], "nosniff")
                self.assertEqual(headers["x-frame-options"], "DENY")
                self.assertIn("default-src 'self'", headers["content-security-policy"])
                if path == "/":
                    self.assertIn(b"NIGHTLINE", body)
                    self.assertNotIn(self.settings.flag.encode(), body)
                    self.assertNotIn(b"MISC", body)
                    self.assertIn(b"/static/fonts/golos-text.woff2", body)
                if path.endswith(".woff2"):
                    self.assertTrue(body.startswith(b"wOF2"))
                    self.assertEqual(headers["content-type"], "font/woff2")

    def test_session_restore_and_cookie(self):
        status, headers, restored = self.client.request("POST", "/api/session", {})
        self.assertEqual(status, 200)
        for key, value in self.client.session.items():
            if key not in {"regenerate_after", "submit_after"}:
                self.assertEqual(restored[key], value)
        self.assertLessEqual(restored["regenerate_after"], self.client.session["regenerate_after"])
        self.assertNotIn("set-cookie", headers)
        self.assertEqual(restored["node_count"], 20)
        self.assertEqual(restored["max_commands"], 128)
        self.assertIsNone(restored["flag"])
        for key in ("seed", "red", "blue", "reference", "positions", "token_hash"):
            self.assertNotIn(key, restored)
        fresh = Client()
        cookie_headers = fresh.create()
        self.clients.append(fresh)
        cookie = cookie_headers["set-cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=strict", cookie)
        self.assertEqual("secure" in cookie.lower(), self.settings.secure_cookie)
        with self.store.connection() as connection:
            row = connection.execute("SELECT * FROM sessions WHERE puzzle_id = %s", (fresh.session["puzzle_id"],)).fetchone()
        self.assertEqual(row["token_hash"], hashlib.sha256(fresh.token.encode()).hexdigest())
        self.assertNotIn(fresh.token, row.values())

    def test_maps_layers_caching_and_isolation(self):
        layers = []
        for layer in ("all", "red", "blue"):
            path = f"/api/map/{self.client.session['puzzle_id']}/{layer}.png"
            status, headers, body = self.client.request("GET", path)
            self.assertEqual(status, 200)
            self.assertEqual(headers["content-type"], "image/png")
            self.assertTrue(headers["cache-control"].startswith("private"))
            with Image.open(io.BytesIO(body)) as image:
                self.assertEqual(image.size, (2048, 1536))
                self.assertFalse(image.info)
            layers.append(body)
            status, _, _ = self.client.request("GET", path, headers={"If-None-Match": headers["etag"]})
            self.assertEqual(status, 304)
            status, download_headers, download = self.client.request("GET", path + "?download=true")
            self.assertEqual(status, 200)
            self.assertIn("attachment", download_headers["content-disposition"])
            self.assertEqual(body, download)
        self.assertEqual(len(set(layers)), 3)
        stranger = self.new_client()
        status, _, _ = stranger.request("GET", self.client.session["map_url"])
        self.assertEqual(status, 404)
        status, _, _ = self.client.request("GET", f"/api/map/{self.client.session['puzzle_id']}/invalid.png")
        self.assertEqual(status, 404)

    def test_wrong_route_no_oracle(self):
        status, _, result = self.client.submit("R")
        self.assertEqual(status, 200)
        self.assertFalse(result["accepted"])
        self.assertIsNone(result["flag"])
        self.assertEqual(result["attempt"], 1)
        self.assertEqual(set(result), {"accepted", "attempt", "length", "message", "flag", "request_id", "created_at", "submit_after"})

    def test_valid_solution_and_persisted_flag(self):
        puzzle = self.puzzle()
        route = " \n".join(puzzle.reference.lower()) + "\t"
        status, _, result = self.client.submit(route)
        self.assertEqual(status, 200)
        self.assertTrue(result["accepted"])
        self.assertEqual(result["flag"], self.settings.flag)
        self.assertEqual(result["length"], len(puzzle.reference))
        status, _, restored = self.client.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertTrue(restored["solved"])
        self.assertEqual(restored["flag"], self.settings.flag)
        self.assertTrue(restored["history"][0]["accepted"])

    def test_all_commands_execute_and_nonshortest_is_accepted(self):
        puzzle = self.puzzle()
        self.assertFalse(puzzle.accepts(puzzle.reference + "R"))
        status, _, result = self.client.submit(puzzle.reference + "R")
        self.assertEqual(status, 200)
        self.assertFalse(result["accepted"])
        self.make_ready()
        route = "R" * (128 - len(puzzle.reference)) + puzzle.reference
        status, _, result = self.client.submit(route)
        self.assertEqual(status, 200)
        self.assertTrue(result["accepted"])
        self.assertEqual(result["length"], 128)

    def test_idempotency_and_conflict(self):
        request_id = str(uuid4())
        first = self.client.submit("R", request_id)
        second = self.client.submit(" r \n", request_id)
        self.assertEqual(first[0], 200)
        self.assertEqual(first[2], second[2])
        status, _, _ = self.client.submit("B", request_id)
        self.assertEqual(status, 409)
        self.assertEqual(self.store.session(self.client.token)["attempts"], 1)

    def test_concurrent_same_request(self):
        request_id = str(uuid4())
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.client.submit("R", request_id), range(8)))
        self.assertEqual([result[0] for result in results], [200] * 8)
        self.assertTrue(all(result[2] == results[0][2] for result in results))
        self.assertEqual(self.store.session(self.client.token)["attempts"], 1)

    def test_concurrent_distinct_requests(self):
        if self.settings.submit_interval == 0:
            self.skipTest("SUBMIT_INTERVAL=0")
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.client.submit("R"), range(8)))
        self.assertEqual(sum(result[0] == 200 for result in results), 1)
        self.assertEqual(sum(result[0] == 429 for result in results), 7)
        self.assertEqual(self.store.session(self.client.token)["attempts"], 1)

    def test_submit_rate_limit(self):
        if self.settings.submit_interval == 0:
            self.skipTest("SUBMIT_INTERVAL=0")
        self.assertEqual(self.client.submit("R")[0], 200)
        status, headers, _ = self.client.submit("B")
        self.assertEqual(status, 429)
        self.assertGreaterEqual(int(headers["retry-after"]), 1)
        self.assertEqual(self.store.session(self.client.token)["attempts"], 1)

    def test_validation_and_body_limit(self):
        for route in ("", " \t\r\n", "RX", "R" * 129, "R" * 4097):
            with self.subTest(length=len(route)):
                self.assertEqual(self.client.submit(route)[0], 422)
        self.assertEqual(self.client.submit("R", request_id="invalid")[0], 422)
        self.assertEqual(self.client.submit("R", extra="forbidden")[0], 422)
        status, _, _ = self.client.request("POST", "/api/submit", b"{" * 17000)
        self.assertEqual(status, 413)
        status, _, _ = self.client.request("POST", "/api/submit", b"{broken")
        self.assertEqual(status, 422)
        self.assertEqual(self.store.session(self.client.token)["attempts"], 0)

    def test_auth_csrf_and_origin(self):
        anonymous = Client()
        self.assertEqual(anonymous.request("GET", "/api/session")[0], 401)
        self.assertEqual(anonymous.request("GET", self.client.session["map_url"])[0], 401)
        payload = {"puzzle_id": self.client.session["puzzle_id"], "request_id": str(uuid4()), "route": "R"}
        for headers in ({}, {"X-CSRF-Token": "wrong"}, {"X-CSRF-Token": self.client.session["csrf_token"], "Origin": "https://example.invalid"}):
            self.assertEqual(self.client.request("POST", "/api/submit", payload, headers)[0], 403)
        self.assertEqual(self.client.request("POST", "/api/session", {}, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        stranger = self.new_client()
        self.assertEqual(self.client.request("POST", "/api/submit", payload, {"X-CSRF-Token": stranger.session["csrf_token"]})[0], 403)

    def test_private_paths_and_openapi(self):
        for path in ("/.env", "/app/main.py", "/src/app/puzzle.py", "/solve/manage.py", "/static/../config.py", "/static/%2e%2e/config.py", "/docs", "/redoc", "/openapi.json"):
            with self.subTest(path=path):
                self.assertEqual(self.client.request("GET", path)[0], 404)

    def test_new_city_resets_and_invalidates_old_map(self):
        old = self.client.session
        self.assertTrue(self.client.submit(self.puzzle().reference)[2]["accepted"])
        self.make_ready()
        status, _, city = self.client.request("POST", "/api/city/new", {"puzzle_id": old["puzzle_id"]}, {"X-CSRF-Token": old["csrf_token"]})
        self.assertEqual(status, 200)
        self.assertNotEqual(city["puzzle_id"], old["puzzle_id"])
        self.assertNotEqual(city["csrf_token"], old["csrf_token"])
        self.assertEqual(city["attempts"], 0)
        self.assertEqual(city["history"], [])
        self.assertFalse(city["solved"])
        self.assertIsNone(city["flag"])
        self.assertEqual(self.client.request("GET", old["map_url"])[0], 404)
        self.assertEqual(self.client.submit("R")[0], 403)
        self.client.session = city
        self.assertEqual(self.client.submit("R", puzzle_id=old["puzzle_id"])[0], 409)

    def test_new_city_rate_limit(self):
        if self.settings.regenerate_interval == 0:
            self.skipTest("REGENERATE_INTERVAL=0")
        status, headers, _ = self.client.request("POST", "/api/city/new", {"puzzle_id": self.client.session["puzzle_id"]}, {"X-CSRF-Token": self.client.session["csrf_token"]})
        self.assertEqual(status, 429)
        self.assertGreater(int(headers["retry-after"]), 0)

    def test_concurrent_city_replacement(self):
        self.make_ready()
        old = self.client.session
        def replace(_):
            return self.client.request("POST", "/api/city/new", {"puzzle_id": old["puzzle_id"]}, {"X-CSRF-Token": old["csrf_token"]})
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(replace, range(4)))
        self.assertEqual(sum(result[0] == 200 for result in results), 1)
        self.assertTrue(all(result[0] in (200, 403, 409) for result in results))

    def test_expiry_and_expired_submission_cleanup(self):
        self.client.submit("R")
        with self.store.connection() as connection:
            connection.execute("UPDATE sessions SET expires_at = %s WHERE token_hash = %s", (time.time() - 1, self.store.token_hash(self.client.token)))
        self.assertEqual(self.client.request("GET", "/api/session")[0], 401)
        self.assertTrue(self.store.reserve_creation("nightline-expiry-" + secrets.token_hex(8)))
        with self.store.connection() as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM submissions WHERE token_hash = %s", (self.store.token_hash(self.client.token),)).fetchone()
        self.assertEqual(row["count"], 0)

    def test_creation_limit(self):
        address = "nightline-test-" + secrets.token_hex(8)
        address_hash = hashlib.sha256(address.encode()).hexdigest()
        try:
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: self.store.reserve_creation(address), range(128)))
            self.assertEqual(sum(results), 120)
            with self.store.connection() as connection:
                row = connection.execute("SELECT count FROM creation_limits WHERE address_hash = %s", (address_hash,)).fetchone()
            self.assertEqual(row["count"], 120)
        finally:
            with self.store.connection() as connection:
                connection.execute("DELETE FROM creation_limits WHERE address_hash = %s", (address_hash,))

    def test_history_retention(self):
        for _ in range(105):
            self.make_ready()
            self.assertEqual(self.client.submit("R")[0], 200)
        status, _, session = self.client.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(session["attempts"], 105)
        self.assertEqual([entry["attempt"] for entry in session["history"]], list(range(105, 97, -1)))
        with self.store.connection() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM submissions WHERE token_hash = %s", (self.store.token_hash(self.client.token),),
            ).fetchone()
        self.assertEqual(row["count"], 100)

    def test_store_rollback_and_reconnect(self):
        before = self.store.session(self.client.token)["attempts"]
        with self.assertRaises(RuntimeError):
            with self.store.connection() as connection:
                connection.execute("UPDATE sessions SET attempts = attempts + 1 WHERE token_hash = %s", (self.store.token_hash(self.client.token),))
                raise RuntimeError("rollback")
        self.assertEqual(self.store.session(self.client.token)["attempts"], before)
        fresh = Store(self.settings.database_url, self.settings.session_hours)
        fresh.open()
        try:
            self.assertEqual(fresh.session(self.client.token)["puzzle_id"], self.client.session["puzzle_id"])
        finally:
            fresh.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
