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

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel

from app.credential import CredentialError, b64d, b64e
from app.ratelimit import RateLimiter
from scripts.registro_civil_sim import DEFAULT_DIR, enroll, report_loss, revocation_list, verifier_public_key

app = FastAPI(title="Registro Civil (simulado)", version="0.2.0")

# La clave de activacion es corta (simula la ClaveUnica): se limita la fuerza bruta. El mismo
# limite cubre enrolar y reportar perdida, que usan la misma clave.
enroll_rate_limiter = RateLimiter(max_calls=10, window_seconds=60)


def registry_dir() -> pathlib.Path:
    # Se lee en cada solicitud para que los tests puedan apuntar a un padron propio.
    return pathlib.Path(os.environ.get("REGISTRO_CIVIL_DIR", str(DEFAULT_DIR)))


class EnrollIn(BaseModel):
    rut: str
    clave: str
    # Clave publica Ed25519 que el telefono acaba de crear: queda firmada dentro de la cedula.
    device_public_key: str


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
    rut: str
    clave: str


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


@app.get("/hora")
def hora():
    """Hora oficial para que el telefono corrija su reloj al abrir la cedula."""
    return {"server_time": int(time.time())}


@app.get("/health")
def health():
    return {"status": "ok"}
