from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from .models import Role


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    document_id: str | None = None
    role: Role = Role.RESIDENT


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


class QRGenerateOut(BaseModel):
    token: str
    expires_at: datetime
    ttl_seconds: int


class QRValidateIn(BaseModel):
    token: str


class QRValidateOut(BaseModel):
    granted: bool
    reason: str
    user: UserOut | None = None


class AccessLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    token_id: str | None
    granted: bool
    reason: str
    created_at: datetime
    user: UserOut | None = None
    scanned_by: UserOut | None = None
