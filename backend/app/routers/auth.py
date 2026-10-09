from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..audit import audit
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..ratelimit import RateLimiter
from ..schemas import Token, UserOut
from ..security import create_access_token, hash_password, needs_rehash, spend_verify_time, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# Tres limites. Por IP: frena probar muchas cuentas desde un mismo equipo. Por cuenta Y por IP (el
# estricto): frena adivinar la contrasena de una cuenta desde un equipo. Por cuenta desde cualquier IP
# (holgado, mayor que el de una IP): frena la fuerza bruta distribuida sin que una sola IP pueda
# bloquear la cuenta de un guardia a proposito, que era lo que permitia el limite por cuenta estricto
# (5/min desde cualquier IP). Cuentan todos los intentos, no solo los fallidos, para no revelar con el
# 429 si la contrasena era correcta.
login_ip_limiter = RateLimiter(settings.login_rate_limit_per_ip, name="login_ip")
login_account_limiter = RateLimiter(settings.login_rate_limit_per_account, name="login_account")
login_account_total_limiter = RateLimiter(settings.login_rate_limit_per_account_total, name="login_account_total")

MAX_EMAIL_LENGTH = 254  # RFC 5321


@router.post("/login", response_model=Token, dependencies=[Depends(login_ip_limiter)])
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    email = form_data.username.strip().lower()
    account = email[:MAX_EMAIL_LENGTH]
    ip = request.client.host if request.client else "unknown"
    login_account_limiter.hit(f"{account}|{ip}", request)
    login_account_total_limiter.hit(account, request)
    # Mismo mensaje para cuenta inexistente, contrasena incorrecta o cuenta desactivada: no revela
    # que cuentas existen (ASVS V2.2, enumeracion de usuarios).
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    if len(email) > MAX_EMAIL_LENGTH or len(form_data.password) > settings.password_max_length:
        audit("login_failed", request, user=email[:80], why="entrada demasiado larga")
        raise invalid
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        spend_verify_time(form_data.password)  # tarda lo mismo que con una cuenta real
        audit("login_failed", request, user=email, why="cuenta inexistente")
        raise invalid
    if not verify_password(form_data.password, user.password_hash):
        audit("login_failed", request, user=email, why="contrasena incorrecta")
        raise invalid
    if not user.is_active:
        audit("login_failed", request, user=email, why="cuenta desactivada")
        raise invalid
    if needs_rehash(user.password_hash):
        # Hash bcrypt heredado o parametros de Argon2 viejos: se actualiza con la contrasena correcta.
        user.password_hash = hash_password(form_data.password)
        db.commit()
    audit("login_ok", request, user=email, role=user.role.value)
    token = create_access_token(subject=user.email, session_version=user.session_version)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
