import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    # Naive UTC: SQLite no persiste tzinfo, asi que todo el sistema trabaja
    # en UTC naive para evitar comparaciones offset-aware vs offset-naive.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Role(str, enum.Enum):
    # Solo personal del recinto. Los asistentes no son usuarios: se autentican con
    # RUT + codigo de su entrada (ver routers/tickets.py y ADR-7 en docs/architecture.md).
    ADMIN = "admin"
    GUARD = "guard"


class Lane(str, enum.Enum):
    FAST = "rapida"  # fila para asistentes que ya traen su QR dinamico
    NORMAL = "normal"  # fila tradicional (revision manual de entrada + carnet)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    document_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.GUARD)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    gates: Mapped[list["Gate"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="event", cascade="all, delete-orphan")


class Gate(Base):
    """Puerta o fila de ingreso. Permite medir throughput por fila (ver routers/metrics.py)."""

    __tablename__ = "gates"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(255))
    lane: Mapped[Lane] = mapped_column(Enum(Lane), default=Lane.FAST)

    event: Mapped["Event"] = relationship(back_populates="gates")


class Ticket(Base):
    """Entrada nominativa: liga un RUT a un evento. El codigo solo se guarda hasheado."""

    __tablename__ = "tickets"
    __table_args__ = (UniqueConstraint("event_id", "document_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    holder_name: Mapped[str] = mapped_column(String(255))
    document_id: Mapped[str] = mapped_column(String(20), index=True)  # RUT normalizado, ej. 12345678K
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Vinculo al dispositivo: el primer claim fija la sesion; otro dispositivo es rechazado (A8).
    claim_session: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Anti pass-back (A9): una vez que la persona ingreso, no puede volver a generar QR.
    admitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    event: Mapped["Event"] = relationship(back_populates="tickets")
    qr_tokens: Mapped[list["QRToken"]] = relationship(back_populates="ticket", cascade="all, delete-orphan")


class QRToken(Base):
    __tablename__ = "qr_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    ticket: Mapped["Ticket"] = relationship(back_populates="qr_tokens")


class AccessLog(Base):
    __tablename__ = "access_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    gate_id: Mapped[int | None] = mapped_column(ForeignKey("gates.id"), nullable=True)
    scanned_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    granted: Mapped[bool] = mapped_column(Boolean)
    reason: Mapped[str] = mapped_column(String(50))
    # Tiempo de procesamiento en el servidor; base de las metricas de throughput por fila.
    latency_ms: Mapped[float] = mapped_column(default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    ticket: Mapped["Ticket"] = relationship()
    gate: Mapped["Gate"] = relationship()
    scanned_by: Mapped["User"] = relationship(foreign_keys=[scanned_by_id])


class BannedPerson(Base):
    """Prohibicion de ingreso (p. ej. hincha sancionado o derecho de admision). Se aplica por RUT,
    asi que es tan fuerte como el vinculo entre la credencial presentada y la persona real."""

    __tablename__ = "banned_persons"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # RUT normalizado
    reason: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def is_banned(db, document_id: str) -> bool:
    return db.query(BannedPerson.id).filter(BannedPerson.document_id == document_id).first() is not None
