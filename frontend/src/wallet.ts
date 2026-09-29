// "App" de cedula digital del telefono: guarda la cedula (con foto) y la clave del dispositivo
// cifradas con un PIN, como la app de Identificacion Digital. Nada de esto sale del telefono.
//
// Limitaciones del prototipo (declaradas en docs/security-guarantees.md):
// - La app real guarda las claves en el hardware seguro del telefono y es el hardware el que
//   limita los intentos de PIN. Aqui todo vive en localStorage: el bloqueo por intentos lo aplica
//   la pagina, y quien copie el almacenamiento podria probar los 10^6 PIN fuera de ella. PBKDF2 solo
//   encarece cada intento.
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Attendee, QRParams } from "./api";
import {
  b64decode,
  b64encode,
  credentialToJson,
  newSecretKey,
  parseCredentialFile,
  type IdentityCore,
  type IdentityCredential,
} from "./credential";

const WALLET_KEY = "control-acceso-billetera";
const PIN_ATTEMPTS_KEY = "control-acceso-pin-intentos";
const SESSION_KEY = "control-acceso-entrada";
const QR_PARAMS_KEY = "control-acceso-entrada-qr";
// Version anterior (cedula importada desde un archivo, sin cifrar): se borra si aparece.
const LEGACY_KEYS = ["control-acceso-cedula", "control-acceso-dispositivo"];

export const PIN_LENGTH = 6;
const PBKDF2_ITERATIONS = 100_000; // ~1 s en un telefono de gama media
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 60_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // modo privado: dura mientras la pestana este abierta
  }
}

// --- Billetera cifrada con el PIN ----------------------------------------------------------

export interface UnlockedWallet {
  credential: IdentityCredential;
  identity: IdentityCore;
  deviceSecret: Uint8Array;
}

export interface SealedWallet {
  v: 1;
  iterations: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export class WrongPinError extends Error {}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

async function pinKey(pin: string, salt: Uint8Array, iterations: number) {
  return pbkdf2Async(sha256, utf8ToBytes(pin), salt, { c: iterations, dkLen: 32 });
}

export async function sealWallet(pin: string, wallet: UnlockedWallet, iterations = PBKDF2_ITERATIONS): Promise<SealedWallet> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const plaintext = utf8ToBytes(
    JSON.stringify({ credential: credentialToJson(wallet.credential), device_secret: b64encode(wallet.deviceSecret) }),
  );
  const ciphertext = chacha20poly1305(await pinKey(pin, salt, iterations), nonce).encrypt(plaintext);
  return { v: 1, iterations, salt: b64encode(salt), nonce: b64encode(nonce), ciphertext: b64encode(ciphertext) };
}

export async function openWallet(pin: string, sealed: SealedWallet): Promise<UnlockedWallet> {
  let plaintext: Uint8Array;
  try {
    const key = await pinKey(pin, b64decode(sealed.salt), sealed.iterations);
    plaintext = chacha20poly1305(key, b64decode(sealed.nonce)).decrypt(b64decode(sealed.ciphertext));
  } catch {
    throw new WrongPinError("PIN incorrecto");
  }
  const data = JSON.parse(new TextDecoder().decode(plaintext));
  const { credential, identity } = parseCredentialFile(data.credential);
  return { credential, identity, deviceSecret: b64decode(data.device_secret, 32) };
}

/** Recien enrolado: la cedula que entrego el Registro Civil + una clave de dispositivo nueva. */
export function newWallet(credentialJson: unknown): UnlockedWallet {
  const { credential, identity } = parseCredentialFile(credentialJson);
  return { credential, identity, deviceSecret: newSecretKey() };
}

export function loadSealedWallet(): SealedWallet | null {
  for (const key of LEGACY_KEYS) write(key, null);
  const raw = read(WALLET_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SealedWallet;
  } catch {
    return null;
  }
}

export function storeSealedWallet(sealed: SealedWallet) {
  write(WALLET_KEY, JSON.stringify(sealed));
  write(PIN_ATTEMPTS_KEY, null);
}

/** Borra la cedula y la clave del dispositivo de este telefono (hay que volver a enrolarse). */
export function deleteWallet() {
  write(WALLET_KEY, null);
  write(PIN_ATTEMPTS_KEY, null);
  clearSession();
}

// --- Intentos de PIN ---------------------------------------------------------------------

export interface PinAttempts {
  failures: number;
  lockedUntil: number; // epoch ms; 0 si no esta bloqueado
}

export function loadPinAttempts(): PinAttempts {
  try {
    return { failures: 0, lockedUntil: 0, ...JSON.parse(read(PIN_ATTEMPTS_KEY) ?? "{}") };
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

/** Cada MAX_PIN_ATTEMPTS fallos seguidos, bloquea el ingreso de PIN por PIN_LOCKOUT_MS. */
export function registerPinFailure(attempts: PinAttempts, now = Date.now()): PinAttempts {
  const failures = attempts.failures + 1;
  const next = { failures, lockedUntil: failures % MAX_PIN_ATTEMPTS === 0 ? now + PIN_LOCKOUT_MS : 0 };
  write(PIN_ATTEMPTS_KEY, JSON.stringify(next));
  return next;
}

export function clearPinAttempts() {
  write(PIN_ATTEMPTS_KEY, null);
}

// --- Sesion de la entrada del evento --------------------------------------------------------

export interface StoredSession {
  token: string;
  attendee: Attendee;
  qr: QRParams;
  /** server_time - reloj local, en segundos: el QR se fecha con la hora del servidor. */
  clockOffset: number;
}

export function loadSession(): StoredSession | null {
  const token = read(SESSION_KEY);
  const qr = read(QR_PARAMS_KEY);
  if (!token || !qr) return null;
  try {
    return { token, ...(JSON.parse(qr) as Omit<StoredSession, "token">) };
  } catch {
    return null;
  }
}

export function saveSession(token: string, attendee: Attendee, qr: QRParams): StoredSession {
  const clockOffset = qr.server_time - Date.now() / 1000;
  write(SESSION_KEY, token);
  write(QR_PARAMS_KEY, JSON.stringify({ attendee, qr, clockOffset }));
  return { token, attendee, qr, clockOffset };
}

export function clearSession() {
  write(SESSION_KEY, null);
  write(QR_PARAMS_KEY, null);
}

export function serverNow(clockOffset: number): number {
  return Math.floor(Date.now() / 1000 + clockOffset);
}
