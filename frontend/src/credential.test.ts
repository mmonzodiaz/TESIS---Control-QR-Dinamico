import { describe, expect, it } from "vitest";
import vectors from "../../backend/tests/vectors/qr-v2.json";
import {
  b64decode,
  base45Decode,
  base45Encode,
  buildQr,
  checkQr,
  CredentialError,
  decodeQr,
  newSecretKey,
  parseCredentialFile,
  toHex,
  validatePayload,
} from "./credential";

// Mismos vectores que backend/tests/test_credential.py: si el backend cambia el formato, esto falla.
const { credential, identity } = parseCredentialFile(vectors.credential);
const verifierSecret = b64decode(vectors.verifier_secret);
const issuerPublic = b64decode(vectors.issuer_public);
const nonce = Uint8Array.from(vectors.nonce_hex.match(/../g)!.map((h) => parseInt(h, 16)));

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
      verifierPublic: b64decode(vectors.verifier_public),
      issuedAt: vectors.issued_at,
      nonce,
      ephemeralSecret: b64decode(vectors.ephemeral_secret),
    });
    expect(qr).toBe(vectors.qr);
  });

  it("lee la cedula con nombre, RUT y la clave del telefono firmados", () => {
    expect(identity.rut).toBe(vectors.core.rut);
    expect(identity.name).toBe(vectors.core.name);
    expect(identity.issuedAt).toBe(vectors.core.issued_at);
    expect(identity.devicePublic).toEqual(b64decode(vectors.device_public));
  });

  it("rechaza una cedula cuya foto fue cambiada", () => {
    const tampered = { ...vectors.credential, photo: btoa("otra foto") };
    expect(() => parseCredentialFile(tampered)).toThrow(CredentialError);
  });
});

describe("lector del guardia", () => {
  it("descifra el QR del backend, verifica las firmas y entrega la foto", () => {
    const contents = decodeQr(vectors.qr, verifierSecret);
    const shown = checkQr(contents, issuerPublic);
    expect(shown.name).toBe("José Muñoz");
    expect(contents.photo).toEqual(credential.photo);

    const payload = validatePayload(contents, 3);
    expect(payload).toMatchObject({ gate_id: 3, nonce: vectors.nonce_hex, issued_at: vectors.issued_at });
    // Al servidor no viaja la foto.
    expect(JSON.stringify(payload)).not.toContain(vectors.credential.photo.slice(0, 40));
  });

  it("un lector no autorizado no puede leer el QR", () => {
    expect(() => decodeQr(vectors.qr, newSecretKey())).toThrow(/no autorizado/);
  });

  it("detecta una cedula firmada por alguien que no es el Registro Civil", () => {
    const contents = decodeQr(vectors.qr, verifierSecret);
    expect(() => checkQr(contents, b64decode(vectors.device_public))).toThrow(/emisor/);
  });

  it("detecta un QR generado por otro telefono (cedula copiada)", () => {
    const clone = buildQr({
      credential,
      deviceSecret: newSecretKey(),
      verifierPublic: b64decode(vectors.verifier_public),
      issuedAt: vectors.issued_at,
    });
    expect(() => checkQr(decodeQr(clone, verifierSecret), issuerPublic)).toThrow(/teléfono/);
  });

  it("detecta una foto cambiada dentro de un QR", () => {
    const contents = decodeQr(vectors.qr, verifierSecret);
    const photo = contents.photo.slice();
    photo[0] ^= 1;
    expect(() => checkQr({ ...contents, photo }, issuerPublic)).toThrow(/foto/);
  });

  it("cada QR es distinto aunque se genere en el mismo segundo", () => {
    const params = {
      credential,
      deviceSecret: b64decode(vectors.device_secret),
      verifierPublic: b64decode(vectors.verifier_public),
      issuedAt: vectors.issued_at,
    };
    const a = decodeQr(buildQr(params), verifierSecret);
    const b = decodeQr(buildQr(params), verifierSecret);
    expect(toHex(a.nonce)).not.toBe(toHex(b.nonce));
  });
});
