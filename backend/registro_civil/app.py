"""Servicio del Registro Civil SIMULADO: el telefono se enrola y recibe su cedula digital firmada.

Proceso aparte del sistema del recinto (otro puerto, otras claves): el recinto nunca tiene la clave
privada del emisor ni el padron con las fotos. La cedula es de la persona y sirve ante cualquier
lector autorizado.

Uso (desde backend/):  uv run uvicorn registro_civil.app:app --port 8001
El frontend lo alcanza en /registro-civil (proxy de Vite).
"""

import os
import pathlib
import time

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, StringConstraints

from app.config import settings
from app.credential import CredentialError, b64d, b64e
from app.hardening import MaxBodySizeMiddleware, SecurityHeadersMiddleware
from app.ratelimit import RateLimiter
from scripts.registro_civil_sim import (
    DEFAULT_DIR,
    enroll,
    report_loss,
    resolve_photo,
    revocation_list,
    verifier_public_key,
)

docs = settings.enable_api_docs
app = FastAPI(
    title="Registro Civil (simulado)",
    version="0.2.0",
    docs_url="/docs" if docs else None,
    redoc_url="/redoc" if docs else None,
    openapi_url="/openapi.json" if docs else None,
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(MaxBodySizeMiddleware, max_bytes=16_000)  # solo recibe RUT, clave y una clave publica

Rut = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
Clave = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]

# La clave de activacion es corta (simula la ClaveUnica): se limita la fuerza bruta. El mismo
# limite cubre enrolar y reportar perdida, que usan la misma clave.
enroll_rate_limiter = RateLimiter(max_calls=10, window_seconds=60, name="registro_civil_clave")


def registry_dir() -> pathlib.Path:
    # Se lee en cada solicitud para que los tests puedan apuntar a un padron propio.
    return pathlib.Path(os.environ.get("REGISTRO_CIVIL_DIR", str(DEFAULT_DIR)))


class EnrollIn(BaseModel):
    rut: Rut
    clave: Clave
    # Clave publica Ed25519 que el telefono acaba de crear: queda firmada dentro de la cedula.
    device_public_key: Annotated[str, StringConstraints(max_length=64)]


class EnrollOut(BaseModel):
    format: str
    core: str
    issuer_sig: str
    photo: str
    # Con esta clave el telefono cifra sus QR para que solo los lectores autorizados los lean.
    verifier_public_key: str
    server_time: int  # el telefono corrige su reloj con esto (el QR lleva la hora)


@app.post("/enrolar", response_model=EnrollOut, dependencies=[Depends(enroll_rate_limiter)])
def enrolar(payload: EnrollIn):
    try:
        device_public = b64d(payload.device_public_key, 32)
    except CredentialError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Clave del dispositivo inválida")
    credential = enroll(payload.rut, payload.clave, device_public, registry_dir())
    if credential is None:
        # Mismo mensaje para RUT inexistente o clave incorrecta: no revela quien esta en el padron.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="RUT o clave de activación inválidos")
    return {
        **credential.to_json(),
        "verifier_public_key": b64e(verifier_public_key(registry_dir())),
        "server_time": int(time.time()),
    }


class ReportLossIn(BaseModel):
    rut: Rut
    clave: Clave


@app.post("/reportar-perdida", dependencies=[Depends(enroll_rate_limiter)])
def reportar_perdida(payload: ReportLossIn):
    """"Perdi mi telefono": revoca la cedula activa (ADR-14). Se hace desde otro dispositivo con la
    misma clave de activacion (en la app real, con ClaveUnica)."""
    revoked = report_loss(payload.rut, payload.clave, registry_dir())
    if revoked is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="RUT o clave de activación inválidos")
    return {"revoked": revoked}


@app.get("/revocaciones")
def revocaciones():
    """Lista firmada de cedulas revocadas (hashes, sin datos personales). La consultan el backend del
    recinto, el escaner (para operar sin red) y el telefono (para saber si su cedula sigue activa)."""
    return revocation_list(registry_dir())


class PhotoIn(BaseModel):
    """El core firmado que el verificador ya leyo del QR, y su firma del emisor."""

    core: Annotated[str, StringConstraints(max_length=512)]
    issuer_sig: Annotated[str, StringConstraints(max_length=128)]


# Limite propio y mas estricto que el de enrolamiento: este endpoint entrega datos biometricos.
photo_rate_limiter = RateLimiter(max_calls=60, window_seconds=60, name="registro_civil_foto")


def foto_enabled() -> None:
    """Apagado (ENABLE_FOTO_RESUELTA sin activar) responde como una ruta que no existe. Se lee en cada
    solicitud para que los tests de ADR-17 puedan encenderlo sin reiniciar la aplicacion."""
    if not settings.enable_foto_resuelta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


@app.post("/foto", dependencies=[Depends(foto_enabled), Depends(photo_rate_limiter)])
def foto(payload: PhotoIn):
    """ARQUITECTURA ALTERNATIVA (ADR-17, modulo secundario). NO es el flujo principal y va APAGADA
    por defecto (ENABLE_FOTO_RESUELTA=1 para encenderla).

    Simula el caso en que el QR lleva solo el HASH de la foto y el verificador autorizado la pide
    al emisor. El flujo principal del prototipo no usa esto: ahi la foto viaja dentro del QR
    (ADR-10) y el escaner funciona sin red. Existe para poder contrastar las dos arquitecturas.

    La autorizacion es el propio core firmado: solo se obtiene una foto presentando un core con
    firma valida del emisor, que solo sale de haber leido un QR legitimo. Por eso NO se puede usar
    para enumerar rostros por RUT. Pero el backend del recinto recibe ese core firmado en cada
    /qr/validate y /qr/sync (y el escaner lo guarda en su cola sin red): encendido, el recinto
    podria pedir la foto de cada asistente, que es justo lo que ADR-10/11 evitan. Por eso apagado.
    """
    try:
        core = b64d(payload.core)
        issuer_sig = b64d(payload.issuer_sig, 64)
    except CredentialError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Core o firma inválidos")
    photo = resolve_photo(core, issuer_sig, registry_dir())
    if photo is None:
        # Respuesta uniforme: no distingue firma invalida de RUT no inscrito ni de hash que no calza,
        # para no filtrar quien esta en el padron.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No hay foto para esa cédula")
    return {"photo": b64e(photo)}


@app.get("/hora")
def hora():
    """Hora oficial para que el telefono corrija su reloj al abrir la cedula."""
    return {"server_time": int(time.time())}


@app.get("/health")
def health():
    return {"status": "ok"}
