import json
import os
import re
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FLAG = os.environ["FLAG"]
PORT = int(os.environ.get("PORT", "8000"))
STATIC = Path(__file__).resolve().parent / "static"
FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/cam-115a.webp": ("cam-115a.webp", "image/webp"),
}
GOAL = 1000
CATCHES = 3
COOLDOWN = 3


def view(presses):
    data = {"presses": presses, "goal": GOAL, "cooldown": COOLDOWN}
    if presses == 0:
        data["stage"] = "locked"
        data["lines"] = [
            "Кнопка заблокирована.",
            "Из паспорта пульта: блокировку ставит браузер оператора.",
        ]
    elif presses <= CATCHES:
        data["stage"] = "loose"
        data["lines"] = [
            "mr. S: осторожнее.",
            "Кнопка сорвалась с гнезда и уходит от курсора. Про клавиатуру в паспорте ничего нет.",
            f"Поймать ещё раз: {CATCHES - presses + 1}.",
        ]
    elif presses < GOAL:
        data["stage"] = "counter"
        data["lines"] = [
            "Кнопка встала в гнездо. Механический счётчик: 1000 нажатий.",
            f"Возврат пружины {COOLDOWN} с. Пружину считает браузер, счётчик хранит он же.",
        ]
    else:
        data["stage"] = "open"
        data["lines"] = [
            "mr. S: я же говорил, осторожнее.",
            "ДВЕРЬ СЕРВЕРНОЙ · ВТОРОЙ КОНТУР",
            "карта: допуск 003, третий уровень",
            "результат: ОТКАЗ",
            "Кнопка сработала. Дверь не открылась. Запись внесена в журнал.",
        ]
        data["flag"] = FLAG
    return data


def read_presses(header):
    try:
        morsel = SimpleCookie(header or "").get("presses")
    except CookieError:
        return 0
    if morsel is None or not re.fullmatch(r"\d{1,7}", morsel.value):
        return 0
    return int(morsel.value)


class Handler(BaseHTTPRequestHandler):
    server_version = "panel"
    sys_version = ""
    timeout = 10

    def log_message(self, *args):
        pass

    def send_body(self, body, ctype, presses=None):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if presses is not None:
            self.send_header("Set-Cookie", f"presses={presses}; Path=/; SameSite=Lax")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, presses, store=False):
        body = json.dumps(view(presses), ensure_ascii=False).encode("utf-8")
        self.send_body(body, "application/json; charset=utf-8", presses if store else None)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            self.send_json(read_presses(self.headers.get("Cookie")))
        elif path in FILES:
            name, ctype = FILES[path]
            self.send_body((STATIC / name).read_bytes(), ctype)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/press":
            self.send_error(404)
            return
        self.send_json(read_presses(self.headers.get("Cookie")) + 1, store=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
