// Cedula digital (simulada) y QR dinamico: mismo formato que backend/app/credential.py, fijado por
// backend/tests/vectors/qr-v1.json. El telefono genera el QR sin conexion (buildQr) con su clave de
// dispositivo; el escaner del guardia lo descifra y verifica localmente (decodeQr + checkIdentity) y
// despues consulta al servidor SIN la foto (validatePayload).
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const CORE_VERSION = 1;
const ISSUER_DOMAIN = utf8ToBytes("CA-ID-v1");
const DEVICE_DOMAIN = utf8ToBytes("CA-QR-v1");
const ENCRYPTION_INFO = utf8ToBytes("CA-QR-v1 enc");
const ENCRYPTION_AAD = utf8ToBytes("CA1");
const QR_PREFIX = "CA1:";
const ZERO_NONCE = new Uint8Array(12); // seguro: la clave de cifrado es nueva en cada QR
const BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export class CredentialError extends Error {}

// --- Codificacion -------------------------------------------------------------------

export function b64encode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function b64decode(text: string, expectedLength?: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    throw new CredentialError("base64 invalido");
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new CredentialError(`se esperaban ${expectedLength} bytes`);
  }
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** RFC 9285: aprovecha el modo alfanumerico del QR. */
export function base45Encode(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < data.length; i += 2) {
    let n = data[i] * 256 + data[i + 1];
    const c = n % 45;
    n = Math.floor(n / 45);
    out += BASE45_ALPHABET[c] + BASE45_ALPHABET[n % 45] + BASE45_ALPHABET[Math.floor(n / 45)];
  }
  if (data.length % 2) {
    const last = data[data.length - 1];
    out += BASE45_ALPHABET[last % 45] + BASE45_ALPHABET[Math.floor(last / 45)];
  }
  return out;
}

export function base45Decode(text: string): Uint8Array {
  const values = [...text].map((ch) => {
    const v = BASE45_ALPHABET.indexOf(ch);
    if (v < 0) throw new CredentialError("base45 invalido");
    return v;
  });
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 3) {
    const chunk = values.slice(i, i + 3);
    if (chunk.length === 3) {
      const n = chunk[0] + chunk[1] * 45 + chunk[2] * 2025;
      if (n > 0xffff) throw new CredentialError("base45 invalido");
      out.push(n >> 8, n & 0xff);
    } else if (chunk.length === 2) {
      const n = chunk[0] + chunk[1] * 45;
      if (n > 0xff) throw new CredentialError("base45 invalido");
      out.push(n);
    } else {
      throw new CredentialError("base45 invalido");
    }
  }
  return Uint8Array.from(out);
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function u16(n: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, n);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// --- Credencial de identidad --------------------------------------------------------------

export interface IdentityCore {
  rut: string; // normalizado, ej. 12345678K
  name: string;
  photoSha256: Uint8Array;
  issuedAt: number;
}

export interface IdentityCredential {
  core: Uint8Array;
  issuerSig: Uint8Array;
  photo: Uint8Array;
}

export function parseCore(data: Uint8Array): IdentityCore {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint8(0) !== CORE_VERSION) throw new Error();
    const issuedAt = view.getUint32(1);
    let pos = 5;
    const rutLen = data[pos];
    const rut = new TextDecoder("ascii", { fatal: true }).decode(data.slice(pos + 1, pos + 1 + rutLen));
    pos += 1 + rutLen;
    const nameLen = data[pos];
    const name = new TextDecoder("utf-8", { fatal: true }).decode(data.slice(pos + 1, pos + 1 + nameLen));
    pos += 1 + nameLen;
    const photoSha256 = data.slice(pos, pos + 32);
    if (photoSha256.length !== 32 || pos + 32 !== data.length) throw new Error();
    return { rut, name, photoSha256, issuedAt };
  } catch {
    throw new CredentialError("credencial mal formada");
  }
}

/** Lee el archivo que entrega el Registro Civil (simulado). No sale del telefono. */
export function parseCredentialFile(json: unknown): { credential: IdentityCredential; identity: IdentityCore } {
  const data = json as Record<string, unknown>;
  if (!data || data.format !== "cedula-sim-v1") throw new CredentialError("No es una cedula digital de este sistema");
  const credential = {
    core: b64decode(String(data.core)),
    issuerSig: b64decode(String(data.issuer_sig), 64),
    photo: b64decode(String(data.photo)),
  };
  const identity = parseCore(credential.core);
  if (!sameBytes(sha256(credential.photo), identity.photoSha256)) {
    throw new CredentialError("La foto no corresponde a la cedula");
  }
  return { credential, identity };
}

export function credentialToJson(c: IdentityCredential) {
  return { format: "cedula-sim-v1", core: b64encode(c.core), issuer_sig: b64encode(c.issuerSig), photo: b64encode(c.photo) };
}

// --- QR ------------------------------------------------------------------------------

export interface QRContents {
  eventId: number;
  ticketId: number;
  nonce: Uint8Array;
  issuedAt: number;
  deviceSig: Uint8Array;
  core: Uint8Array;
  issuerSig: Uint8Array;
  photo: Uint8Array;
}

function deviceMessage(core: Uint8Array, eventId: number, ticketId: number, nonce: Uint8Array, issuedAt: number) {
  return concatBytes(DEVICE_DOMAIN, sha256(core), u32(eventId), u32(ticketId), nonce, u32(issuedAt));
}

