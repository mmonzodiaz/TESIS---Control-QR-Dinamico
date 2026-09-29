from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..audit import audit
from ..database import get_db
from ..deps import require_roles
from ..models import Role, User
from ..schemas import UserCreate, UserOut, UserUpdate
from ..security import hash_password

admin_only = require_roles(Role.ADMIN)
router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(admin_only)])


def _get_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return user


def _other_active_admins(db: Session, user: User) -> int:
    return db.query(User).filter(User.role == Role.ADMIN, User.is_active.is_(True), User.id != user.id).count()


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.created_at.desc()).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ese email ya está registrado")
    user = User(
        email=payload.email,
        full_name=payload.full_name,
        document_id=payload.document_id,
        role=payload.role,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit("user_created", request, by=admin.email, user=user.email, role=user.role.value)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, payload: UserUpdate, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    user = _get_or_404(db, user_id)
    data = payload.model_dump(exclude_unset=True)
    password = data.pop("password", None)
    losing_admin = user.role == Role.ADMIN and (
        data.get("role", Role.ADMIN) != Role.ADMIN or data.get("is_active", True) is False
    )
    if losing_admin and user.id == admin.id:
        # Un admin no se quita a si mismo el rol ni se desactiva: evita dejar el sistema sin gestion.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes quitarte tus propios permisos de administrador")
    if losing_admin and _other_active_admins(db, user) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Debe quedar al menos un administrador activo")

    # Cambiar contrasena, rol o estado cierra las sesiones abiertas de ese usuario (claim "ver").
    sensitive = bool(password) or ("role" in data and data["role"] != user.role) or ("is_active" in data and data["is_active"] != user.is_active)
    if password:
        user.password_hash = hash_password(password)
    for field, value in data.items():
        setattr(user, field, value)
    if sensitive:
        user.session_version += 1
    db.commit()
    db.refresh(user)
    audit(
        "user_updated",
        request,
        by=admin.email,
        user=user.email,
        fields=",".join(sorted([*data, *(["password"] if password else [])])) or "-",
        sessions_closed=sensitive,
    )
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    user = _get_or_404(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes eliminar tu propia cuenta")
    if user.role == Role.ADMIN and user.is_active and _other_active_admins(db, user) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Debe quedar al menos un administrador activo")
    db.delete(user)
    db.commit()
    audit("user_deleted", request, by=admin.email, user=user.email)
