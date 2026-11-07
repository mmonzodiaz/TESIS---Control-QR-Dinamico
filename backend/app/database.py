from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


def normalize_database_url(url: str) -> str:
    """Railway (y casi todo proveedor) entrega postgres:// o postgresql://. Sin driver explicito,
    SQLAlchemy usaria psycopg2, que no se instala: se fija psycopg (version 3)."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


DATABASE_URL = normalize_database_url(settings.database_url)
IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # Los endpoints son sincronos y corren en el pool de hilos de FastAPI (40 hilos): con el pool por
    # defecto (5 + 10) una punta de muchas filas a la vez esperaria conexion. pre_ping descarta las
    # conexiones que el servidor cerro mientras estaban inactivas.
    engine = create_engine(
        DATABASE_URL,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
    )
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def insert_or_ignore(model):
    """INSERT ... ON CONFLICT DO NOTHING del motor en uso. Es lo que hace atomico el uso unico (ADR-8):
    con varias filas a la vez, solo una insercion del nonce tiene efecto, en SQLite y en PostgreSQL."""
    return (sqlite.insert if IS_SQLITE else postgresql.insert)(model)


class Base(DeclarativeBase):
    pass


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