function encryptionKey(shared: Uint8Array, ephemeralPublic: Uint8Array, eventPublic: Uint8Array) {
  return hkdf(sha256, shared, undefined, concatBytes(ENCRYPTION_INFO, ephemeralPublic, eventPublic), 32);
}

export function newSecretKey(): Uint8Array {
  return randomBytes(32);
}

export function devicePublicKey(deviceSecret: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(deviceSecret);
}

export interface BuildQrParams {
  credential: IdentityCredential;
  deviceSecret: Uint8Array;
  eventId: number;
  ticketId: number;
  eventPublic: Uint8Array;
  issuedAt: number;
  /** Solo para tests (vectores): en uso real son aleatorios. */
  nonce?: Uint8Array;
  ephemeralSecret?: Uint8Array;
}

/** Lo que hace el telefono cada 45 s, sin conexion: la foto, el nombre y el RUT van dentro del QR. */
export function buildQr(p: BuildQrParams): string {
  const nonce = p.nonce ?? randomBytes(16);
  const deviceSig = ed25519.sign(deviceMessage(p.credential.core, p.eventId, p.ticketId, nonce, p.issuedAt), p.deviceSecret);
  const plaintext = concatBytes(
    u32(p.eventId),
    u32(p.ticketId),
    nonce,
    u32(p.issuedAt),
    deviceSig,
    u16(p.credential.core.length),
    p.credential.core,
    p.credential.issuerSig,
    p.credential.photo,
  );
  const ephemeralSecret = p.ephemeralSecret ?? randomBytes(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const key = encryptionKey(x25519.getSharedSecret(ephemeralSecret, p.eventPublic), ephemeralPublic, p.eventPublic);
  const ciphertext = chacha20poly1305(key, ZERO_NONCE, ENCRYPTION_AAD).encrypt(plaintext);
  return QR_PREFIX + base45Encode(concatBytes(ephemeralPublic, ciphertext));
}

/** Lo que hace el escaner del personal: descifra con la clave privada del evento. */
export function decodeQr(qrText: string, eventSecret: Uint8Array): QRContents {
  if (!qrText.startsWith(QR_PREFIX)) throw new CredentialError("No es un QR de este sistema");
  const raw = base45Decode(qrText.slice(QR_PREFIX.length));
  if (raw.length < 48) throw new CredentialError("QR truncado");
  const ephemeralPublic = raw.slice(0, 32);
  let plaintext: Uint8Array;
  try {
    const eventPublic = x25519.getPublicKey(eventSecret);
    const key = encryptionKey(x25519.getSharedSecret(eventSecret, ephemeralPublic), ephemeralPublic, eventPublic);
    plaintext = chacha20poly1305(key, ZERO_NONCE, ENCRYPTION_AAD).decrypt(raw.slice(32));
  } catch {
    throw new CredentialError("No se pudo descifrar (QR alterado o de otro evento)");
  }
  try {
    const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
    const eventId = view.getUint32(0);
    const ticketId = view.getUint32(4);
    let pos = 8;
    const nonce = plaintext.slice(pos, pos + 16);
    pos += 16;
    const issuedAt = view.getUint32(pos);
    pos += 4;
    const deviceSig = plaintext.slice(pos, pos + 64);
    pos += 64;
    const coreLen = view.getUint16(pos);
    pos += 2;
    const core = plaintext.slice(pos, pos + coreLen);
    pos += coreLen;
    const issuerSig = plaintext.slice(pos, pos + 64);
    pos += 64;
    const photo = plaintext.slice(pos);
    if (core.length !== coreLen || issuerSig.length !== 64 || photo.length === 0) throw new Error();
    return { eventId, ticketId, nonce, issuedAt, deviceSig, core, issuerSig, photo };
  } catch {
    throw new CredentialError("QR mal formado");
  }
}

/** Verificacion local: la credencial la firmo el Registro Civil y la foto es la de la credencial. */
export function checkIdentity(contents: QRContents, issuerPublic: Uint8Array): IdentityCore {
  let issuerOk = false;
  try {
    issuerOk = ed25519.verify(contents.issuerSig, concatBytes(ISSUER_DOMAIN, contents.core), issuerPublic);
  } catch {
    issuerOk = false;
  }
  if (!issuerOk) throw new CredentialError("Firma del emisor invalida: la cedula no la emitio el Registro Civil");
  const core = parseCore(contents.core);
  if (!sameBytes(sha256(contents.photo), core.photoSha256)) {
    throw new CredentialError("La foto no corresponde a la cedula (fue cambiada)");
  }
  return core;
}

/** Lo que el escaner manda al servidor: todo menos la foto. */
export function validatePayload(contents: QRContents, gateId: number | null) {
  return {
    gate_id: gateId,
    ticket_id: contents.ticketId,
    nonce: toHex(contents.nonce),
    issued_at: contents.issuedAt,
    device_sig: b64encode(contents.deviceSig),
    credential_core: b64encode(contents.core),
    issuer_sig: b64encode(contents.issuerSig),
  };
}

export function photoDataUrl(photo: Uint8Array): string {
  return `data:image/webp;base64,${b64encode(photo)}`;
}
