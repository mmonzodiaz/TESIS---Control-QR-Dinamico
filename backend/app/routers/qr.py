from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user, require_roles
from ..models import AccessLog, QRToken, Role, User, utcnow
from ..schemas import QRGenerateOut, QRValidateIn, QRValidateOut, UserOut

router = APIRouter(prefix="/qr", tags=["qr"])


@router.post("/generate", response_model=QRGenerateOut)
def generate_qr(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = utcnow()

    # Invalida cualquier QR anterior sin usar para que solo exista un codigo vigente por persona.
    db.query(QRToken).filter(
        QRToken.user_id == current_user.id,
        QRToken.used.is_(False),
    ).update({"used": True, "used_at": now})

    token = QRToken(
        user_id=current_user.id,
        expires_at=now + timedelta(seconds=settings.qr_ttl_seconds),
    )
    db.add(token)
    db.commit()
    db.refresh(token)

    return QRGenerateOut(token=token.id, expires_at=token.expires_at, ttl_seconds=settings.qr_ttl_seconds)


@router.post("/validate", response_model=QRValidateOut)
def validate_qr(
    payload: QRValidateIn,
    guard: User = Depends(require_roles(Role.GUARD, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    now = utcnow()
    token = db.get(QRToken, payload.token)

    if token is None:
        db.add(AccessLog(token_id=None, user_id=None, scanned_by_id=guard.id, granted=False, reason="invalid"))
        db.commit()
        return QRValidateOut(granted=False, reason="invalid")

    if token.used:
        reason = "already_used"
        granted = False
    elif token.expires_at < now:
        reason = "expired"
        granted = False
    else:
        reason = "ok"
        granted = True

    if granted:
        token.used = True
        token.used_at = now

    db.add(
        AccessLog(
            token_id=token.id,
            user_id=token.user_id,
            scanned_by_id=guard.id,
            granted=granted,
            reason=reason,
        )
    )
    db.commit()

    return QRValidateOut(granted=granted, reason=reason, user=UserOut.model_validate(token.user))
