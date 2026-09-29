"""Emuladores del telefono del asistente y del escaner del guardia, para tests y experimentos.

Hacen lo mismo que frontend/src/credential.ts (mismo formato, fijado por tests/vectors/qr-v1.json):
el telefono genera el QR sin conexion con su credencial y su clave; el escaner lo descifra, verifica
la firma del Registro Civil y la foto localmente, y luego consulta /qr/validate SIN la foto.
"""

from dataclasses import dataclass, field

from app.credential import (
    CredentialError,
    IdentityCredential,
    b64d,
    b64e,
    build_qr,
    check_identity,
    decode_qr,
    ed25519_public,
    new_secret_key,
)


@dataclass
class Phone:
    credential: IdentityCredential
    device_secret: bytes = field(default_factory=new_secret_key)
    session: str | None = None
    params: dict | None = None

    def claim_payload(self, rut: str, code: str) -> dict:
        return {
            "rut": rut,
            "code": code,
            "device_public_key": b64e(ed25519_public(self.device_secret)),
            "credential_core": b64e(self.credential.core),
            "issuer_sig": b64e(self.credential.issuer_sig),
        }

    def claim(self, client, rut: str, code: str):
        res = client.post("/tickets/claim", json=self.claim_payload(rut, code))
        if res.status_code == 200:
            self.session = res.json()["access_token"]
            self.params = res.json()["qr"]
        return res

    def qr(self, issued_at: int | None = None, nonce: bytes | None = None) -> str:
        """QR que muestra la pantalla. `issued_at` por defecto: reloj del servidor (en los
        experimentos, el reloj simulado)."""
        from app.models import unix_now

        assert self.params is not None, "la entrada no esta activada en este telefono"
        return build_qr(
            self.credential,
            self.device_secret,
            self.params["event_id"],
            self.params["ticket_id"],
            b64d(self.params["event_public_key"]),
            issued_at if issued_at is not None else unix_now(),
            nonce=nonce,
        )


class Scanner:
    def __init__(self, client, guard_token: str, event_id: int):
        self.client = client
        self.headers = {"Authorization": f"Bearer {guard_token}"}
        res = client.get(f"/events/{event_id}/verifier", headers=self.headers)
        res.raise_for_status()
        keys = res.json()
        self.event_id = event_id
        self.event_secret = b64d(keys["event_private_key"])
        self.issuer_public = b64d(keys["issuer_public_key"])

    def read(self, qr: str):
        """Solo la parte local. Lanza CredentialError si el QR no es legible o no es autentico."""
        contents = decode_qr(qr, self.event_secret)
        return contents, check_identity(contents, self.issuer_public)

    @staticmethod
    def validate_payload(contents, gate_id: int | None) -> dict:
        return {
            "gate_id": gate_id,
            "ticket_id": contents.ticket_id,
            "nonce": contents.nonce.hex(),
            "issued_at": contents.issued_at,
            "device_sig": b64e(contents.device_sig),
            "credential_core": b64e(contents.core),
            "issuer_sig": b64e(contents.issuer_sig),
        }

    def scan(self, qr: str, gate_id: int | None = None) -> dict:
        """Lectura local + consulta en linea. Devuelve la respuesta del servidor mas lo que el
        guardia ve en pantalla (`shown`: nombre, RUT y foto que vienen firmados en el QR)."""
        try:
            contents, identity = self.read(qr)
        except CredentialError as exc:
            return {"granted": False, "reason": "invalid", "local_error": str(exc), "shown": None}
        res = self.client.post("/qr/validate", json=self.validate_payload(contents, gate_id), headers=self.headers)
        res.raise_for_status()
        return {**res.json(), "shown": {"name": identity.name, "rut": identity.rut, "photo": contents.photo}}
