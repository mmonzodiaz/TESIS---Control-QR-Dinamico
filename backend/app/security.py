import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Sin 0/O/1/I para que el codigo impreso en la entrada no se confunda al tipearlo.
TICKET_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TICKET_CODE_LENGTH = 8  # 32^8 ~ 1.1e12 combinaciones (~40 bits)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def generate_ticket_code() -> str:
    return "".join(secrets.choice(TICKET_CODE_ALPHABET) for _ in range(TICKET_CODE_LENGTH))


def normalize_ticket_code(code: str) -> str:
    return code.replace("-", "").replace(" ", "").strip().upper()


def hash_ticket_code(code: str) -> str:
    # SHA-256 sin sal basta: el codigo es aleatorio de alta entropia (no una contrasena
    # elegida por humanos) y el hash determinista permite buscarlo por indice.
    return hashlib.sha256(normalize_ticket_code(code).encode()).hexdigest()


def new_claim_session() -> str:
    return secrets.token_urlsafe(32)


def create_access_token(subject: str, extra: dict | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": subject, "exp": expire, **(extra or {})}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token_payload(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def decode_access_token(token: str) -> str | None:
    payload = decode_token_payload(token)
    return payload.get("sub") if payload else None
