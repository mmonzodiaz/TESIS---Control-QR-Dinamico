// Lo que el telefono guarda para generar QR sin conexion. Todo queda en este navegador: la cedula
// (con la foto) nunca se envia al servidor.
//
// Limitacion del prototipo: la clave del dispositivo vive en localStorage. En una cedula digital
// real iria en el almacen seguro del telefono (Secure Enclave / StrongBox), no exportable.
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

const CREDENTIAL_KEY = "control-acceso-cedula";
const DEVICE_KEY = "control-acceso-dispositivo";
const SESSION_KEY = "control-acceso-entrada";
const QR_PARAMS_KEY = "control-acceso-entrada-qr";

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

export interface StoredCredential {
  credential: IdentityCredential;
  identity: IdentityCore;
}

export function loadCredential(): StoredCredential | null {
  const raw = read(CREDENTIAL_KEY);
  if (!raw) return null;
  try {
    return parseCredentialFile(JSON.parse(raw));
  } catch {
    write(CREDENTIAL_KEY, null);
    return null;
  }
}

/** Importa el archivo del Registro Civil (simulado). Lanza CredentialError si no es valido. */
export async function importCredential(file: File): Promise<StoredCredential> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("El archivo no es una cedula digital (JSON invalido)");
  }
  const stored = parseCredentialFile(json);
  write(CREDENTIAL_KEY, JSON.stringify(credentialToJson(stored.credential)));
  return stored;
}

export function forgetCredential() {
  write(CREDENTIAL_KEY, null);
}

/** Clave Ed25519 del dispositivo: se crea una vez y firma cada QR. */
export function deviceSecret(): Uint8Array {
  const raw = read(DEVICE_KEY);
  if (raw) {
    try {
      return b64decode(raw, 32);
    } catch {
      // clave corrupta: se reemplaza (la entrada tendra que liberarse en soporte)
    }
  }
  const secret = newSecretKey();
  write(DEVICE_KEY, b64encode(secret));
  return secret;
}

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
