import pathlib

from fastapi import HTTPException, status

from .config import settings
from .credential import CredentialError, b64d


def issuer_public_key() -> bytes:
    """Clave publica del Registro Civil. Se relee en cada uso: es un archivo de 44 bytes y asi
    rotarla no exige reiniciar el servidor."""
    path = pathlib.Path(settings.issuer_public_key_file)
    try:
        return b64d(path.read_text().strip(), 32)
    except (OSError, CredentialError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Falta la clave publica del Registro Civil ({path}). Corre: uv run python scripts/registro_civil_sim.py init",
        )
