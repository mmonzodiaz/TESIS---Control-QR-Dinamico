"""Registro de eventos de seguridad (OWASP ASVS V7, OWASP Logging Cheat Sheet).

Una linea por evento en el logger "security": que paso, a quien y desde donde, sin secretos
(nunca contrasenas, tokens ni claves) y sin el RUT completo. Distinto del historial de accesos
(AccessLog), que es de la puerta; esto es de la cuenta y la administracion.
"""

import logging

from fastapi import Request

log = logging.getLogger("security")
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s SECURITY %(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False


def client_ip(request: Request | None) -> str:
    return request.client.host if request is not None and request.client else "-"


def _clean(value: object) -> str:
    # Sin saltos de linea ni comillas: que un dato del usuario no pueda falsificar otra linea del log.
    return str(value).replace("\n", " ").replace("\r", " ").replace('"', "'")[:200]


def audit(event: str, request: Request | None = None, **fields: object) -> None:
    parts = [f"event={event}", f"ip={client_ip(request)}"]
    parts += [f'{key}="{_clean(value)}"' for key, value in fields.items()]
    log.info(" ".join(parts))
