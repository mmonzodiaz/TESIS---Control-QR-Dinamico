"""Lista de prohibicion de ingreso (solo admin). Ver docs/threat-model.md A10."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import BannedPerson, Role
from ..rut import is_valid_rut, normalize_rut
from ..schemas import BanCreate, BanOut

router = APIRouter(prefix="/bans", tags=["bans"], dependencies=[Depends(require_roles(Role.ADMIN))])


@router.get("", response_model=list[BanOut])
def list_bans(db: Session = Depends(get_db)):
    return db.query(BannedPerson).order_by(BannedPerson.created_at.desc()).all()


@router.post("", response_model=BanOut, status_code=status.HTTP_201_CREATED)
def add_ban(payload: BanCreate, db: Session = Depends(get_db)):
    if not is_valid_rut(payload.rut):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RUT invalido")
    ban = BannedPerson(document_id=normalize_rut(payload.rut), reason=payload.reason)
    db.add(ban)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ese RUT ya tiene prohibicion de ingreso")
    db.refresh(ban)
    return ban


@router.delete("/{ban_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_ban(ban_id: int, db: Session = Depends(get_db)):
    ban = db.get(BannedPerson, ban_id)
    if ban is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prohibicion no encontrada")
    db.delete(ban)
    db.commit()
