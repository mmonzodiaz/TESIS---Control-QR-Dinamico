"""Lo que el informe de tesis pide y el prototipo no tenia: "donde se acepta" (Anexo A.2, adoptante
potencial informado) y la evidencia del consentimiento a la comparacion facial (ADR-16)."""

from datetime import timedelta

from app.database import SessionLocal
from app.models import BiometricConsent, Event, Gate, Lane, Role, utcnow
from helpers import auth_header, create_event, create_user, guard_scanner, login, person_with_ticket
from test_offline import offline_decision, sync


def consent_for(nonce: str) -> BiometricConsent | None:
    db = SessionLocal()
    try:
        return db.get(BiometricConsent, nonce)
    finally:
        db.close()


def public_names(client) -> list[str]:
    res = client.get("/events/public")
    assert res.status_code == 200, res.text
    return [event["name"] for event in res.json()]


def add_event(name: str, lane: Lane, starts_at=None) -> None:
    db = SessionLocal()
    event = Event(name=name, starts_at=starts_at)
    event.gates = [Gate(name="Puerta", lane=lane)]
    db.add(event)
    db.commit()
    db.close()


def test_public_events_need_no_session_and_expose_only_name_and_date(client):
    event_id, _ = create_event("Evento publico")
    person_with_ticket(event_id)

    res = client.get("/events/public")

    assert res.status_code == 200
    entry = next(e for e in res.json() if e["name"] == "Evento publico")
    assert set(entry) == {"name", "starts_at"}


def test_public_events_list_only_upcoming_events_with_digital_lane(client):
    now = utcnow()
    add_event("Con fila digital", Lane.DIGITAL, now + timedelta(days=3))
    add_event("Sin fecha", Lane.DIGITAL)
    add_event("Solo fila normal", Lane.NORMAL, now + timedelta(days=3))
    add_event("Ya paso", Lane.DIGITAL, now - timedelta(days=2))

    names = public_names(client)

    assert "Con fila digital" in names and "Sin fecha" in names
    assert "Solo fila normal" not in names and "Ya paso" not in names


def test_public_events_are_rate_limited(client):
    from app.routers.events import public_events_limiter

    for _ in range(public_events_limiter.max_calls):
        assert client.get("/events/public").status_code == 200
    assert client.get("/events/public").status_code == 429


def scan_payload(scanner, phone, gate_id: int) -> dict:
    contents, _ = scanner.read(phone.qr())
    return scanner.validate_payload(contents, gate_id)


def test_consent_is_recorded_when_the_guard_decides_and_shown_in_the_history(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_consent@test.cl", event_id)
    payload = scan_payload(scanner, phone, gate_id)

    checked = client.post("/qr/validate", json={**payload, "action": "check"}, headers=auth_header(token)).json()
    assert checked["pending"] is True
    res = client.post(
        "/qr/validate", json={**payload, "action": "admit", "face_consent": True}, headers=auth_header(token)
    )

    assert res.json()["granted"] is True
    consent = consent_for(payload["nonce"])
    assert consent is not None and consent.gate_id == gate_id
    logs = client.get("/logs", headers=auth_header(token)).json()
    assert next(entry for entry in logs if entry["token_id"] == payload["nonce"])["face_consent"] is True


def test_consent_keeps_nothing_biometric():
    # Invariante de ADR-16: de la comparacion no queda imagen, vector ni puntaje.
    assert set(BiometricConsent.__table__.columns.keys()) == {"nonce", "gate_id", "recorded_by_id", "recorded_at"}


def test_without_consent_nothing_is_recorded_and_entry_still_works(client):
    # La via no biometrica: decidir sin comparacion facial funciona igual y no deja evidencia.
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_noconsent@test.cl", event_id)
    payload = scan_payload(scanner, phone, gate_id)

    res = client.post("/qr/validate", json={**payload, "action": "admit"}, headers=auth_header(token))

    assert res.json()["granted"] is True
    assert consent_for(payload["nonce"]) is None
    logs = client.get("/logs", headers=auth_header(token)).json()
    assert next(entry for entry in logs if entry["token_id"] == payload["nonce"])["face_consent"] is False


def test_a_check_does_not_record_consent(client):
    # El consentimiento se registra con la decision del guardia, no con la verificacion previa.
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_check@test.cl", event_id)
    payload = scan_payload(scanner, phone, gate_id)

    client.post("/qr/validate", json={**payload, "action": "check", "face_consent": True}, headers=auth_header(token))

    assert consent_for(payload["nonce"]) is None


def test_a_forged_qr_does_not_leave_consent_evidence(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_forged@test.cl", event_id)
    payload = {**scan_payload(scanner, phone, gate_id), "device_sig": "A" * 86 + "=="}

    res = client.post(
        "/qr/validate", json={**payload, "action": "admit", "face_consent": True}, headers=auth_header(token)
    )

    assert res.json()["reason"] == "invalid"
    assert consent_for(payload["nonce"]) is None


def test_offline_consent_arrives_with_the_sync_at_the_scan_time(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_offconsent@test.cl", event_id)
    decision = {**offline_decision(scanner, phone, gate_id), "face_consent": True}

    assert sync(client, token, [decision])[0]["alert"] is False
    # Reenviar el lote no duplica ni falla.
    assert sync(client, token, [decision])[0]["alert"] is False

    consent = consent_for(decision["nonce"])
    assert consent is not None and consent.gate_id == gate_id


def test_only_staff_records_consent(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_staff@test.cl", event_id)
    payload = scan_payload(scanner, phone, gate_id)

    assert client.post("/qr/validate", json={**payload, "face_consent": True}).status_code == 401
    assert consent_for(payload["nonce"]) is None


def test_admin_can_also_read_the_consent_flag(client):
    create_user("admin_consent@test.cl", Role.ADMIN)
    admin_token = login(client, "admin_consent@test.cl")
    assert all("face_consent" in entry for entry in client.get("/logs", headers=auth_header(admin_token)).json())
