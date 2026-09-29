from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Secretos que aparecieron alguna vez en ejemplos del repositorio: son publicos, no sirven.
_PUBLIC_EXAMPLE_SECRETS = {"change-me-please-super-secret", "cambia-esto-por-un-secreto-largo-y-aleatorio"}
MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    database_url: str = "sqlite:///./control_acceso.db"
    # Sin valor por defecto a proposito: si falta en .env/entorno, el arranque debe fallar
    # ruidosamente en vez de servir con un secreto de ejemplo conocido publicamente. Con el secreto
    # se puede fabricar un token de admin: largo minimo y nunca el del ejemplo (ASVS V6.4).
    jwt_secret: str
    # Algoritmo fijo al verificar: nunca "none" ni asimetricos (confusion de algoritmos).
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_expire_minutes: int = 480  # un turno de guardia

    # Politica de contrasenas del personal (NIST SP 800-63B: largo antes que reglas de composicion).
    password_min_length: int = 12
    password_max_length: int = 128

    # Endurecimiento HTTP (app/hardening.py). La documentacion interactiva (/docs) expone el mapa
    # completo de la API: apagada salvo que se pida (ENABLE_API_DOCS=1 en desarrollo).
    enable_api_docs: bool = False
    max_request_bytes: int = 1_000_000  # /qr/sync con 500 decisiones ocupa ~350 KB
    # El frontend llama a traves del proxy de Vite (mismo origen); CORS solo para estos origenes.
    cors_origins: list[str] = ["http://localhost:5173", "https://localhost:5173"]

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
    # Clave privada de lectores autorizados (la entrega el Registro Civil a quienes verifican).
    verifier_private_key_file: str = "registro_civil_sim/verifier_private.key"
    # Linea base para experimentos (scripts/attack_experiment.py): emula el QR estatico del
    # carnet fisico. Apagada por defecto; no es parte de la propuesta.
    enable_static_baseline: bool = False

    # Limites de intentos por minuto (0 = sin limite; lo usa la prueba de carga). Login: por cuenta
    # (fuerza bruta a una contrasena) y por IP (probar muchas cuentas). Validacion: por guardia; un
    # guardia real hace dos consultas por persona ("check" + "admit") cada varios segundos.
    login_rate_limit_per_account: int = 5
    login_rate_limit_per_ip: int = 30
    qr_validate_rate_limit_per_guard: int = 120

    # Registro Civil (simulado): de ahi se baja la lista firmada de cedulas revocadas (ADR-14).
    registro_civil_url: str = "http://127.0.0.1:8001"
    revocation_refresh_seconds: int = 30
    # Contingencia sin conexion (ADR-15): el escaner baja cada minuto una copia de la lista de RUT con
    # entrada, prohibiciones y revocaciones. Pasado este tiempo sin actualizarla, no admite sin red.
    contingency_max_age_seconds: int = 600

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("jwt_secret")
    @classmethod
    def _strong_jwt_secret(cls, value: str) -> str:
        if value in _PUBLIC_EXAMPLE_SECRETS or len(value) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET debe tener al menos {MIN_JWT_SECRET_LENGTH} caracteres aleatorios y no ser el del ejemplo. "
                'Genera uno con: python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )
        return value


settings = Settings()
