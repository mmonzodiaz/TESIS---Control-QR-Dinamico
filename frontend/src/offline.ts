// Contingencia sin conexion del escaner (ADR-15).
//
// Mientras hay red, el escaner baja cada minuto una copia del evento: quienes tienen entrada, quienes
// ya ingresaron, prohibiciones y cedulas revocadas. Sin red, decide con esa copia y con lo que este
// mismo lector ya registro, y guarda las decisiones del guardia para enviarlas a /qr/sync al volver la
// red. Lo que no puede saber: ingresos por OTRAS puertas durante la caida (se detectan al sincronizar).
// Si la copia es muy vieja no deja pasar a nadie: se deriva a la fila normal.

import { ApiError, type Contingency, type OfflineDecision } from "./api";

export type OfflineVerdict =
  | "ok"
  | "stale"
  | "invalid"
  | "expired"
  | "revoked"
  | "banned"
  | "no_ticket"
  | "already_admitted"
  | "already_used";

/** Decision tomada sin red, con el RUT para que este lector recuerde a quien ya dejo pasar. */
export interface QueuedDecision {
  rut: string;
  decision: OfflineDecision;
}

/** Lo que este lector registro sin red en la sesion (enviado o no): su propia memoria de uso unico. */
export interface LocalLedger {
  usedNonces: Set<string>;
  admittedRuts: Set<string>;
}

export function emptyLedger(): LocalLedger {
  return { usedNonces: new Set(), admittedRuts: new Set() };
}

export function recordInLedger(ledger: LocalLedger, queued: QueuedDecision): LocalLedger {
  const usedNonces = new Set(ledger.usedNonces).add(queued.decision.nonce);
  const admittedRuts = new Set(ledger.admittedRuts);
  if (queued.decision.decision === "admit") admittedRuts.add(queued.rut);
  return { usedNonces, admittedRuts };
}

/** Segundos desde que el servidor genero la copia (con el reloj corregido del escaner). */
export function contingencyAge(contingency: Contingency, now: number): number {
  return Math.max(0, now - contingency.generated_at);
}

export function isContingencyUsable(contingency: Contingency | null, now: number): contingency is Contingency {
  return contingency !== null && contingencyAge(contingency, now) <= contingency.max_age_seconds;
}

/**
 * Veredicto sin red. `freshness` es el chequeo local de vigencia del QR ("ok", "expired", "invalid");
 * firmas y foto ya se verificaron antes (si fallaran, no se llega aqui).
 */
export function evaluateOffline(p: {
  contingency: Contingency | null;
  now: number;
  freshness: string;
  rut: string;
  credentialId: string;
  nonce: string;
  ledger: LocalLedger;
}): OfflineVerdict {
  if (p.freshness === "invalid") return "invalid";
  if (p.freshness === "expired") return "expired";
  if (!isContingencyUsable(p.contingency, p.now)) return "stale";
  const c = p.contingency;
  if (c.revoked_ids.includes(p.credentialId)) return "revoked";
  if (c.banned_ruts.includes(p.rut)) return "banned";
  if (!c.ticket_ruts.includes(p.rut)) return "no_ticket";
  if (p.ledger.usedNonces.has(p.nonce)) return "already_used";
  if (c.admitted_ruts.includes(p.rut) || p.ledger.admittedRuts.has(p.rut)) return "already_admitted";
  return "ok";
}

/** Fallo de red o del servidor (no un rechazo): el escaner pasa a modo sin conexion. */
export function isConnectivityError(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500;
}

// Las decisiones pendientes sobreviven a recargar la pagina: si se perdieran, habria ingresos sin
// registrar. Solo guardan lo que el servidor necesita para reverificar (sin la foto).
const QUEUE_KEY = "control-acceso-escaner-pendientes";

export function loadQueue(): QueuedDecision[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedDecision[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueuedDecision[]): void {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // sin almacenamiento: la cola vive solo en memoria mientras la pagina este abierta
  }
}
