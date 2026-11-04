from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import AccessLog, BiometricConsent, Role
from ..rut import mask_rut
from ..schemas import AccessLogOut, GateOut, StaffRef

router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(require_roles(Role.ADMIN, Role.GUARD))])


def log_out(entry: AccessLog, consented: frozenset[str] = frozenset()) -> AccessLogOut:
    return AccessLogOut(
        id=entry.id,
        token_id=entry.token_id,
        granted=entry.granted,
        reason=entry.reason,
        offline=entry.offline,
        face_consent=entry.token_id in consented,
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
    nonces = [entry.token_id for entry in entries if entry.token_id]
    consented = frozenset(
        nonce for (nonce,) in db.query(BiometricConsent.nonce).filter(BiometricConsent.nonce.in_(nonces))
    )
    return [log_out(entry, consented) for entry in entries]
