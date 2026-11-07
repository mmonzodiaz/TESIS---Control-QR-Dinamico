import calendar
import enum
import secrets
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.types import TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    # Naive UTC: SQLite no persiste tzinfo, asi que todo el sistema trabaja
    # en UTC naive para evitar comparaciones offset-aware vs offset-naive.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UTCDateTime(TypeDecorator):
    """Fecha en UTC naive para el codigo, en SQLite y en PostgreSQL. PostgreSQL guarda TIMESTAMPTZ y
    devuelve fechas con zona; sin esto, restarlas de utcnow() falla, y una fecha naive se guardaria
    en la zona horaria de la sesion. En SQLite no cambia nada: ni el esquema ni lo que se guarda."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None and dialect.name == "postgresql":
            value = value.replace(tzinfo=timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


def new_session_version() -> int:
    # El token se identifica por email + version; el email se puede volver a usar y los id de SQLite
    # tambien (sin AUTOINCREMENT), asi que lo unico que distingue a la cuenta nueva es esta version.
    return secrets.randbelow(2**31)


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
    DIGITAL = "digital"  # fila para portadores de cedula digital (preferente mientras sean pocos)
    NORMAL = "normal"  # fila tradicional (revision manual de entrada + carnet)


class User(Base):
    __tablename__ = "users"
    # AUTOINCREMENT: un id borrado no se reutiliza. AccessLog guarda estos id y SQLite no aplica las
    # claves foraneas; sin esto, el historial de una entrada o un usuario borrado pasaba a la
    # siguiente que se creara (auditoria del 2026-10-09).
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    document_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.GUARD)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Va en cada token (claim "ver"). Subirla invalida todas las sesiones abiertas del usuario:
    # cambio de contrasena, de rol o desactivacion (app/security.py). Parte aleatoria y no en 0:
    # si se borra una cuenta y se crea otra con el mismo email, los tokens de la anterior no calzan.
    session_version: Mapped[int] = mapped_column(Integer, default=new_session_version, server_default="0")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = {"sqlite_autoincrement": True}  # ver User

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    starts_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    gates: Mapped[list["Gate"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="event", cascade="all, delete-orphan")


class Gate(Base):
    """Puerta o fila de ingreso. Permite medir throughput por fila (ver routers/metrics.py)."""

    __tablename__ = "gates"
    __table_args__ = {"sqlite_autoincrement": True}  # ver User

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(255))
    lane: Mapped[Lane] = mapped_column(Enum(Lane), default=Lane.DIGITAL)

    event: Mapped["Event"] = relationship(back_populates="gates")


class Ticket(Base):
    """Entrada nominativa: ese RUT puede entrar a ese evento. En la puerta se coteja con el RUT
    firmado de la cedula digital (no hay activacion ni codigo en el telefono)."""

    __tablename__ = "tickets"
    __table_args__ = (UniqueConstraint("event_id", "document_id"), {"sqlite_autoincrement": True})  # ver User

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    holder_name: Mapped[str] = mapped_column(String(255))
    document_id: Mapped[str] = mapped_column(String(20), index=True)  # RUT normalizado, ej. 12345678K
    # Anti pass-back (A9): una vez que la persona ingreso, ningun QR suyo vuelve a servir en este evento.
    admitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    event: Mapped["Event"] = relationship(back_populates="tickets")
    qr_uses: Mapped[list["QRUse"]] = relationship(cascade="all, delete-orphan")


class QRUse(Base):
    """Nonce de un QR ya presentado. El QR lo genera el telefono sin conexion, asi que el servidor
    no guarda los QR emitidos: solo los usados. La clave primaria hace atomico el uso unico (ADR-8)."""

    __tablename__ = "qr_uses"

    nonce: Mapped[str] = mapped_column(String(32), primary_key=True)  # hex
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True)
    used_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class QRCheck(Base):
    """QR verificado por el escaner pero aun sin decision del guardia (paso 1 de 2). Permite que la
    confirmacion llegue despues de la vigencia del QR: el guardia necesita unos segundos para
    comparar la foto con la persona."""

    __tablename__ = "qr_checks"

    nonce: Mapped[str] = mapped_column(String(32), primary_key=True)  # hex
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class OfflineSync(Base):
    """Decision sin conexion ya sincronizada (ADR-15). La clave primaria hace atomica la
    sincronizacion, igual que QRUse con el uso unico: si dos /qr/sync con el mismo QR llegan a la vez
    (dos pestanas del escaner que comparten la cola, un reenvio con otro envio en vuelo), solo uno
    registra el ingreso y el otro devuelve lo mismo. Es una tabla aparte, y no un indice unico sobre
    access_logs, para que una base vieja la reciba con create_all sin migracion."""

    __tablename__ = "offline_syncs"

    nonce: Mapped[str] = mapped_column(String(32), primary_key=True)  # hex
    synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class BiometricConsent(Base):
    """Evidencia de que la persona consintio la comparacion facial de ese ingreso (ADR-16). La ley pone
    en el responsable la carga de probar el consentimiento (docs/ley-21719.md §4). No es un dato
    biometrico: no hay imagen, vector ni puntaje. Se liga al escaneo por el nonce (AccessLog.token_id).
    Es una tabla aparte, y no una columna de access_logs, para que una base vieja la reciba con
    create_all sin migracion."""

    __tablename__ = "biometric_consents"

    nonce: Mapped[str] = mapped_column(String(32), primary_key=True)  # hex
    gate_id: Mapped[int | None] = mapped_column(ForeignKey("gates.id"), nullable=True)
    recorded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class AccessLog(Base):
    __tablename__ = "access_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # nonce del QR (hex)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True)
    # RUT de la cedula (si sus firmas eran validas), aunque no tenga entrada: sirve para auditar.
    document_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gate_id: Mapped[int | None] = mapped_column(ForeignKey("gates.id"), nullable=True)
    scanned_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted: Mapped[bool] = mapped_column(Boolean)
    reason: Mapped[str] = mapped_column(String(50))
    # Tiempo de procesamiento en el servidor; base de las metricas de throughput por fila.
    latency_ms: Mapped[float] = mapped_column(default=0.0)
    # Decidido por el guardia sin conexion y sincronizado despues (ADR-15). created_at es la hora del
    # escaneo, no la de la sincronizacion.
    offline: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

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
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


def is_banned(db, document_id: str) -> bool:
    return db.query(BannedPerson.id).filter(BannedPerson.document_id == document_id).first() is not None
