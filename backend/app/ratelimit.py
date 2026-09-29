import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class RateLimiter:
    """Ventana deslizante en memoria por IP. Suficiente para el prototipo (un proceso);
    en produccion esto va en el proxy/API gateway. Mitiga fuerza bruta sobre codigos cortos
    (codigo de entrada, A7; clave de activacion del Registro Civil simulado)."""

    def __init__(self, max_calls: int, window_seconds: float):
        self.max_calls = max_calls
        self.window_seconds = window_seconds
        self._calls: dict[str, deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        self._calls.clear()

    def __call__(self, request: Request) -> None:
        key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        calls = self._calls[key]
        while calls and now - calls[0] > self.window_seconds:
            calls.popleft()
        if len(calls) >= self.max_calls:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Demasiados intentos. Espera un minuto e intenta de nuevo.",
            )
        calls.append(now)
