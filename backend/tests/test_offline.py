"""Contingencia sin conexion (ADR-15): copia para el escaner y sincronizacion de lo que el guardia
decidio sin red, con alertas cuando el servidor no habria dejado pasar."""

from app.models import Role, unix_now
from app.security import contingency_seal
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


def contingency_copy(scanner) -> dict:
    res = scanner.client.get(f"/events/{scanner.event_id}/contingencia", headers=scanner.headers)
    assert res.status_code == 200, res.text
    return res.json()


def offline_decision(
    scanner, phone, gate_id: int, decision: str = "admit", qr: str | None = None, scanned_at: int | None = None
) -> dict:
    """Lo que guarda el escaner sin red: el QR leido (sin la foto), la hora, la copia de contingencia
    con que decidio (con su sello) y lo que decidio el guardia."""
    contents, _ = scanner.read(qr or phone.qr())
    copy = contingency_copy(scanner)
    return {
        **scanner.validate_payload(contents, gate_id),
        "decision": decision,
        "scanned_at": unix_now() if scanned_at is None else scanned_at,
        "contingency_generated_at": copy["generated_at"],
        "contingency_seal": copy["seal"],
    }


def sealed_decision(scanner, phone, gate_id: int, generated_at: int, issued_at: int, scanned_at: int, seal_event: int) -> dict:
    """Decision sin red con una copia de contingencia generada en el pasado (sello armado aqui)."""
    contents, _ = scanner.read(phone.qr(issued_at=issued_at))
    return {
        **scanner.validate_payload(contents, gate_id),
        "decision": "admit",
        "scanned_at": scanned_at,
        "contingency_generated_at": generated_at,
        "contingency_seal": contingency_seal(seal_event, generated_at),
    }


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


def test_an_old_qr_cannot_be_backdated_into_an_offline_admission(client):
    """Con un token de guardia (A5), un QR fotografiado hace una hora se envia como ingreso sin red,
    declarando una hora de escaneo en que el QR estaba vigente. El servidor solo cree esa hora dentro de
    la vigencia de la copia sellada: el QR queda vencido, con alerta, y el titular sigue pudiendo entrar."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off6@test.cl", event_id)
    issued_at = unix_now() - 3600

    sealed = offline_decision(scanner, phone, gate_id, qr=phone.qr(issued_at=issued_at), scanned_at=issued_at + 1)
    assert sync(client, token, [sealed])[0] == {"nonce": sealed["nonce"], "reason": "expired", "alert": True}
    # Sin sello, o con uno que no emitio el servidor, la hora declarada no cuenta.
    for seal in (None, "0" * 64):
        decision = offline_decision(scanner, phone, gate_id, qr=phone.qr(issued_at=issued_at), scanned_at=issued_at + 1)
        assert sync(client, token, [{**decision, "contingency_seal": seal}])[0]["reason"] == "expired"
    assert scanner.scan(phone.qr(), gate_id)["granted"] is True


def test_a_seal_from_another_event_does_not_vouch_for_the_scan_time(client):
    event_id, [gate_id] = create_event()
    other_event, _ = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off7@test.cl", event_id)
    generated_at = unix_now() - 400

    decision = sealed_decision(scanner, phone, gate_id, generated_at, generated_at + 299, generated_at + 300, other_event)
    assert sync(client, token, [decision])[0] == {"nonce": decision["nonce"], "reason": "expired", "alert": True}


def test_an_outage_synced_much_later_keeps_the_scan_time_of_its_sealed_copy(client):
    """El caso legitimo: la red cayo, el guardia dejo pasar con una copia de hace 5 min y la red volvio
    bastante despues. La hora declarada cae dentro de la vigencia de la copia y se respeta."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off8@test.cl", event_id)
    generated_at = unix_now() - 700

    decision = sealed_decision(scanner, phone, gate_id, generated_at, generated_at + 299, generated_at + 300, event_id)
    assert sync(client, token, [decision])[0] == {"nonce": decision["nonce"], "reason": "ok", "alert": False}


