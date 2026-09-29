import logging
import pathlib

from fastapi import HTTPException, status

from .config import settings
from .credential import CredentialError, b64d

log = logging.getLogger(__name__)

# El detalle (ruta del archivo, como arreglarlo) va al log del servidor, no al cliente: una respuesta
# HTTP no debe revelar la estructura de directorios (OWASP ASVS V7.4).
_UNAVAILABLE = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="El servicio de verificación no está configurado. Avisa al administrador.",
)


def _read_key(path: pathlib.Path, what: str) -> bytes:
    try:
        return b64d(path.read_text().strip(), 32)
    except (OSError, CredentialError):
        log.error("Falta %s (%s). Corre: uv run python scripts/registro_civil_sim.py init", what, path)
        raise _UNAVAILABLE


def issuer_public_key() -> bytes:
    """Clave publica del Registro Civil. Se relee en cada uso: es un archivo de 44 bytes y asi
    rotarla no exige reiniciar el servidor."""
    return _read_key(pathlib.Path(settings.issuer_public_key_file), "la clave pública del Registro Civil")


def verifier_private_key() -> bytes:
    """Clave privada de lectores autorizados (X25519): la entrega el Registro Civil a quienes
    verifican cedulas. Permite leer los QR (foto, nombre, RUT), no fabricarlos."""
    return _read_key(pathlib.Path(settings.verifier_private_key_file), "la clave de lectores autorizados")
