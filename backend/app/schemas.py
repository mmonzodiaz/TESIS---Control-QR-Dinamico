from datetime import datetime

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


class AttendeeOut(BaseModel):
    ticket_id: int
    holder_name: str
    rut_masked: str
    event: EventOut
    admitted_at: datetime | None


class TicketClaimOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    attendee: AttendeeOut


# --- QR ------------------------------------------------------------------------


class QRGenerateOut(BaseModel):
    token: str
    expires_at: datetime
    ttl_seconds: int


class QRValidateIn(BaseModel):
    token: str
    gate_id: int | None = None


class QRValidateOut(BaseModel):
    granted: bool
    reason: str
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
