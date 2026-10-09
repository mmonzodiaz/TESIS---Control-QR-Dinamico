"""Contrasenas del personal y tokens de sesion (OWASP ASVS V2 y V3).

- Contrasenas: Argon2id (primera opcion de OWASP Password Storage Cheat Sheet). Los hashes bcrypt
  creados antes se siguen aceptando y se reemplazan por Argon2id en el siguiente login correcto.
- Tokens: JWT HS256 con PyJWT, algoritmo fijo al verificar (sin "none" ni confusion de algoritmos),
  claims exp/iat/nbf/iss/aud/jti y `ver` (version de sesion del usuario): cambiar la contrasena,
  desactivar o cambiar el rol sube la version e invalida los tokens ya emitidos.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import settings

# Parametros por defecto de argon2-cffi (RFC 9106, perfil de baja memoria: t=3, m=64 MiB, p=4).
_hasher = PasswordHasher()

JWT_ISSUER = "control-acceso"
JWT_AUDIENCE = "control-acceso-personal"

# Se verifica contra este hash cuando el email no existe, para que el login tarde lo mismo exista o
# no la cuenta (evita enumerar usuarios por tiempo de respuesta).
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    if hashed.startswith("$argon2"):
        try:
            return _hasher.verify(hashed, plain)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    if hashed.startswith("$2"):  # bcrypt heredado (passlib)
        encoded = plain.encode("utf-8")
        if len(encoded) > 72:  # bcrypt ignora (o rechaza) lo que pase de 72 bytes
            return False
        try:
            return bcrypt.checkpw(encoded, hashed.encode("ascii"))
        except ValueError:
            return False
    return False


def spend_verify_time(plain: str) -> None:
    """Mismo costo que una verificacion real, para cuentas inexistentes."""
    verify_password(plain, _DUMMY_HASH)


def needs_rehash(hashed: str) -> bool:
    return not hashed.startswith("$argon2") or _hasher.check_needs_rehash(hashed)


def create_access_token(subject: str, session_version: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "ver": session_version,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> tuple[str, int] | None:
    """(email, version de sesion) si el token es autentico y vigente; None si no."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={"require": ["exp", "iat", "sub", "ver", "iss", "aud"]},
            leeway=5,
        )
    except jwt.InvalidTokenError:
        return None
    subject, version = payload.get("sub"), payload.get("ver")
    if not isinstance(subject, str) or not isinstance(version, int):
        return None
    return subject, version


def _contingency_key() -> bytes:
    # Derivada del secreto del servidor, separada por dominio de la firma de los JWT.
    return hashlib.sha256(b"control-acceso/contingencia|" + settings.jwt_secret.encode("utf-8")).digest()


def contingency_seal(event_id: int, generated_at: int) -> str:
    """Sello de la copia de contingencia (ADR-15). Con el, el servidor reconoce despues que entrego esa
    copia, para ese evento y a esa hora: es lo que acota la hora de escaneo que declara el escaner sin
    red. Cambiar JWT_SECRET invalida los sellos de las decisiones aun no sincronizadas."""
    return hmac.new(_contingency_key(), f"{event_id}:{generated_at}".encode("ascii"), hashlib.sha256).hexdigest()


def valid_contingency_seal(event_id: int, generated_at: int, seal: str) -> bool:
    return hmac.compare_digest(contingency_seal(event_id, generated_at), seal)
