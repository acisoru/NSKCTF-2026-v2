from dataclasses import dataclass
import math
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def load_environment() -> None:
    path = ROOT / "deploy" / ".env"
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


load_environment()


@dataclass(frozen=True)
class Settings:
    database_url: str
    secret: bytes
    flag: str
    session_hours: int
    secure_cookie: bool
    submit_interval: float
    regenerate_interval: float


def read_settings() -> Settings:
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("Задайте DATABASE_URL для PostgreSQL")
    secret_value = os.environ.get("SESSION_SECRET", "")
    if len(secret_value) < 32:
        raise RuntimeError("SESSION_SECRET должен содержать не менее 32 символов")
    flag = os.environ.get("FLAG", "")
    if not flag.startswith("nskctf{") or not flag.endswith("}") or not 9 <= len(flag) <= 512:
        raise RuntimeError("Задайте непустой FLAG в формате nskctf{...}")
    intervals = [float(os.environ.get(name, default)) for name, default in (
        ("SUBMIT_INTERVAL", "1.5"), ("REGENERATE_INTERVAL", "30"),
    )]
    if any(not math.isfinite(value) or value < 0 for value in intervals):
        raise RuntimeError("Интервалы должны быть конечными неотрицательными числами")
    return Settings(
        database_url=database_url,
        secret=secret_value.encode(),
        flag=flag,
        session_hours=max(1, min(720, int(os.environ.get("SESSION_HOURS", "48")))),
        secure_cookie=os.environ.get("COOKIE_SECURE", "false").lower() in {"true", "1", "yes"},
        submit_interval=intervals[0],
        regenerate_interval=intervals[1],
    )
