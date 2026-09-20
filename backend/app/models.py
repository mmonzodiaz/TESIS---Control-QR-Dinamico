import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    # Naive UTC: SQLite no persiste tzinfo, asi que todo el sistema trabaja
    # en UTC naive para evitar comparaciones offset-aware vs offset-naive.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Role(str, enum.Enum):
    ADMIN = "admin"
    GUARD = "guard"
    RESIDENT = "resident"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    document_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.RESIDENT)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    qr_tokens: Mapped[list["QRToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class QRToken(Base):
    __tablename__ = "qr_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="qr_tokens")


class AccessLog(Base):
    __tablename__ = "access_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    scanned_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    granted: Mapped[bool] = mapped_column(Boolean)
    reason: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    scanned_by: Mapped["User"] = relationship(foreign_keys=[scanned_by_id])
