from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase


class Base(AsyncAttrs, DeclarativeBase):
    pass


@dataclass
class DBConfig:
    base: Base
    db_url: str


@dataclass
class JWTConfig:
    jwt_key: str
    algorithm: str
    expire: int


@dataclass
class Config:
    db: DBConfig
    jwt_conf: JWTConfig
    app_port: int
    flag: str
