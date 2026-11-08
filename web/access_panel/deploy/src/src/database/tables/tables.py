from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.configurations.config import Base


class Badge(Base):
    __tablename__ = "badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    clearance: Mapped[str] = mapped_column(String(8))


class AccessLog(Base):
    __tablename__ = "access_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    log_date: Mapped[str] = mapped_column(String(16))
    username: Mapped[str] = mapped_column(String(64))
    room: Mapped[str] = mapped_column(String(32))
    device: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password: Mapped[str] = mapped_column(String(128))
    note: Mapped[str] = mapped_column(String(256))
