"""Controles de seguridad transversales (OWASP Top 10 / ASVS): inyeccion, sesiones, cabeceras,
limites de entrada, politica de contrasenas y auditoria."""

import logging
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pytest

from app.config import settings
from app.database import SessionLocal
from app.models import BannedPerson, Role, Ticket, User
from app.security import JWT_AUDIENCE, JWT_ISSUER
from helpers import DEFAULT_PASSWORD, auth_header, create_event, create_user, guard_scanner, login, person_with_ticket

SQL_PAYLOADS = [
    "' OR '1'='1",
    "admin@demo.cl' --",
    "'; DROP TABLE users; --",
    "1; DELETE FROM tickets",
    '" OR ""="',
    "' UNION SELECT password_hash FROM users --",
]


def ensure_user(email: str, role: Role) -> None:
    """Como helpers.create_user, pero idempotente (los tests parametrizados lo llaman varias veces)."""
    db = SessionLocal()
    try:
        exists = db.query(User).filter(User.email == email).first() is not None
    finally:
        db.close()
    if not exists:
        create_user(email, role)


def count(model) -> int:
    db = SessionLocal()
    try:
        return db.query(model).count()
    finally:
        db.close()


# --- A03 Inyeccion ---------------------------------------------------------------------


@pytest.mark.parametrize("payload", SQL_PAYLOADS)
def test_sql_injection_in_login_does_not_bypass_authentication(client, payload):
    ensure_user("victima_sqli@test.cl", Role.ADMIN)
    users_before = count(User)
    for username, password in ((payload, payload), ("victima_sqli@test.cl", payload)):
        res = client.post("/auth/login", data={"username": username, "password": password})
        assert res.status_code == 401
    assert count(User) == users_before


def test_sql_injection_in_admin_inputs_is_stored_as_plain_text(client):
    """Los datos van como parametros ligados: un payload SQL se guarda literal y no se ejecuta."""
    create_user("admin_sqli@test.cl", Role.ADMIN)
    token = login(client, "admin_sqli@test.cl")
    event_id, _ = create_event()
    tickets_before, bans_before = count(Ticket), count(BannedPerson)

    res = client.post(
        f"/events/{event_id}/tickets",
        json={"holder_name": "'); DROP TABLE tickets; --", "rut": "7.654.321-6"},
        headers=auth_header(token),
    )
    assert res.status_code == 201 and res.json()["holder_name"] == "'); DROP TABLE tickets; --"
    assert count(Ticket) == tickets_before + 1

    for payload in SQL_PAYLOADS:
        res = client.post("/bans", json={"rut": payload, "reason": payload}, headers=auth_header(token))
        assert res.status_code in (400, 422)  # no es un RUT valido (o excede el largo de un RUT)
    assert count(BannedPerson) == bans_before


def test_malformed_path_and_query_parameters_never_cause_a_server_error(client):
    create_user("admin_fuzz@test.cl", Role.ADMIN)
    headers = auth_header(login(client, "admin_fuzz@test.cl"))
    for path in (
        "/events/1%20OR%201=1/gates",
        "/events/99999999999999999999999/gates",
        "/events/-1/tickets",
        "/logs?limit=1;DROP TABLE access_logs",
        "/logs?limit=99999999999999999999999",
    ):
        assert client.get(path, headers=headers).status_code < 500, path


