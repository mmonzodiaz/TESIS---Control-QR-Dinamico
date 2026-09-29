"""Metricas por puerta/fila: la evidencia empirica para discutir el largo de las filas.

Con el throughput observado por puerta (escaneos/min) y la tasa de llegada, el largo
esperado de la fila se estima con teoria de colas (ley de Little, L = lambda * W).
"""

import math
from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import AccessLog, Gate, Role
from ..schemas import EventMetrics, GateMetrics
from .events import get_event_or_404

router = APIRouter(prefix="/metrics", tags=["metrics"], dependencies=[Depends(require_roles(Role.ADMIN, Role.GUARD))])


def percentile(values: list[float], pct: float) -> float | None:
    """Percentil por rango mas cercano (nearest-rank)."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


def gate_metrics(gate: Gate | None, entries: list[AccessLog]) -> GateMetrics:
    times = sorted(e.created_at for e in entries)
    span_minutes = (times[-1] - times[0]).total_seconds() / 60 if len(times) >= 2 else 0
    latencies = [e.latency_ms for e in entries if not e.offline]  # lo sincronizado no paso por el servidor
    return GateMetrics(
        gate_id=gate.id if gate else None,
        gate_name=gate.name if gate else "Sin puerta asignada",
        lane=gate.lane if gate else None,
        scans=len(entries),
        granted=sum(e.granted for e in entries),
        rejected_by_reason=dict(Counter(e.reason for e in entries if not e.granted)),
        # Tasa observada entre el primer y el ultimo escaneo; None si no hay intervalo medible.
        scans_per_minute=round((len(entries) - 1) / span_minutes, 2) if span_minutes > 0 else None,
        latency_p50_ms=percentile(latencies, 50),
        latency_p95_ms=percentile(latencies, 95),
    )


@router.get("", response_model=EventMetrics)
def event_metrics(event_id: int, db: Session = Depends(get_db)):
    event = get_event_or_404(db, event_id)
    gate_ids = [g.id for g in event.gates]
    ticket_ids = [t.id for t in event.tickets]

    entries = (
        db.query(AccessLog)
        .filter(or_(AccessLog.gate_id.in_(gate_ids), AccessLog.ticket_id.in_(ticket_ids)))
        .all()
    )
    by_gate: dict[int | None, list[AccessLog]] = {g.id: [] for g in event.gates}
    for entry in entries:
        by_gate.setdefault(entry.gate_id, []).append(entry)

    gates_by_id = {g.id: g for g in event.gates}
    return EventMetrics(
        event_id=event.id,
        tickets_total=len(event.tickets),
        tickets_admitted=sum(t.admitted_at is not None for t in event.tickets),
        gates=[
            gate_metrics(gates_by_id.get(gate_id), group)
            for gate_id, group in by_gate.items()
            if gate_id is not None or group
        ],
    )
