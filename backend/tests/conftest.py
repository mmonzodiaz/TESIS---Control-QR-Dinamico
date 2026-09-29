import os
import pathlib
import shutil

TEST_DB_PATH = pathlib.Path(__file__).parent / "test_control_acceso.db"
# Registro Civil simulado propio de los tests (su clave privada la usan helpers.issue_identity).
TEST_ISSUER_DIR = pathlib.Path(__file__).parent / ".issuer"
# Deben fijarse ANTES de importar app.config / app.main: pydantic-settings los lee una sola vez.
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["QR_TTL_SECONDS"] = "2"
os.environ["ENABLE_STATIC_BASELINE"] = "1"  # para tests/test_attack_experiment.py
os.environ["ISSUER_PUBLIC_KEY_FILE"] = str(TEST_ISSUER_DIR / "issuer_public.key")
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
def _reset_rate_limiter():
    # Todos los tests comparten la IP "testclient"; sin esto el limite de /tickets/claim
    # se agotaria entre tests.
    from app.deps import claim_rate_limiter
    from registro_civil.app import enroll_rate_limiter

    claim_rate_limiter.reset()
    enroll_rate_limiter.reset()
    yield
