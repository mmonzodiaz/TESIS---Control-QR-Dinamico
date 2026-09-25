import os
import pathlib

TEST_DB_PATH = pathlib.Path(__file__).parent / "test_control_acceso.db"
# Deben fijarse ANTES de importar app.config / app.main: pydantic-settings los lee una sola vez.
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["QR_TTL_SECONDS"] = "2"

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


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    # Todos los tests comparten la IP "testclient"; sin esto el limite de /tickets/claim
    # se agotaria entre tests.
    from app.deps import claim_rate_limiter

    claim_rate_limiter.reset()
    yield
