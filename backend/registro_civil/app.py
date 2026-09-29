"""Servicio del Registro Civil SIMULADO: el telefono se enrola y recibe su cedula digital firmada.

Proceso aparte del backend del evento (otro puerto, otras claves): el backend del evento nunca
tiene la clave privada del emisor ni el padron con las fotos.

Uso (desde backend/):  uv run uvicorn registro_civil.app:app --port 8001
El frontend lo alcanza en /registro-civil (proxy de Vite).
"""

import os
import pathlib

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel

from app.ratelimit import RateLimiter
from scripts.registro_civil_sim import DEFAULT_DIR, enroll

app = FastAPI(title="Registro Civil (simulado)", version="0.1.0")

# La clave de activacion es corta (simula la ClaveUnica): se limita la fuerza bruta.
enroll_rate_limiter = RateLimiter(max_calls=10, window_seconds=60)


def registry_dir() -> pathlib.Path:
    # Se lee en cada solicitud para que los tests puedan apuntar a un padron propio.
    return pathlib.Path(os.environ.get("REGISTRO_CIVIL_DIR", str(DEFAULT_DIR)))


class EnrollIn(BaseModel):
    rut: str
    clave: str


class CredentialOut(BaseModel):
    format: str
    core: str
    issuer_sig: str
    photo: str


@app.post("/enrolar", response_model=CredentialOut, dependencies=[Depends(enroll_rate_limiter)])
def enrolar(payload: EnrollIn):
    credential = enroll(payload.rut, payload.clave, registry_dir())
    if credential is None:
        # Mismo mensaje para RUT inexistente o clave incorrecta: no revela quien esta en el padron.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="RUT o clave de activacion invalidos")
    return credential.to_json()


@app.get("/health")
def health():
    return {"status": "ok"}