def test_out_of_range_qr_fields_are_rejected_not_crashed(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_fuzz@test.cl", event_id)
    contents, _ = scanner.read(phone.qr())
    payload = scanner.validate_payload(contents, gate_id)
    for bad in (
        {"issued_at": 2**40},
        {"issued_at": -1},
        {"gate_id": 2**63},
        {"credential_core": "A" * 5000},
        {"issuer_sig": "<script>alert(1)</script>"},
        {"nonce": "' OR 1=1 --"},
    ):
        res = client.post("/qr/validate", json={**payload, **bad}, headers=scanner.headers)
        assert res.status_code == 422, bad


# --- A07 Autenticacion y sesiones ------------------------------------------------------


def forge(claims: dict, key: str | None = None, algorithm: str = "HS256") -> str:
    now = datetime.now(timezone.utc)
    base = {"sub": "admin_jwt@test.cl", "ver": 0, "iss": JWT_ISSUER, "aud": JWT_AUDIENCE, "iat": now, "exp": now + timedelta(hours=1)}
    return jwt.encode({**base, **claims}, key or settings.jwt_secret, algorithm=algorithm)


def test_forged_or_tampered_tokens_are_rejected(client):
    create_user("admin_jwt@test.cl", Role.ADMIN)
    assert client.get("/auth/me", headers=auth_header(forge({}))).status_code == 200  # control: el valido pasa

    unsigned = jwt.encode({"sub": "admin_jwt@test.cl", "ver": 0}, key=None, algorithm="none")
    bad_tokens = [
        unsigned,  # "alg": "none"
        forge({}, key="otro-secreto-que-no-es-el-del-servidor-1234"),  # firmado por otro
        forge({"exp": datetime.now(timezone.utc) - timedelta(minutes=5)}),  # vencido
        forge({"aud": "otra-app"}),  # emitido para otra audiencia
        forge({"ver": 1}),  # version de sesion que no calza
        forge({"sub": "' OR 1=1 --"}),
        "no-es-un-jwt",
    ]
    for token in bad_tokens:
        assert client.get("/auth/me", headers=auth_header(token)).status_code == 401, token


def test_password_change_closes_open_sessions(client):
    create_user("admin_pw@test.cl", Role.ADMIN)
    create_user("guard_pw@test.cl", Role.GUARD)
    admin = auth_header(login(client, "admin_pw@test.cl"))
    old_session = auth_header(login(client, "guard_pw@test.cl"))
    guard_id = next(u["id"] for u in client.get("/users", headers=admin).json() if u["email"] == "guard_pw@test.cl")

    res = client.patch(f"/users/{guard_id}", json={"password": "otra-clave-larga-2026"}, headers=admin)
    assert res.status_code == 200
    assert client.get("/auth/me", headers=old_session).status_code == 401
    assert login(client, "guard_pw@test.cl", "otra-clave-larga-2026")


def test_login_does_not_reveal_which_accounts_exist(client):
    create_user("existe@test.cl", Role.GUARD)
    wrong_password = client.post("/auth/login", data={"username": "existe@test.cl", "password": "incorrecta-123"})
    no_account = client.post("/auth/login", data={"username": "no-existe@test.cl", "password": "incorrecta-123"})
    assert wrong_password.status_code == no_account.status_code == 401
    assert wrong_password.json() == no_account.json()


def test_legacy_bcrypt_hash_still_works_and_is_upgraded_to_argon2(client):
    db = SessionLocal()
    legacy = bcrypt.hashpw(DEFAULT_PASSWORD.encode(), bcrypt.gensalt()).decode()
    db.add(User(email="legado@test.cl", full_name="Legado", role=Role.GUARD, password_hash=legacy))
    db.commit()
    db.close()

    login(client, "legado@test.cl")
    db = SessionLocal()
    assert db.query(User).filter(User.email == "legado@test.cl").one().password_hash.startswith("$argon2id$")
    db.close()


@pytest.mark.parametrize("password", ["corta", "aaaaaaaaaaaaaaaa", "x" * 200])
def test_password_policy(client, password):
    ensure_user("admin_policy@test.cl", Role.ADMIN)
    headers = auth_header(login(client, "admin_policy@test.cl"))
    res = client.post(
        "/users",
        json={"email": f"nuevo{len(password)}@test.cl", "full_name": "Nuevo", "password": password, "role": "guard"},
        headers=headers,
    )
    assert res.status_code == 422


# --- A01 Control de acceso -------------------------------------------------------------


def test_admin_cannot_remove_own_admin_rights_or_leave_no_admin(client):
    create_user("unico_admin@test.cl", Role.ADMIN)
    token = login(client, "unico_admin@test.cl")
    headers = auth_header(token)
    me = client.get("/auth/me", headers=headers).json()

    assert client.patch(f"/users/{me['id']}", json={"role": "guard"}, headers=headers).status_code == 400
    assert client.patch(f"/users/{me['id']}", json={"is_active": False}, headers=headers).status_code == 400
    assert client.delete(f"/users/{me['id']}", headers=headers).status_code == 400


def test_guard_cannot_use_admin_endpoints(client):
    create_user("guard_priv@test.cl", Role.GUARD)
    headers = auth_header(login(client, "guard_priv@test.cl"))
    assert client.get("/users", headers=headers).status_code == 403
    assert client.post("/bans", json={"rut": "7.654.321-6", "reason": "x"}, headers=headers).status_code == 403
    assert client.post("/users", json={"email": "x@test.cl", "full_name": "X", "password": "clave-muy-larga-1", "role": "admin"}, headers=headers).status_code == 403


# --- A05 Configuracion -----------------------------------------------------------------


def test_security_headers_on_every_response(client):
    for res in (client.get("/health"), client.get("/users"), client.post("/auth/login", data={})):
        assert res.headers["x-content-type-options"] == "nosniff"
        assert res.headers["x-frame-options"] == "DENY"
        assert res.headers["referrer-policy"] == "no-referrer"
        assert "default-src 'none'" in res.headers["content-security-policy"]
        assert res.headers["cache-control"] == "no-store"
        # La cabecera "server" la agrega uvicorn fuera de la app: se arranca con --no-server-header.
        assert "server" not in res.headers


def test_api_docs_are_disabled_by_default(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_oversized_requests_are_rejected(client):
    big = "x" * (settings.max_request_bytes + 1)
    assert client.post("/auth/login", content=big, headers={"content-type": "text/plain"}).status_code == 413

    def chunks():  # sin Content-Length (transferencia por partes)
        for _ in range(settings.max_request_bytes // 10_000 + 2):
            yield b"x" * 10_000

    assert client.post("/qr/sync", content=chunks(), headers={"content-type": "application/json"}).status_code == 413


def test_weak_or_example_jwt_secret_is_refused_at_startup():
    from pydantic import ValidationError

    from app.config import Settings

    for secret in ("change-me-please-super-secret", "corto"):
        with pytest.raises(ValidationError):
            Settings(jwt_secret=secret)


# --- A09 Registro de eventos de seguridad ----------------------------------------------


def test_security_events_are_logged_without_secrets_or_forged_lines(client, caplog):
    caplog.set_level(logging.INFO, logger="security")
    logging.getLogger("security").propagate = True
    try:
        client.post("/auth/login", data={"username": "falso@test.cl\nevent=login_ok", "password": "secreta-no-va-al-log"})
    finally:
        logging.getLogger("security").propagate = False
    lines = [r.getMessage() for r in caplog.records if r.name == "security"]
    assert any("event=login_failed" in line for line in lines)
    assert all("secreta-no-va-al-log" not in line for line in lines)
    assert all("\n" not in line for line in lines)  # un dato del usuario no inventa otra linea de log
