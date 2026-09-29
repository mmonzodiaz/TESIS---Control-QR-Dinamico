import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from .audit import audit


class RateLimiter:
    """Ventana deslizante en memoria. Suficiente para el prototipo (un proceso); en produccion esto
    va en el proxy/API gateway o en un almacen compartido (Redis).

    Como dependencia de FastAPI limita por IP; `hit(clave)` limita por otra clave (cuenta, guardia).
    Mitiga fuerza bruta sobre secretos cortos (clave de activacion, contrasena del personal) y el
    abuso de un token de guardia robado para sondear cedulas (A5, A7). `max_calls = 0` lo apaga
    (la prueba de carga lo necesita: satura el servidor a proposito). Cada bloqueo queda en el
    registro de seguridad (app/audit.py)."""

    def __init__(self, max_calls: int, window_seconds: float = 60, detail: str | None = None, name: str = "rate_limit"):
        self.max_calls = max_calls
        self.window_seconds = window_seconds
        self.detail = detail or "Demasiados intentos. Espera un minuto e intenta de nuevo."
        self.name = name
        self._calls: dict[str, deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        self._calls.clear()

    def hit(self, key: str, request: Request | None = None) -> None:
        if self.max_calls <= 0:
            return
        now = time.monotonic()
        calls = self._calls[key]
        while calls and now - calls[0] > self.window_seconds:
            calls.popleft()
        if len(calls) >= self.max_calls:
            audit("rate_limited", request, limiter=self.name, key=key)
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=self.detail)
        calls.append(now)

    def __call__(self, request: Request) -> None:
        self.hit(request.client.host if request.client else "unknown", request)
