import { describe, expect, it } from "vitest";
import vectors from "../../backend/tests/vectors/qr-v1.json";
import {
  b64decode,
  base45Decode,
  base45Encode,
  buildQr,
  checkIdentity,
  CredentialError,
  decodeQr,
  newSecretKey,
  parseCredentialFile,
  toHex,
  validatePayload,
} from "./credential";

// Mismos vectores que backend/tests/test_credential.py: si el backend cambia el formato, esto falla.
const { credential, identity } = parseCredentialFile(vectors.credential);
const eventSecret = b64decode(vectors.event_secret);
const issuerPublic = b64decode(vectors.issuer_public);

describe("base45", () => {
  it("coincide con los ejemplos del RFC 9285", () => {
    for (const [text, encoded] of vectors.base45) {
      expect(base45Encode(new TextEncoder().encode(text))).toBe(encoded);
      expect(new TextDecoder().decode(base45Decode(encoded))).toBe(text);
    }
  });
});

describe("QR generado por el telefono", () => {
  it("produce exactamente el mismo QR que el backend con las mismas claves", () => {
    const qr = buildQr({
      credential,
      deviceSecret: b64decode(vectors.device_secret),
      eventId: vectors.event_id,
      ticketId: vectors.ticket_id,
      eventPublic: b64decode(vectors.event_public),
      issuedAt: vectors.issued_at,
      nonce: Uint8Array.from(vectors.nonce_hex.match(/../g)!.map((h) => parseInt(h, 16))),
      ephemeralSecret: b64decode(vectors.ephemeral_secret),
    });
    expect(qr).toBe(vectors.qr);
  });

  it("lee la cedula importada con nombre y RUT firmados", () => {
    expect(identity.rut).toBe(vectors.core.rut);
    expect(identity.name).toBe(vectors.core.name);
    expect(identity.issuedAt).toBe(vectors.core.issued_at);
  });

  it("rechaza una cedula cuya foto fue cambiada", () => {
    const tampered = { ...vectors.credential, photo: btoa("otra foto") };
    expect(() => parseCredentialFile(tampered)).toThrow(CredentialError);
  });
});

describe("escaner del guardia", () => {
  it("descifra el QR del backend, verifica la firma y entrega la foto", () => {
    const contents = decodeQr(vectors.qr, eventSecret);
    const shown = checkIdentity(contents, issuerPublic);
    expect(shown.name).toBe("José Muñoz");
    expect(contents.photo).toEqual(credential.photo);

    const payload = validatePayload(contents, 3);
    expect(payload).toMatchObject({ gate_id: 3, ticket_id: 42, nonce: vectors.nonce_hex, issued_at: vectors.issued_at });
    // Al servidor no viaja la foto.
    expect(JSON.stringify(payload)).not.toContain(vectors.credential.photo.slice(0, 40));
  });

  it("no puede leer un QR cifrado para otro evento", () => {
    expect(() => decodeQr(vectors.qr, newSecretKey())).toThrow(/otro evento/);
  });

  it("detecta una cedula firmada por alguien que no es el Registro Civil", () => {
    const contents = decodeQr(vectors.qr, eventSecret);
    expect(() => checkIdentity(contents, b64decode(vectors.device_public))).toThrow(/emisor/);
  });

  it("detecta una foto cambiada dentro de un QR", () => {
    const contents = decodeQr(vectors.qr, eventSecret);
    const photo = contents.photo.slice();
    photo[0] ^= 1;
    expect(() => checkIdentity({ ...contents, photo }, issuerPublic)).toThrow(/foto/);
  });

  it("cada QR es distinto aunque se genere en el mismo segundo", () => {
    const params = {
      credential,
      deviceSecret: b64decode(vectors.device_secret),
      eventId: 7,
      ticketId: 42,
      eventPublic: b64decode(vectors.event_public),
      issuedAt: vectors.issued_at,
    };
    const a = decodeQr(buildQr(params), eventSecret);
    const b = decodeQr(buildQr(params), eventSecret);
    expect(toHex(a.nonce)).not.toBe(toHex(b.nonce));
  });
});
