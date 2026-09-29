"""Endurecimiento HTTP comun al backend del recinto y al Registro Civil simulado (OWASP ASVS V14,
OWASP Secure Headers Project).

Middlewares ASGI puros (no leen el cuerpo a memoria antes de tiempo):
- SecurityHeadersMiddleware: cabeceras de seguridad en toda respuesta.
- MaxBodySizeMiddleware: rechaza con 413 los cuerpos mas grandes que el limite, tanto si declaran
  Content-Length como si llegan por partes (chunked).
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Una API JSON no carga nada: CSP que prohibe todo y que nadie la incruste en un iframe.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
# Swagger UI (/docs), solo si se habilita: carga sus scripts y estilos desde jsDelivr.
_DOCS_CSP = (
    "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
    "connect-src 'self'; frame-ancestors 'none'"
)
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

_BASE_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"cross-origin-resource-policy", b"same-origin"),
    # Las respuestas llevan datos personales (RUT, nombres, historial): que ningun cache las guarde.
    (b"cache-control", b"no-store"),
]
_HSTS = (b"strict-transport-security", b"max-age=31536000; includeSubDomains")


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        csp = _DOCS_CSP if path.startswith(_DOCS_PATHS) else _API_CSP
        https = scope.get("scheme") == "https"

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"server"]
                present = {k.lower() for k, _ in headers}
                extra = [*_BASE_HEADERS, (b"content-security-policy", csp.encode())]
                if https:  # HSTS solo tiene sentido (y solo se respeta) sobre HTTPS
                    extra.append(_HSTS)
                headers += [(k, v) for k, v in extra if k not in present]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class _BodyTooLarge(Exception):
    pass


class MaxBodySizeMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope.get("headers", [])).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > self.max_bytes):
            await _reject_too_large(send)
            return

        received = 0
        started = False  # la app ya empezo a responder
        rejected = False  # ya respondimos 413: lo que la app intente enviar despues se descarta

        async def limited_receive() -> Message:
            nonlocal received, rejected
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Se responde aqui mismo: FastAPI convierte cualquier error al leer el cuerpo en un
                    # 400 generico, y el cliente debe saber que el problema es el tamano.
                    if not started and not rejected:
                        rejected = True
                        await _reject_too_large(send)
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if rejected:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            pass


async def _reject_too_large(send: Send) -> None:
    body = '{"detail":"La solicitud es demasiado grande"}'.encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})
