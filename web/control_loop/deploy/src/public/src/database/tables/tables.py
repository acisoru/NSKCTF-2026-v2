from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.configurations.config import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    hash_password: Mapped[str] = mapped_column(String(256))


class AnomalyCard(Base):
    __tablename__ = "anomaly_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    anomaly_number: Mapped[int] = mapped_column(Integer)
    log_date: Mapped[str] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(String(1024))
    source_url: Mapped[str] = mapped_column(String(512), nullable=True)
    preview: Mapped[str] = mapped_column(Text, nullable=True)


class RegistryEntry(Base):
    __tablename__ = "registry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(64))
    clearance: Mapped[str] = mapped_column(String(8))
    operator: Mapped[str] = mapped_column(String(64))
    note: Mapped[str] = mapped_column(Text)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    code: Mapped[str] = mapped_column(String(16))
    topic: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[str] = mapped_column(String(32))


class SystemState(Base):
    __tablename__ = "system_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    last_update_check: Mapped[str] = mapped_column(String(32), nullable=True)
    update_check_count: Mapped[int] = mapped_column(Integer, default=0)
    last_selftest: Mapped[str] = mapped_column(String(32), nullable=True)
    selftest_count: Mapped[int] = mapped_column(Integer, default=0)
