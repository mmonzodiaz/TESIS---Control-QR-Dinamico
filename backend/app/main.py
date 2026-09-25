from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import Base, engine
from .config import settings
from .routers import auth, bans, events, logs, metrics, qr, static_baseline, tickets, users

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Control de Acceso Simple", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
