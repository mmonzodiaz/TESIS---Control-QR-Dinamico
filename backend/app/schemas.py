from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import Lane, Role


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    document_id: str | None = None
    role: Role = Role.GUARD


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    full_name: str | None = None
    document_id: str | None = None
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = None


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# --- Eventos, puertas y entradas -------------------------------------------------


class EventCreate(BaseModel):
    name: str = Field(min_length=1)
    starts_at: datetime | None = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    starts_at: datetime | None
    created_at: datetime


class GateCreate(BaseModel):
    name: str = Field(min_length=1)
    lane: Lane = Lane.FAST


class GateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    name: str
    lane: Lane


class TicketCreate(BaseModel):
    holder_name: str = Field(min_length=1)
    rut: str


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    holder_name: str
    document_id: str
    claimed_at: datetime | None
    admitted_at: datetime | None
    created_at: datetime


class TicketCreatedOut(TicketOut):
    # El codigo en claro solo viaja en esta respuesta; en la base queda hasheado.
    code: str


class TicketClaimIn(BaseModel):
    rut: str
    code: str
    # Clave publica Ed25519 que el telefono acaba de crear (base64, 32 bytes).
    device_public_key: str
    # Credencial del Registro Civil importada en el telefono, SIN la foto: el core trae el hash
    # de la foto, asi que la firma del emisor se verifica sin que la foto salga del telefono.
    credential_core: str
    issuer_sig: str


class AttendeeOut(BaseModel):
    ticket_id: int
    holder_name: str
    rut_masked: str
    event: EventOut
    admitted_at: datetime | None


class QRParamsOut(BaseModel):
    """Lo que el telefono necesita para generar QR sin conexion."""

    event_id: int
    ticket_id: int
    event_public_key: str  # X25519, base64: cifra el QR para el escaner del evento
    ttl_seconds: int
    server_time: int  # unix; el telefono corrige su reloj con esto


class TicketSessionOut(BaseModel):
    attendee: AttendeeOut
    qr: QRParamsOut


class TicketClaimOut(TicketSessionOut):
    access_token: str
    token_type: str = "bearer"


# --- QR ------------------------------------------------------------------------


class VerifierOut(BaseModel):
    """Material del escaner del personal para verificar QR localmente (incluso sin red)."""

    event_id: int
    event_private_key: str  # X25519, base64: descifra los QR de este evento
    issuer_public_key: str  # Ed25519 del Registro Civil, base64
    ttl_seconds: int
    clock_skew_seconds: int
    server_time: int


class QRValidateIn(BaseModel):
    """Consulta en linea del escaner, despues de verificar localmente. No incluye la foto.

    `action` (ADR-12): "check" verifica sin registrar el ingreso; el guardia compara la foto y luego
    manda "admit" (coincide: registra el ingreso) o "reject" (no coincide: se rechaza sin consumir
    la entrada del titular). "admit" sin "check" previo hace ambos pasos de una vez.
    """

    action: Literal["check", "admit", "reject"] = "admit"
    gate_id: int | None = None
    ticket_id: int
    nonce: str = Field(pattern=r"^[0-9a-f]{32}$")
    issued_at: int
    device_sig: str
    credential_core: str
    issuer_sig: str


class QRValidateOut(BaseModel):
    granted: bool
    reason: str
    # True cuando "check" aprobo todo: falta que el guardia confirme la foto.
    pending: bool = False
    attendee: AttendeeOut | None = None
    latency_ms: float | None = None


class AccessLogOut(BaseModel):
    id: int
    token_id: str | None
    granted: bool
    reason: str
    latency_ms: float
    created_at: datetime
    holder_name: str | None = None
    rut_masked: str | None = None
    gate: GateOut | None = None
    scanned_by: UserOut | None = None


# --- Metricas ------------------------------------------------------------------


class GateMetrics(BaseModel):
    gate_id: int | None
    gate_name: str
    lane: Lane | None
    scans: int
    granted: int
    rejected_by_reason: dict[str, int]
    scans_per_minute: float | None
    latency_p50_ms: float | None
    latency_p95_ms: float | None


class EventMetrics(BaseModel):
    event_id: int
    tickets_total: int
    tickets_claimed: int
    tickets_admitted: int
    gates: list[GateMetrics]


# --- Prohibiciones de ingreso -----------------------------------------------------


class BanCreate(BaseModel):
    rut: str
    reason: str = Field(min_length=1)


class BanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    document_id: str
    reason: str
    created_at: datetime
