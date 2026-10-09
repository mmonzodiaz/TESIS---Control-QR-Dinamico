from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import AccessLog, Role
from ..rut import mask_rut
from ..schemas import AccessLogOut, GateOut, StaffRef

router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(require_roles(Role.ADMIN, Role.GUARD))])


def log_out(entry: AccessLog) -> AccessLogOut:
    return AccessLogOut(
        id=entry.id,
        token_id=entry.token_id,
        granted=entry.granted,
        reason=entry.reason,
        offline=entry.offline,
        latency_ms=entry.latency_ms,
        created_at=entry.created_at,
        holder_name=entry.ticket.holder_name if entry.ticket else None,
        rut_masked=mask_rut(entry.document_id or entry.ticket.document_id)
        if (entry.document_id or entry.ticket)
        else None,
        gate=GateOut.model_validate(entry.gate) if entry.gate else None,
        scanned_by=StaffRef.model_validate(entry.scanned_by) if entry.scanned_by else None,
    )


@router.get("", response_model=list[AccessLogOut])
def list_logs(limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    entries = db.query(AccessLog).order_by(AccessLog.created_at.desc()).limit(limit).all()
    return [log_out(entry) for entry in entries]
