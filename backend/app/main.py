from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import Base, engine
from .routers import auth, logs, qr, users

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Control de Acceso Simple", version="0.1.0")

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


@app.get("/health")
def health():
    return {"status": "ok"}
