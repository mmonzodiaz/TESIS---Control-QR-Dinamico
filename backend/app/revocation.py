"""Lista de cedulas revocadas del Registro Civil (ADR-14), vista desde el recinto.

El backend la baja del Registro Civil, verifica la firma del emisor y la guarda en memoria unos
segundos (settings.revocation_refresh_seconds) para no consultarla en cada escaneo. Si el Registro
Civil no responde, sigue usando la ultima lista valida: una revocacion nueva tarda en aplicar lo que
dure la caida (limitacion declarada en docs/security-guarantees.md).
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from .config import settings
from .credential import CredentialError, verify_revocation_list
from .issuer import issuer_public_key

log = logging.getLogger(__name__)


def fetch_from_registro_civil() -> dict:
    res = httpx.get(f"{settings.registro_civil_url}/revocaciones", timeout=2.0)
    res.raise_for_status()
    return res.json()


@dataclass
class _Cache:
    ids: frozenset[str] = frozenset()
    list_issued_at: int | None = None  # fecha de la ultima lista valida (None: nunca se obtuvo)
    fetched_at: float = float("-inf")  # time.monotonic() del ultimo intento


class RevocationList:
    def __init__(self, fetch: Callable[[], dict] = fetch_from_registro_civil):
        self.fetch = fetch
        self._cache = _Cache()

    def reset(self) -> None:
        self._cache = _Cache()

    def _refresh(self) -> None:
        now = time.monotonic()
        if now - self._cache.fetched_at < settings.revocation_refresh_seconds:
            return
        self._cache.fetched_at = now
        try:
            issued_at, ids = verify_revocation_list(self.fetch(), issuer_public_key())
        except (httpx.HTTPError, CredentialError, ValueError) as exc:
            log.warning("No se pudo actualizar la lista de revocadas (%s); se usa la anterior", exc)
            return
        if self._cache.list_issued_at is None or issued_at >= self._cache.list_issued_at:
            self._cache.ids, self._cache.list_issued_at = ids, issued_at  # nunca retrocede a una lista vieja

    def snapshot(self) -> tuple[frozenset[str], int | None]:
        """(ids revocados, fecha de la lista); fecha None si nunca se pudo obtener."""
        self._refresh()
        return self._cache.ids, self._cache.list_issued_at

    def is_revoked(self, credential_id: str) -> bool:
        return credential_id in self.snapshot()[0]


revocations = RevocationList()
