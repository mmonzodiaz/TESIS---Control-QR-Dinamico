import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Role, Ticket, User
from .security import decode_access_token, decode_token_payload

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

ATTENDEE_SUBJECT_PREFIX = "ticket:"


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar la sesion",
        headers={"WWW-Authenticate": "Bearer"},
    )
    email = decode_access_token(token)
    if email is None or email.startswith(ATTENDEE_SUBJECT_PREFIX):
        raise credentials_error
    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise credentials_error
    return user


def require_roles(*roles: Role):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permisos para esta accion")
        return user

    return checker


def get_current_ticket(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Ticket:
    """Sesion de asistente: JWT emitido por /tickets/claim, ligado al dispositivo por `sid`."""
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesion de entrada invalida o vinculada a otro dispositivo",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token_payload(token)
    subject = (payload or {}).get("sub") or ""
    if not subject.startswith(ATTENDEE_SUBJECT_PREFIX):
        raise credentials_error
    ticket = db.get(Ticket, int(subject.removeprefix(ATTENDEE_SUBJECT_PREFIX)))
    # Si un admin libero el dispositivo (reset), la sesion anterior deja de servir.
    if ticket is None or ticket.claim_session is None or payload.get("sid") != ticket.claim_session:
        raise credentials_error
    return ticket


class RateLimiter:
    """Ventana deslizante en memoria por IP. Suficiente para el prototipo (un proceso);
    en produccion esto va en el proxy/API gateway. Mitiga fuerza bruta sobre el codigo (A7)."""

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


claim_rate_limiter = RateLimiter(max_calls=10, window_seconds=60)
