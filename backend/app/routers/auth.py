from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..ratelimit import RateLimiter
from ..schemas import Token, UserOut
from ..security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# Por IP: frena probar muchas cuentas desde un mismo equipo. Por cuenta: frena adivinar la
# contrasena de un guardia desde varias IP. Cuentan todos los intentos, no solo los fallidos, para no
# revelar con el 429 si la contrasena era correcta.
login_ip_limiter = RateLimiter(settings.login_rate_limit_per_ip)
login_account_limiter = RateLimiter(settings.login_rate_limit_per_account)


@router.post("/login", response_model=Token, dependencies=[Depends(login_ip_limiter)])
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    login_account_limiter.hit(form_data.username.strip().lower())
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")
    token = create_access_token(subject=user.email)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
