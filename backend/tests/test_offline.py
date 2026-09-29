"""Contingencia sin conexion (ADR-15): copia para el escaner y sincronizacion de lo que el guardia
decidio sin red, con alertas cuando el servidor no habria dejado pasar."""

from app.models import Role, unix_now
from helpers import (
    auth_header,
    create_event,
    create_ticket,
    create_user,
    guard_scanner,
    login,
    new_rut,
    person_with_ticket,
    phone_for,
)


def offline_decision(scanner, phone, gate_id: int, decision: str = "admit") -> dict:
    """Lo que guarda el escaner sin red: el QR leido (sin la foto), la hora y lo que decidio el guardia."""
    contents, _ = scanner.read(phone.qr())
    return {**scanner.validate_payload(contents, gate_id), "decision": decision, "scanned_at": unix_now()}


def sync(client, token: str, decisions: list[dict]) -> list[dict]:
    res = client.post("/qr/sync", json={"decisions": decisions}, headers=auth_header(token))
    assert res.status_code == 200, res.text
    return res.json()


def test_contingency_copy_lists_tickets_admissions_and_bans(client):
    event_id, [gate_id] = create_event()
    _, admitted = person_with_ticket(event_id)
    waiting_rut = new_rut()
    create_ticket(event_id, waiting_rut)
    token, scanner = guard_scanner(client, "guard_cont@test.cl", event_id)
    scanner.scan(admitted.qr(), gate_id)

    res = client.get(f"/events/{event_id}/contingencia", headers=auth_header(token))
    assert res.status_code == 200
    copy = res.json()
    admitted_rut = scanner.read(admitted.qr())[1].rut
    assert set(copy["ticket_ruts"]) == {admitted_rut, waiting_rut.replace("-", "")}
    assert copy["admitted_ruts"] == [admitted_rut]
    assert copy["max_age_seconds"] > 0 and copy["generated_at"] > 0
    assert client.get(f"/events/{event_id}/contingencia").status_code == 401


def test_offline_admission_is_recorded_when_the_network_returns(client):
    event_id, [gate_id] = create_event()
    ticket_id, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off1@test.cl", event_id)

    decision = offline_decision(scanner, phone, gate_id)
    assert sync(client, token, [decision]) == [{"nonce": decision["nonce"], "reason": "ok", "alert": False}]

    # Queda en el historial como ingreso sin conexion, y la entrada ya no vuelve a entrar.
    def logs_of_this_qr() -> list[dict]:
        return [e for e in client.get("/logs?limit=500", headers=auth_header(token)).json() if e["token_id"] == decision["nonce"]]

    [log] = logs_of_this_qr()
    assert log["offline"] is True and log["granted"] is True and log["reason"] == "ok"
    assert scanner.scan(phone.qr(), gate_id)["reason"] == "already_admitted"
    # Reenviar el mismo lote (se perdio la respuesta) no duplica nada.
    assert sync(client, token, [decision])[0]["reason"] == "ok"
    assert len(logs_of_this_qr()) == 1


def test_admission_that_reached_the_server_before_the_outage_is_not_duplicated(client):
    """El guardia toco "Dejar pasar", el servidor lo registro, pero la respuesta no llego: el escaner
    lo guardo como pendiente. Al sincronizar no debe quedar una alerta falsa ni un doble registro."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off5@test.cl", event_id)
    contents, _ = scanner.read(phone.qr())
    payload = scanner.validate_payload(contents, gate_id)
    assert client.post("/qr/validate", json={**payload, "action": "admit"}, headers=scanner.headers).json()["granted"]

    result = sync(client, token, [{**payload, "decision": "admit", "scanned_at": unix_now()}])[0]
    assert result == {"nonce": payload["nonce"], "reason": "ok", "alert": False}


def test_same_person_admitted_at_two_gates_during_the_outage_is_flagged(client):
    """El riesgo residual de operar sin red: dos puertas sin conexion no se enteran entre si. No se
    evita, pero se detecta al sincronizar."""
    event_id, [gate_a, gate_b] = create_event(gates=2)
    _, phone = person_with_ticket(event_id)
    token_a, scanner_a = guard_scanner(client, "guard_off_a@test.cl", event_id)
    token_b, scanner_b = guard_scanner(client, "guard_off_b@test.cl", event_id)

    first = offline_decision(scanner_a, phone, gate_a)
    second = offline_decision(scanner_b, phone, gate_b)  # otro QR de la misma cedula (p. ej. reenviado)

    assert sync(client, token_a, [first])[0] == {"nonce": first["nonce"], "reason": "ok", "alert": False}
    assert sync(client, token_b, [second])[0] == {"nonce": second["nonce"], "reason": "already_admitted", "alert": True}


def test_offline_admission_of_a_banned_person_is_flagged(client):
    event_id, [gate_id] = create_event()
    rut = new_rut()
    create_ticket(event_id, rut)
    phone = phone_for(rut)
    token, scanner = guard_scanner(client, "guard_off2@test.cl", event_id)
    create_user("admin_off@test.cl", Role.ADMIN)
    admin = login(client, "admin_off@test.cl")
    # Prohibicion agregada mientras el escaner estaba sin red: su copia no la tenia.
    assert client.post("/bans", json={"rut": rut, "reason": "Sancion"}, headers=auth_header(admin)).status_code == 201

    result = sync(client, token, [offline_decision(scanner, phone, gate_id)])[0]
    assert result["reason"] == "banned" and result["alert"] is True


def test_offline_photo_mismatch_burns_only_that_qr(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off3@test.cl", event_id)

    result = sync(client, token, [offline_decision(scanner, phone, gate_id, "reject")])[0]
    assert result == {"nonce": result["nonce"], "reason": "photo_mismatch", "alert": False}
    # El titular real entra despues con un QR nuevo.
    assert scanner.scan(phone.qr(), gate_id)["granted"] is True


def test_sync_rechecks_signatures_and_expiry(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off4@test.cl", event_id)

    forged = {**offline_decision(scanner, phone, gate_id), "issuer_sig": "A" * 86}
    assert sync(client, token, [forged])[0] == {"nonce": forged["nonce"], "reason": "invalid", "alert": True}
    # Un QR de hace una hora (p. ej. una captura) que el escaner sin red dejo pasar igual.
    contents, _ = scanner.read(phone.qr(issued_at=unix_now() - 3600))
    stale = {**scanner.validate_payload(contents, gate_id), "decision": "admit", "scanned_at": unix_now()}
    assert sync(client, token, [stale])[0] == {"nonce": stale["nonce"], "reason": "expired", "alert": True}
