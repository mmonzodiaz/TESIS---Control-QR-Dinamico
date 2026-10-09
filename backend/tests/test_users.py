"""Cobertura de /users: CRUD solo-admin y el rechazo de otros roles."""

from app.models import Role
from helpers import DEFAULT_PASSWORD, auth_header, create_user, login


def test_non_admin_cannot_list_users(client):
    create_user("guard_users@test.cl", Role.GUARD)
    create_user("guard2_users@test.cl", Role.GUARD)
    guard_token = login(client, "guard_users@test.cl")
    guard2_token = login(client, "guard2_users@test.cl")

    assert client.get("/users", headers=auth_header(guard_token)).status_code == 403
    assert client.get("/users", headers=auth_header(guard2_token)).status_code == 403


def test_admin_can_create_list_update_and_delete_user(client):
    create_user("admin_crud@test.cl", Role.ADMIN)
    admin_token = login(client, "admin_crud@test.cl")

    created = client.post(
        "/users",
        json={
            "email": "nuevo_guardia@test.cl",
            "full_name": "Nuevo Guardia",
            "password": "clave-segura-1",
            "role": "guard",
        },
        headers=auth_header(admin_token),
    )
    assert created.status_code == 201
    user_id = created.json()["id"]
    assert created.json()["is_active"] is True

    listing = client.get("/users", headers=auth_header(admin_token))
    assert any(u["id"] == user_id for u in listing.json())

    deactivated = client.patch(
        f"/users/{user_id}",
        json={"is_active": False},
        headers=auth_header(admin_token),
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    deleted = client.delete(f"/users/{user_id}", headers=auth_header(admin_token))
    assert deleted.status_code == 204

    listing_after = client.get("/users", headers=auth_header(admin_token))
    assert all(u["id"] != user_id for u in listing_after.json())


def test_cannot_create_user_with_duplicate_email(client):
    create_user("admin_dup@test.cl", Role.ADMIN)
    admin_token = login(client, "admin_dup@test.cl")
    create_user("ya_existe@test.cl", Role.GUARD)

    res = client.post(
        "/users",
        json={
            "email": "ya_existe@test.cl",
            "full_name": "Duplicado",
            "password": "clave-segura-1",
            "role": "guard",
        },
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400


def test_deactivated_user_cannot_login(client):
    create_user("admin_deact@test.cl", Role.ADMIN)
    admin_token = login(client, "admin_deact@test.cl")
    create_user("a_desactivar@test.cl", Role.GUARD)

    users = client.get("/users", headers=auth_header(admin_token)).json()
    target = next(u for u in users if u["email"] == "a_desactivar@test.cl")
    guard_token = login(client, "a_desactivar@test.cl")
    client.patch(f"/users/{target['id']}", json={"is_active": False}, headers=auth_header(admin_token))

    # Mismo 401 generico que una contrasena incorrecta: no revela que la cuenta existe.
    res = client.post("/auth/login", data={"username": "a_desactivar@test.cl", "password": DEFAULT_PASSWORD})
    assert res.status_code == 401 and res.json()["detail"] == "Credenciales inválidas"
    # Y la sesion que ya tenia abierta deja de valer en el acto.
    assert client.get("/auth/me", headers=auth_header(guard_token)).status_code == 401


def test_explicit_null_in_a_required_field_is_a_validation_error(client):
    """Un null explicito llegaba a una columna NOT NULL: IntegrityError y 500."""
    create_user("admin_null@test.cl", Role.ADMIN)
    admin_token = login(client, "admin_null@test.cl")
    create_user("guard_null@test.cl", Role.GUARD)
    target = next(u for u in client.get("/users", headers=auth_header(admin_token)).json() if u["email"] == "guard_null@test.cl")
    for field in ("role", "is_active", "full_name"):
        res = client.patch(f"/users/{target['id']}", json={field: None}, headers=auth_header(admin_token))
        assert res.status_code == 422, (field, res.text)
    # El RUT si es opcional: borrarlo con null sigue permitido.
    assert client.patch(f"/users/{target['id']}", json={"document_id": None}, headers=auth_header(admin_token)).status_code == 200
