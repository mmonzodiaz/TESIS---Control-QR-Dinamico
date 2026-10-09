import os
import secrets
import pathlib
import shutil

TEST_DB_PATH = pathlib.Path(__file__).parent / "test_control_acceso.db"
# Registro Civil simulado propio de los tests (su clave privada la usan helpers.issue_identity).
TEST_ISSUER_DIR = pathlib.Path(__file__).parent / ".issuer"
# Deben fijarse ANTES de importar app.config / app.main: pydantic-settings los lee una sola vez.
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
# Secreto propio de los tests: nunca el de .env.
os.environ["JWT_SECRET"] = secrets.token_urlsafe(48)
os.environ["QR_TTL_SECONDS"] = "2"
os.environ["ENABLE_STATIC_BASELINE"] = "1"  # para tests/test_attack_experiment.py
os.environ["ISSUER_PUBLIC_KEY_FILE"] = str(TEST_ISSUER_DIR / "issuer_public.key")
os.environ["VERIFIER_PRIVATE_KEY_FILE"] = str(TEST_ISSUER_DIR / "verifier_private.key")
os.environ["REGISTRO_CIVIL_DIR"] = str(TEST_ISSUER_DIR)  # padron del servicio registro_civil/app.py

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _cleanup_test_db():
    yield
    engine.dispose()
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    shutil.rmtree(TEST_ISSUER_DIR, ignore_errors=True)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    # Todos los tests comparten la IP "testclient" y las mismas cuentas; sin esto los limites
    # de intentos se agotarian entre tests.
    from app.routers.auth import login_account_limiter, login_account_total_limiter, login_ip_limiter
    from app.routers.qr import validate_rate_limiter
    from registro_civil.app import enroll_rate_limiter

    for limiter in (
        enroll_rate_limiter,
        login_ip_limiter,
        login_account_limiter,
        login_account_total_limiter,
        validate_rate_limiter,
    ):
        limiter.reset()
    yield


@pytest.fixture(autouse=True)
def _revocations_from_test_registro_civil():
    # El backend baja la lista de revocadas del Registro Civil de los tests (en proceso, sin red) y
    # sin cache, para que una revocacion se vea en el acto.
    from app.config import settings
    from app.revocation import revocations
    from registro_civil.app import app as registro_civil_app

    rc = TestClient(registro_civil_app)
    original_fetch, original_refresh = revocations.fetch, settings.revocation_refresh_seconds
    revocations.fetch = lambda: rc.get("/revocaciones").json()
    settings.revocation_refresh_seconds = 0
    revocations.reset()
    yield
    revocations.fetch, settings.revocation_refresh_seconds = original_fetch, original_refresh
    revocations.reset()