def test_decision_after_an_online_check_is_timed_by_the_check(client):
    """La red cayo mientras el guardia miraba la foto: el "check" en linea ya habia pasado. Aunque el
    escaner no mande copia sellada, la hora queda acotada por el check y la decision vale."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off9@test.cl", event_id)
    contents, _ = scanner.read(phone.qr())
    payload = scanner.validate_payload(contents, gate_id)
    assert client.post("/qr/validate", json={**payload, "action": "check"}, headers=scanner.headers).json()["pending"]

    # Una hora declarada absurda (una hora antes del check) se acota al check; no se cree.
    decision = {**payload, "decision": "admit", "scanned_at": unix_now() - 3600}
    assert sync(client, token, [decision])[0] == {"nonce": payload["nonce"], "reason": "ok", "alert": False}


def test_a_failed_online_check_does_not_hide_a_later_offline_admission(client):
    """El "check" en linea rechazo a una persona con prohibicion y quedo en el historial. Con el mismo QR,
    aun vigente, entra por otra puerta sin red. Al sincronizar deben quedar el ingreso y la alerta, no
    la respuesta del check."""
    event_id, [gate_a, gate_b] = create_event(gates=2)
    rut = new_rut()
    create_ticket(event_id, rut)
    phone = phone_for(rut)
    create_user("admin_off2@test.cl", Role.ADMIN)
    admin = login(client, "admin_off2@test.cl")
    assert client.post("/bans", json={"rut": rut, "reason": "Sancion"}, headers=auth_header(admin)).status_code == 201
    token, scanner = guard_scanner(client, "guard_off10@test.cl", event_id)
    qr = phone.qr()
    contents, _ = scanner.read(qr)
    payload = scanner.validate_payload(contents, gate_a)
    check = client.post("/qr/validate", json={**payload, "action": "check"}, headers=scanner.headers).json()
    assert check["reason"] == "banned"

    decision = offline_decision(scanner, phone, gate_b, qr=qr)
    assert sync(client, token, [decision])[0] == {"nonce": payload["nonce"], "reason": "banned", "alert": True}
    logs = client.get("/logs?limit=500", headers=auth_header(token)).json()
    mine = sorted((e["offline"], e["granted"]) for e in logs if e["token_id"] == payload["nonce"])
    assert mine == [(False, False), (True, True)]


def test_an_alerted_offline_admission_does_not_burn_the_holders_ticket(client):
    """"No coincide" en linea (quien mostro el QR no era el titular) y el mismo QR entra sin red por otra
    puerta: alerta. La entrada del titular NO se consume, porque quien entro probablemente no era el; el
    titular entra despues con un QR nuevo (el mismo criterio de ADR-12)."""
    event_id, [gate_a, gate_b] = create_event(gates=2)
    _, phone = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off11@test.cl", event_id)
    qr = phone.qr()
    contents, _ = scanner.read(qr)
    payload = scanner.validate_payload(contents, gate_a)
    reject = client.post("/qr/validate", json={**payload, "action": "reject"}, headers=scanner.headers).json()
    assert reject["reason"] == "photo_mismatch"

    decision = offline_decision(scanner, phone, gate_b, qr=qr)
    assert sync(client, token, [decision])[0] == {"nonce": payload["nonce"], "reason": "already_used", "alert": True}
    assert scanner.scan(phone.qr(), gate_a)["granted"] is True


def test_a_decision_for_a_gate_that_no_longer_exists_does_not_block_the_batch(client):
    """Antes, una fila inexistente abortaba el lote con un 400 despues de guardar las decisiones
    anteriores, y el escaner reintentaba la misma cola para siempre. Ahora cada decision tiene su
    resultado: la de la fila borrada queda registrada (con alerta si se dejo pasar) y las demas siguen."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, other = person_with_ticket(event_id)
    token, scanner = guard_scanner(client, "guard_off12@test.cl", event_id)

    orphan = {**offline_decision(scanner, phone, gate_id), "gate_id": 999_999}
    valid = offline_decision(scanner, other, gate_id)
    results = sync(client, token, [orphan, valid])
    assert results == [
        {"nonce": orphan["nonce"], "reason": "unknown_gate", "alert": True},
        {"nonce": valid["nonce"], "reason": "ok", "alert": False},
    ]
    # Reenviar el lote no duplica la decision huerfana.
    assert sync(client, token, [orphan])[0] == results[0]
    logs = client.get("/logs?limit=500", headers=auth_header(token)).json()
    [log] = [e for e in logs if e["token_id"] == orphan["nonce"]]
    assert log["offline"] is True and log["granted"] is True and log["reason"] == "unknown_gate"
