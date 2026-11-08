#!/usr/bin/env python3
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading

from .runtime import DEFAULT_VM, WEB_ROOT, solve

MAX_REQUEST = 65536


def make_server(address, *, vm=DEFAULT_VM):
    slots = threading.BoundedSemaphore(8)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def send_json(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self.send_json(200, {"status": "ok"})
                return
            routes = {
                "/": (WEB_ROOT / "index.html", "text/html; charset=utf-8"),
                "/app.js": (WEB_ROOT / "app.js", "text/javascript; charset=utf-8"),
                "/style.css": (WEB_ROOT / "style.css", "text/css; charset=utf-8"),
                "/fonts/jetbrains-mono-regular.ttf": (
                    WEB_ROOT / "fonts/jetbrains-mono-regular.ttf",
                    "font/ttf",
                ),
                "/fonts/jetbrains-mono-semibold.ttf": (
                    WEB_ROOT / "fonts/jetbrains-mono-semibold.ttf",
                    "font/ttf",
                ),
                "/scores/bass.abc": (
                    WEB_ROOT / "scores/bass.abc",
                    "text/plain; charset=utf-8",
                ),
                "/scores/rhythm.abc": (
                    WEB_ROOT / "scores/rhythm.abc",
                    "text/plain; charset=utf-8",
                ),
                "/download/lead-part-tester": (Path(vm), "application/octet-stream"),
            }
            if self.path not in routes:
                return self.send_json(404, {"error": "not found"})
            path, mime = routes[self.path]
            try:
                body = path.read_bytes()
            except OSError:
                return self.send_json(404, {"error": "not found"})
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            if self.path == "/download/lead-part-tester":
                self.send_header(
                    "Content-Disposition", 'attachment; filename="lead-part-tester"'
                )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; object-src 'none'; base-uri 'none'",
            )
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != "/solve":
                return self.send_json(404, {"error": "not found"})
            if not slots.acquire(blocking=False):
                return self.send_json(503, {"error": "busy"})
            try:
                try:
                    raw_length = self.headers.get("Content-Length", "")
                    if not raw_length.isdecimal() or len(raw_length) > 7:
                        raise ValueError("Content-Length required")
                    length = int(raw_length)
                    if not 0 < length <= MAX_REQUEST or self.headers.get(
                        "Transfer-Encoding"
                    ):
                        raise ValueError("request size or encoding")
                    raw = self.rfile.read(length)
                    if len(raw) != length:
                        raise ValueError("incomplete request")
                    data = json.loads(raw)
                    if (
                        not isinstance(data, dict)
                        or set(data) != {"melody", "bass", "rhythm"}
                        or any(not isinstance(v, str) for v in data.values())
                    ):
                        raise ValueError("provide melody, bass, rhythm ABC strings")
                    flag = solve(data["melody"], data["bass"], data["rhythm"], vm=vm)
                except (ValueError, UnicodeDecodeError, TimeoutError) as error:
                    return self.send_json(400, {"error": str(error)})
                self.send_json(200, {"flag": flag})
            finally:
                slots.release()

    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--vm", type=Path, default=DEFAULT_VM)
    args = parser.parse_args()
    make_server((args.host, args.port), vm=args.vm).serve_forever()
