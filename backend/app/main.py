from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import models
from .config import settings
from .database import Base, engine
from .hardening import MaxBodySizeMiddleware, SecurityHeadersMiddleware
from .routers import auth, bans, events, logs, metrics, qr, static_baseline, tickets, users

Base.metadata.create_all(bind=engine)

docs = settings.enable_api_docs
app = FastAPI(
    title="Control de Acceso Simple",
    version="0.2.0",
    docs_url="/docs" if docs else None,
    redoc_url="/redoc" if docs else None,
    openapi_url="/openapi.json" if docs else None,
)

# Orden: el ultimo agregado es el mas externo. El limite de tamano corta antes que todo; las
# cabeceras de seguridad van en toda respuesta, incluidos los errores de CORS y los 413.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Sesion con token Bearer en la cabecera, no con cookies: sin credenciales de navegador no hay CSRF.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(MaxBodySizeMiddleware, max_bytes=settings.max_request_bytes)


@app.exception_handler(OverflowError)
async def out_of_range(request: Request, exc: OverflowError) -> JSONResponse:
    # Un id de la URL mas grande que un entero de la base (p. ej. /events/99999999999999999999/...)
    # es un error del cliente, no del servidor.
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": "Parámetro fuera de rango"})


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(qr.router)
app.include_router(logs.router)
app.include_router(events.router)
app.include_router(tickets.router)
app.include_router(metrics.router)
app.include_router(bans.router)
if settings.enable_static_baseline:
    app.include_router(static_baseline.router)


@app.get("/health")
def health():
    return {"status": "ok"}
