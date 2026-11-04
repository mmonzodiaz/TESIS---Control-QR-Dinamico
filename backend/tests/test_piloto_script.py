"""Apoyo al piloto (scripts/piloto.py): reabrir entradas entre demostraciones y exportar sin datos personales."""

import csv
import io

from app.database import SessionLocal
from app.models import Ticket
from helpers import auth_header, create_event, guard_scanner, person_with_ticket
from scripts.piloto import COLUMNS, export_rows, reopen_event


def run(function, *args):
    db = SessionLocal()
    try:
        return function(db, *args)
    finally:
        db.close()


def admitted_at(ticket_id: int):
    db = SessionLocal()
    try:
        return db.get(Ticket, ticket_id).admitted_at
    finally:
        db.close()


def test_a_reopened_ticket_lets_the_demo_person_enter_again(client):
    event_id, [gate_id] = create_event()
    ticket_id, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_piloto1@test.cl", event_id)
    assert scanner.scan(phone.qr(), gate_id)["granted"] is True
    assert scanner.scan(phone.qr(), gate_id)["reason"] == "already_admitted"

    assert run(reopen_event, event_id) == 1

    assert admitted_at(ticket_id) is None
    assert scanner.scan(phone.qr(), gate_id)["granted"] is True


def test_reopening_does_not_revive_a_used_qr_or_touch_other_events(client):
    event_id, [gate_id] = create_event()
    other_event, [other_gate] = create_event("Otro evento")
    _, phone = person_with_ticket(event_id)
    other_ticket, other_phone = person_with_ticket(other_event)
    _, scanner = guard_scanner(client, "guard_piloto2@test.cl", event_id)
    _, other_scanner = guard_scanner(client, "guard_piloto3@test.cl", other_event)
    qr = phone.qr()
    assert scanner.scan(qr, gate_id)["granted"] is True
    assert other_scanner.scan(other_phone.qr(), other_gate)["granted"] is True

    run(reopen_event, event_id)

    assert scanner.scan(qr, gate_id)["reason"] == "already_used"
    assert admitted_at(other_ticket) is not None


def test_export_has_no_personal_data_and_measures_the_guard_decision(client):
    event_id, [gate_id] = create_event("Evento exportado")
    _, phone = person_with_ticket(event_id, "Nombre Muy Reconocible")
    _, impostor_phone = person_with_ticket(event_id, "Otro Nombre Reconocible")
    token, scanner = guard_scanner(client, "guard_piloto4@test.cl", event_id)
    contents, identity = scanner.read(phone.qr())

    assert scanner.scan(phone.qr(), gate_id, decide=lambda _: True)["granted"] is True
    assert scanner.scan(impostor_phone.qr(), gate_id, decide=lambda _: False)["reason"] == "photo_mismatch"
    assert scanner.scan(phone.qr(), gate_id, decide=lambda _: True)["reason"] == "already_admitted"

    rows = run(export_rows, event_id)

    assert [row["motivo"] for row in rows] == ["ok", "photo_mismatch", "already_admitted"]
    assert [row["persona"] for row in rows] == ["persona-1", "persona-2", "persona-1"]
    assert {row["guardia"] for row in rows} == {"guardia-1"}
    assert rows[0]["dejo_pasar"] is True and rows[0]["segundos_decision"] is not None
    assert rows[1]["dejo_pasar"] is False and rows[1]["segundos_decision"] is not None
    assert rows[2]["segundos_decision"] is None  # se rechazo antes de que el guardia decidiera
    assert rows[0]["segundos_desde_inicio"] == 0

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    exported = buffer.getvalue()
    for private in ("Reconocible", identity.rut, contents.nonce.hex(), "guard_piloto4", str(rows[0]["fila"]) + "@"):
        assert private not in exported
    logs = client.get("/logs", headers=auth_header(token)).json()
    assert len([entry for entry in logs if entry["gate"] and entry["gate"]["id"] == gate_id]) >= 3


def test_export_only_includes_the_requested_event(client):
    event_id, [gate_id] = create_event()
    other_event, [other_gate] = create_event("Evento ajeno")
    _, phone = person_with_ticket(event_id)
    _, other_phone = person_with_ticket(other_event)
    _, scanner = guard_scanner(client, "guard_piloto5@test.cl", event_id)
    _, other_scanner = guard_scanner(client, "guard_piloto6@test.cl", other_event)
    scanner.scan(phone.qr(), gate_id)
    other_scanner.scan(other_phone.qr(), other_gate)

    assert len(run(export_rows, event_id)) == 1


def test_export_of_an_event_without_attempts_is_empty():
    event_id, _ = create_event("Evento sin intentos")
    assert run(export_rows, event_id) == []
