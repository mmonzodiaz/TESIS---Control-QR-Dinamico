from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import AccessLog, Role
from ..schemas import AccessLogOut

router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(require_roles(Role.ADMIN, Role.GUARD))])


@router.get("", response_model=list[AccessLogOut])
def list_logs(limit: int = 100, db: Session = Depends(get_db)):
    return (
        db.query(AccessLog)
        .order_by(AccessLog.created_at.desc())
        .limit(min(limit, 500))
        .all()
    )
