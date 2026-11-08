from contextlib import contextmanager
import hashlib
import secrets
import time
from typing import Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


class Store:
    def __init__(self, database_url: str, session_hours: int):
        self.lifetime = session_hours * 3600
        self.pool = ConnectionPool(
            database_url,
            min_size=1,
            max_size=12,
            timeout=10,
            open=False,
            kwargs={
                "row_factory": dict_row,
                "connect_timeout": 5,
                "options": "-c statement_timeout=15000 -c lock_timeout=10000",
                "application_name": "nightline",
            },
        )

    def open(self) -> None:
        self.pool.open(wait=True, timeout=30)
        with self.connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(72519001)")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    puzzle_id TEXT NOT NULL UNIQUE,
                    seed TEXT NOT NULL,
                    created_at DOUBLE PRECISION NOT NULL,
                    expires_at DOUBLE PRECISION NOT NULL,
                    city_created_at DOUBLE PRECISION NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
                    solved_at DOUBLE PRECISION,
                    last_submit DOUBLE PRECISION NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS submissions (
                    token_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
                    request_id UUID NOT NULL,
                    puzzle_id TEXT NOT NULL,
                    route_hash TEXT NOT NULL,
                    response JSONB NOT NULL,
                    created_at DOUBLE PRECISION NOT NULL,
                    PRIMARY KEY (token_hash, request_id)
                );
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                CREATE INDEX IF NOT EXISTS submissions_history ON submissions(token_hash, created_at DESC);
                CREATE TABLE IF NOT EXISTS creation_limits (
                    address_hash TEXT PRIMARY KEY,
                    started_at DOUBLE PRECISION NOT NULL,
                    count INTEGER NOT NULL
                );
            """)

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        with self.pool.connection() as connection:
            yield connection

    @staticmethod
    def token_hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def session(self, token: str | None) -> dict | None:
        if token is None or len(token) != 64:
            return None
        with self.connection() as connection:
            return connection.execute(
                "SELECT * FROM sessions WHERE token_hash = %s AND expires_at > %s",
                (self.token_hash(token), time.time()),
            ).fetchone()

    def reserve_creation(self, address: str) -> bool:
        address_hash = hashlib.sha256(address.encode()).hexdigest()
        with self.connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(72519002)")
            now = time.time()
            connection.execute("DELETE FROM sessions WHERE expires_at <= %s", (now,))
            connection.execute("DELETE FROM creation_limits WHERE started_at < %s", (now - 600,))
            count = connection.execute("SELECT COUNT(*) AS count FROM sessions").fetchone()["count"]
            row = connection.execute("SELECT * FROM creation_limits WHERE address_hash = %s", (address_hash,)).fetchone()
            if count >= 10000 or (row and row["started_at"] > now - 60 and row["count"] >= 120):
                return False
            if row and row["started_at"] > now - 60:
                connection.execute("UPDATE creation_limits SET count = count + 1 WHERE address_hash = %s", (address_hash,))
            else:
                connection.execute(
                    "INSERT INTO creation_limits VALUES (%s, %s, 1) "
                    "ON CONFLICT (address_hash) DO UPDATE SET started_at = EXCLUDED.started_at, count = 1",
                    (address_hash, now),
                )
        return True

    def create(self, token: str, seed: str) -> dict:
        now = time.time()
        with self.connection() as connection:
            return connection.execute(
                "INSERT INTO sessions (token_hash, puzzle_id, seed, created_at, expires_at, city_created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
                (self.token_hash(token), secrets.token_hex(12), seed, now, now + self.lifetime, now),
            ).fetchone()

    def replace_city(self, token: str, seed: str, interval: float, expected_id: str) -> dict | float | str | None:
        token_hash = self.token_hash(token)
        with self.connection() as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE token_hash = %s FOR UPDATE", (token_hash,),
            ).fetchone()
            now = time.time()
            if not row or row["expires_at"] <= now:
                return None
            if row["puzzle_id"] != expected_id:
                return "conflict"
            wait = interval - (now - row["city_created_at"])
            if wait > 0:
                return wait
            connection.execute("DELETE FROM submissions WHERE token_hash = %s", (token_hash,))
            return connection.execute(
                "UPDATE sessions SET puzzle_id = %s, seed = %s, city_created_at = %s, "
                "attempts = 0, solved_at = NULL, last_submit = 0 WHERE token_hash = %s RETURNING *",
                (secrets.token_hex(12), seed, now, token_hash),
            ).fetchone()

    def history(self, token_hash: str, puzzle_id: str) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT response, created_at FROM submissions WHERE token_hash = %s AND puzzle_id = %s "
                "ORDER BY created_at DESC LIMIT 8", (token_hash, puzzle_id),
            ).fetchall()
        return [
            {"attempt": row["response"]["attempt"], "accepted": row["response"]["accepted"],
             "length": row["response"]["length"], "created_at": row["created_at"]}
            for row in rows
        ]
