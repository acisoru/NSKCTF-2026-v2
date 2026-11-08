from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import logging
import math
import mimetypes
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers, MutableHeaders

from .config import read_settings
from .puzzle import MAP_HEIGHT, MAP_WIDTH, MAX_COMMANDS, NODE_COUNT, generate
from .render import render_map
from .store import Store


settings = read_settings()
store = Store(settings.database_url, settings.session_hours)
static = Path(__file__).parent / "static"
mimetypes.add_type("font/woff2", ".woff2")
logger = logging.getLogger("nightline")
expensive_slots = threading.BoundedSemaphore(4)
COOKIE_NAME = "nightline_session"


class BoundaryMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)

        async def secure_send(message):
            if message["type"] == "http.response.start":
                outgoing = MutableHeaders(scope=message)
                outgoing["X-Content-Type-Options"] = "nosniff"
                outgoing["Referrer-Policy"] = "same-origin"
                outgoing["X-Frame-Options"] = "DENY"
                outgoing["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
                outgoing["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
                if "cache-control" not in outgoing:
                    outgoing["Cache-Control"] = "no-store"
            await send(message)

        if scope["method"] == "POST":
            origin = headers.get("origin")
            try:
                same_origin = not origin or urlsplit(origin).netloc.lower() == headers.get("host", "").lower()
            except ValueError:
                same_origin = False
            if headers.get("sec-fetch-site") == "cross-site" or not same_origin:
                await JSONResponse({"detail": "Запрос должен быть отправлен с сайта задачи"}, status_code=403)(scope, receive, secure_send)
                return
            data = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                data.extend(message.get("body", b""))
                if len(data) > 16384:
                    await JSONResponse({"detail": "Слишком большой запрос"}, status_code=413)(scope, receive, secure_send)
                    return
                if not message.get("more_body", False):
                    break
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(data), "more_body": False}
                return await receive()

            await self.app(scope, replay, secure_send)
            return
        await self.app(scope, receive, secure_send)


@asynccontextmanager
async def lifespan(application):
    await run_in_threadpool(store.open)
    try:
        yield
    finally:
        await run_in_threadpool(store.close)


app = FastAPI(title="NIGHTLINE", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(BoundaryMiddleware)


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    puzzle_id: str = Field(pattern=r"^[a-f0-9]{24}$")
    request_id: UUID
    route: str = Field(min_length=1, max_length=4096)


class NewCity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    puzzle_id: str = Field(pattern=r"^[a-f0-9]{24}$")


@app.exception_handler(RequestValidationError)
def invalid_request(request: Request, exception: RequestValidationError):
    return JSONResponse({"detail": "Проверь формат запроса и длину маршрута"}, status_code=422)


@app.exception_handler(Exception)
def unexpected_error(request: Request, exception: Exception):
    logger.error("Внутренняя ошибка сервиса", exc_info=(type(exception), exception, exception.__traceback__))
    return JSONResponse({"detail": "Не удалось обработать запрос. Попробуй ещё раз"}, status_code=500)


@contextmanager
def expensive_operation():
    acquired = expensive_slots.acquire(timeout=15)
    if not acquired:
        raise HTTPException(503, "Городская сеть занята. Попробуй через несколько секунд", headers={"Retry-After": "5"})
    try:
        yield
    finally:
        expensive_slots.release()


def player(request: Request) -> tuple[str, dict]:
    token = request.cookies.get(COOKIE_NAME)
    session = store.session(token)
    if session is None:
        raise HTTPException(401, "Сессия истекла. Перезагрузи страницу, чтобы получить новый город")
    return token, session


def csrf_token(token: str, puzzle_id: str) -> str:
    return hmac.new(settings.secret, f"{token}:{puzzle_id}".encode(), hashlib.sha256).hexdigest()


def protect(request: Request, token: str, session: dict) -> None:
    provided = request.headers.get("x-csrf-token", "")
    if not re.fullmatch(r"[a-f0-9]{64}", provided) or not hmac.compare_digest(provided, csrf_token(token, session["puzzle_id"])):
        raise HTTPException(403, "Сессия изменилась. Обнови страницу перед отправкой маршрута")


def public_session(token: str, session: dict) -> dict:
    with expensive_operation():
        puzzle = generate(session["seed"])
    return {
        "puzzle_id": session["puzzle_id"],
        "csrf_token": csrf_token(token, session["puzzle_id"]),
        "district": puzzle.district,
        "node_count": NODE_COUNT,
        "target_label": f"{puzzle.target + 1:02}",
        "max_commands": MAX_COMMANDS,
        "map_width": MAP_WIDTH,
        "map_height": MAP_HEIGHT,
        "map_url": f"/api/map/{session['puzzle_id']}/all.png",
        "attempts": session["attempts"],
        "solved": session["solved_at"] is not None,
        "flag": settings.flag if session["solved_at"] is not None else None,
        "expires_at": datetime.fromtimestamp(session["expires_at"], timezone.utc).isoformat(),
        "session_hours": settings.session_hours,
        "submit_after": max(0, settings.submit_interval - (time.time() - session["last_submit"])),
        "regenerate_after": max(0, settings.regenerate_interval - (time.time() - session["city_created_at"])),
        "history": store.history(session["token_hash"], session["puzzle_id"]),
    }


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(static / "index.html", media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/healthz", include_in_schema=False)
def health():
    with store.connection() as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "ok"}


@app.post("/api/session", include_in_schema=False)
def create_session(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    session = store.session(token)
    if session is None:
        address = request.client.host if request.client else "unknown"
        if not store.reserve_creation(address):
            raise HTTPException(429, "Слишком много новых подключений. Попробуй через минуту", headers={"Retry-After": "60"})
        token = secrets.token_hex(32)
        seed = secrets.token_hex(24)
        with expensive_operation():
            generate(seed)
        session = store.create(token, seed)
        response.set_cookie(
            COOKIE_NAME, token, max_age=settings.session_hours * 3600, httponly=True,
            secure=settings.secure_cookie, samesite="strict", path="/",
        )
    response.headers["Cache-Control"] = "no-store"
    return public_session(token, session)


@app.get("/api/session", include_in_schema=False)
def resume_session(request: Request):
    token, session = player(request)
    return public_session(token, session)


@app.get("/api/map/{puzzle_id}/{layer}.png", include_in_schema=False)
def map_image(puzzle_id: str, layer: str, request: Request, download: bool = False):
    token, session = player(request)
    if puzzle_id != session["puzzle_id"] or layer not in {"all", "red", "blue"}:
        raise HTTPException(404, "Карта не найдена")
    with expensive_operation():
        data = render_map(session["seed"], layer)
    etag = '"' + hashlib.sha256(data).hexdigest() + '"'
    headers = {"Cache-Control": "private, max-age=600", "ETag": etag}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="nightline-{puzzle_id[:8]}-{layer}.png"'
    if request.headers.get("if-none-match") == etag and not download:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type="image/png", headers=headers)


@app.post("/api/city/new", include_in_schema=False)
def new_city(payload: NewCity, request: Request):
    token, session = player(request)
    protect(request, token, session)
    if payload.puzzle_id != session["puzzle_id"]:
        raise HTTPException(409, "В другой вкладке уже открыт новый город. Обнови страницу")
    wait = settings.regenerate_interval - (time.time() - session["city_created_at"])
    if wait > 0:
        raise HTTPException(429, "Новый город будет доступен чуть позже", headers={"Retry-After": str(math.ceil(wait))})
    seed = secrets.token_hex(24)
    with expensive_operation():
        generate(seed)
    result = store.replace_city(token, seed, settings.regenerate_interval, payload.puzzle_id)
    if result is None:
        raise HTTPException(401, "Сессия истекла")
    if result == "conflict":
        raise HTTPException(409, "В другой вкладке уже открыт новый город. Обнови страницу")
    if isinstance(result, float):
        raise HTTPException(429, "Подожди перед созданием нового города", headers={"Retry-After": str(math.ceil(result))})
    return public_session(token, result)


@app.post("/api/submit", include_in_schema=False)
def submit(payload: Submission, request: Request):
    token, session = player(request)
    protect(request, token, session)
    route = re.sub(r"[ \t\r\n]", "", payload.route).upper()
    if not route or len(route) > MAX_COMMANDS or any(command not in "RB" for command in route):
        raise HTTPException(422, f"Маршрут должен содержать от 1 до {MAX_COMMANDS} команд R и B. Пробелы и переносы строк разрешены")
    if payload.puzzle_id != session["puzzle_id"]:
        raise HTTPException(409, "Карта изменилась. Обнови страницу перед отправкой")
    with expensive_operation():
        puzzle = generate(session["seed"])
    route_hash = hashlib.sha256(route.encode()).hexdigest()
    request_id = str(payload.request_id)
    with store.connection() as connection:
        current = connection.execute(
            "SELECT * FROM sessions WHERE token_hash = %s FOR UPDATE", (session["token_hash"],)
        ).fetchone()
        now = time.time()
        if not current or current["expires_at"] <= now:
            raise HTTPException(401, "Сессия истекла")
        if current["puzzle_id"] != payload.puzzle_id:
            raise HTTPException(409, "Карта изменилась в другой вкладке")
        existing = connection.execute(
            "SELECT * FROM submissions WHERE token_hash = %s AND request_id = %s", (session["token_hash"], payload.request_id)
        ).fetchone()
        if existing:
            if existing["route_hash"] != route_hash or existing["puzzle_id"] != payload.puzzle_id:
                raise HTTPException(409, "Этот идентификатор уже использован для другого маршрута")
            return existing["response"]
        wait = settings.submit_interval - (now - current["last_submit"])
        if wait > 0:
            raise HTTPException(429, "Дождись ответа диспетчерской перед новой попыткой", headers={"Retry-After": str(math.ceil(wait))})
        accepted = puzzle.accepts(route)
        result = {
            "accepted": accepted,
            "attempt": current["attempts"] + 1,
            "length": len(route),
            "message": "Все курьеры вернулись на склад. Операция завершена" if accepted else "Маршрут не привёл всех курьеров на склад. Проверь направления и попробуй ещё раз",
            "flag": settings.flag if accepted else None,
            "request_id": request_id,
            "created_at": now,
            "submit_after": settings.submit_interval,
        }
        connection.execute(
            "UPDATE sessions SET attempts = attempts + 1, last_submit = %s, solved_at = CASE WHEN %s THEN COALESCE(solved_at, %s) ELSE solved_at END WHERE token_hash = %s",
            (now, accepted, now, session["token_hash"]),
        )
        connection.execute(
            "INSERT INTO submissions VALUES (%s, %s, %s, %s, %s, %s)",
            (session["token_hash"], payload.request_id, payload.puzzle_id, route_hash, Jsonb(result), now),
        )
        connection.execute(
            "DELETE FROM submissions WHERE token_hash = %s AND request_id NOT IN (SELECT request_id FROM submissions WHERE token_hash = %s ORDER BY created_at DESC LIMIT 100)",
            (session["token_hash"], session["token_hash"]),
        )
    return result


app.mount("/static", StaticFiles(directory=static), name="static")
