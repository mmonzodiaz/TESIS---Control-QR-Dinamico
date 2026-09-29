from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./control_acceso.db"
    # Sin valor por defecto a proposito: si falta en .env/entorno, el arranque debe fallar
    # ruidosamente en vez de servir con un secreto de ejemplo conocido publicamente.
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    # 45s: derivado en docs/ttl-justification.md (piso de usabilidad vs. techo de
    # exposicion a replay-por-captura). No es un valor arbitrario.
    qr_ttl_seconds: int = 45
    # Tolerancia a relojes desfasados: el QR lo fecha el telefono, no el servidor. El telefono
    # corrige su reloj con server_time al activar la entrada; esto cubre el desfase que quede.
    qr_clock_skew_seconds: int = 5
    # Tiempo que tiene el guardia para confirmar la foto despues del "check" (ADR-12), aunque el QR
    # venza mientras tanto. Solo aplica a QR que pasaron el "check" dentro de su vigencia.
    qr_confirm_window_seconds: int = 60
    # Clave publica del Registro Civil (simulado: scripts/registro_civil_sim.py init). El backend
    # del evento nunca tiene la clave privada del emisor.
    issuer_public_key_file: str = "registro_civil_sim/issuer_public.key"
    # Linea base para experimentos (scripts/attack_experiment.py): emula el QR estatico del
    # carnet fisico. Apagada por defecto; no es parte de la propuesta.
    enable_static_baseline: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
