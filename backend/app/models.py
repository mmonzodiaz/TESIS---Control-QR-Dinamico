import calendar
import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .credential import b64d, b64e, new_secret_key, x25519_public
from .database import Base


def utcnow() -> datetime:
    # Naive UTC: SQLite no persiste tzinfo, asi que todo el sistema trabaja
    # en UTC naive para evitar comparaciones offset-aware vs offset-naive.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def unix_now() -> int:
    # El QR viaja con hora unix (lo fecha el telefono); se deriva de utcnow() para que los
    # experimentos que controlan el reloj (scripts/attack_experiment.py) lo controlen tambien.
    return calendar.timegm(utcnow().timetuple())


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


def new_event_qr_key() -> str:
    return b64e(new_secret_key())


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Clave X25519 del evento: el telefono cifra el QR con la publica y solo el escaner del
    # personal (que recibe la privada, GET /events/{id}/verifier) puede leer foto, nombre y RUT.
    qr_private_key: Mapped[str] = mapped_column(String(64), default=new_event_qr_key)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def qr_public_key(self) -> str:
        return b64e(x25519_public(b64d(self.qr_private_key)))

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
    # Clave publica Ed25519 del telefono: verifica la firma de cada QR que genera sin conexion.
    device_public_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Anti pass-back (A9): una vez que la persona ingreso, ningun QR de esta entrada vuelve a servir.
    admitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    event: Mapped["Event"] = relationship(back_populates="tickets")
    qr_uses: Mapped[list["QRUse"]] = relationship(cascade="all, delete-orphan")


class QRUse(Base):
    """Nonce de un QR ya presentado. El QR lo genera el telefono sin conexion, asi que el servidor
    no guarda los QR emitidos: solo los usados. La clave primaria hace atomico el uso unico (ADR-8)."""

    __tablename__ = "qr_uses"

    nonce: Mapped[str] = mapped_column(String(32), primary_key=True)  # hex
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AccessLog(Base):
    __tablename__ = "access_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # nonce del QR (hex)
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
