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
    # Linea base para experimentos (scripts/attack_experiment.py): emula el QR estatico del
    # carnet fisico. Apagada por defecto; no es parte de la propuesta.
    enable_static_baseline: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
