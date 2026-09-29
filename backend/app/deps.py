from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .audit import audit
from .database import get_db
from .models import Role, User
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar la sesión",
        headers={"WWW-Authenticate": "Bearer"},
    )
    decoded = decode_access_token(token)
    if decoded is None:
        raise credentials_error
    email, version = decoded
    user = db.query(User).filter(User.email == email).first()
    # Desactivado, o token anterior a un cambio de contrasena o de rol: la sesion ya no vale.
    if user is None or not user.is_active or user.session_version != version:
        raise credentials_error
    return user


def require_roles(*roles: Role):
    def checker(request: Request, user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            audit("forbidden", request, user=user.email, role=user.role.value, path=request.url.path)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permisos para esta acción")
        return user

    return checker
