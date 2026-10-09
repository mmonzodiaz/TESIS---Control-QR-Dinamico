// Contingencia sin conexion del escaner (ADR-15).
//
// Mientras hay red, el escaner baja cada minuto una copia del evento: quienes tienen entrada, quienes
// ya ingresaron, prohibiciones y cedulas revocadas. Sin red, decide con esa copia y con lo que este
// mismo lector ya registro, y guarda las decisiones del guardia para enviarlas a /qr/sync al volver la
// red. Lo que no puede saber: ingresos por OTRAS puertas durante la caida (se detectan al sincronizar).
// Si la copia es muy vieja no deja pasar a nadie: se deriva a la fila normal.

import { ApiError, type Contingency, type OfflineDecision, type OfflineSyncResult } from "./api";

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

/** Memoria de uso unico armada de una vez desde lo guardado (sin copiar los Set por cada decision). */
export function buildLedger(items: QueuedDecision[]): LocalLedger {
  const ledger = emptyLedger();
  for (const q of items) {
    ledger.usedNonces.add(q.decision.nonce);
    if (q.decision.decision === "admit") ledger.admittedRuts.add(q.rut);
  }
  return ledger;
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
  /** Evento de la fila elegida: una copia de otro evento no sirve para decidir (como no tener copia). */
  eventId: number | null;
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
  if (c.event_id !== p.eventId) return "stale";
  if (c.revoked_ids.includes(p.credentialId)) return "revoked";
  if (c.banned_ruts.includes(p.rut)) return "banned";
  if (!c.ticket_ruts.includes(p.rut)) return "no_ticket";
  if (p.ledger.usedNonces.has(p.nonce)) return "already_used";
  if (c.admitted_ruts.includes(p.rut) || p.ledger.admittedRuts.has(p.rut)) return "already_admitted";
  return "ok";
}

/**
 * Con el Registro Civil arriba, el backend renueva la lista cada 30 s y el emisor la firma con su
 * hora: un desfase mayor que esto al armar la copia significa que el Registro Civil no responde.
 */
export const REVOCATION_STALE_SECONDS = 120;

export type RevocationWarning = { kind: "missing" } | { kind: "stale"; minutes: number };

/**
 * Aviso al guardia sobre la lista de cedulas revocadas que uso el servidor (ADR-14), segun la ultima
 * copia de contingencia, que el escaner baja cada minuto con red y conserva sin red. Si el backend
 * nunca obtuvo la lista, una cedula reportada como perdida pasaria como valida en linea y sin red.
 * Es solo un aviso, no un bloqueo: si cae el Registro Civil, bloquear dejaria a todos sin entrar; el
 * guardia puede pedir el carnet fisico. Sin copia todavia no hay nada que decir (null).
 */
export function revocationWarning(contingency: Contingency | null): RevocationWarning | null {
  if (contingency === null) return null;
  const issuedAt = contingency.revocation_list_issued_at;
  if (issuedAt === null) return { kind: "missing" };
  const lag = contingency.generated_at - issuedAt;
  return lag > REVOCATION_STALE_SECONDS ? { kind: "stale", minutes: Math.floor(lag / 60) } : null;
}

/** Fallo de red o del servidor (no un rechazo): el escaner pasa a modo sin conexion. */
export function isConnectivityError(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500;
}

// Las decisiones pendientes sobreviven a recargar la pagina: si se perdieran, habria ingresos sin
// registrar. Solo guardan lo que el servidor necesita para reverificar (sin la foto).
//
// Una cola por guardia: el servidor atribuye lo sincronizado a quien tiene la sesion al enviarlo, asi
// que si el guardia A cierra con pendientes y entra B en la misma tablet, B no debe subirlas a su
// nombre sin saberlo. B las ve como "de otra cuenta" y solo las envia si lo decide (adoptOtherQueues).
// La clave sin sufijo es la cola de antes de separarlas: no se sabe de quien es, cuenta como de otra.
const QUEUE_PREFIX = "control-acceso-escaner-pendientes";

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // almacenamiento bloqueado
  }
}

export function queueKey(owner: number): string {
  return `${QUEUE_PREFIX}:${owner}`;
}

function queueKeys(storage: KeyValueStore): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === QUEUE_PREFIX || key?.startsWith(`${QUEUE_PREFIX}:`)) keys.push(key);
  }
  return keys;
}

function readQueue(storage: KeyValueStore, key: string): QueuedDecision[] {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedDecision[]) : [];
  } catch {
    return [];
  }
}

export function loadQueue(owner: number, storage = browserStorage()): QueuedDecision[] {
  return storage ? readQueue(storage, queueKey(owner)) : [];
}

export function saveQueue(owner: number, queue: QueuedDecision[], storage = browserStorage()): void {
  try {
    if (!storage) return;
    if (queue.length) storage.setItem(queueKey(owner), JSON.stringify(queue));
    else storage.removeItem(queueKey(owner));
  } catch {
    // sin almacenamiento: la cola vive solo en memoria mientras la pagina este abierta
  }
}

/** Decisiones pendientes de OTRAS cuentas en este lector (o de antes de separar las colas). */
export function loadOtherQueues(owner: number, storage = browserStorage()): QueuedDecision[] {
  if (!storage) return [];
  return queueKeys(storage)
    .filter((key) => key !== queueKey(owner))
    .flatMap((key) => readQueue(storage, key));
}

/**
 * El guardia decide enviar a su nombre lo que otra cuenta dejo pendiente en este lector (p. ej. ya no
 * vuelve a este turno). Se suman a su cola sin duplicar y se borran las otras. Devuelve la cola nueva.
 */
export function adoptOtherQueues(owner: number, storage = browserStorage()): QueuedDecision[] {
  const own = loadQueue(owner, storage);
  if (!storage) return own;
  const seen = new Set(own.map((q) => q.decision.nonce));
  const merged = [...own];
  for (const key of queueKeys(storage)) {
    if (key === queueKey(owner)) continue;
    for (const q of readQueue(storage, key)) {
      if (!seen.has(q.decision.nonce)) {
        seen.add(q.decision.nonce);
        merged.push(q);
      }
    }
    storage.removeItem(key);
  }
  saveQueue(owner, merged, storage);
  return merged;
}

/**
 * Todo lo pendiente en este lector, de cualquier cuenta. La memoria de uso unico es del LECTOR, no del
 * guardia: si A dejo pasar a alguien sin red y B toma la tablet sin red, B tambien debe verlo.
 */
export function loadAllQueues(storage = browserStorage()): QueuedDecision[] {
  return storage ? queueKeys(storage).flatMap((key) => readQueue(storage, key)) : [];
}

/** Tope de decisiones por envio: el mismo de OfflineSyncIn en el backend. */
export const SYNC_BATCH = 500;

export interface SyncOutcome {
  results: OfflineSyncResult[];
  /** Decisiones que el servidor rechazo de forma definitiva (4xx): quedan guardadas, no se reintentan. */
  rejected: string[];
  /** Por que se corto el envio antes de terminar: sin red, o un error que hay que reintentar despues. */
  stopped: "offline" | "error" | null;
}

/** Rechazo del servidor que no cambia al reintentar (formato invalido, etc.). */
function isDefinitiveRejection(err: unknown): boolean {
  return err instanceof ApiError && [400, 404, 409, 422].includes(err.status);
}

/**
 * Envia la cola en lotes de SYNC_BATCH. Si el servidor rechaza un lote completo, lo reenvia de a una
 * decision para aislar las que no acepta, de modo que una sola mala no trabe al resto para siempre.
 * Sin red se detiene; un 401/429 tambien (se reintenta despues), sin marcar nada como rechazado.
 */
export async function syncQueue(
  pending: QueuedDecision[],
  send: (decisions: OfflineDecision[]) => Promise<OfflineSyncResult[]>,
  batchSize = SYNC_BATCH,
): Promise<SyncOutcome> {
  const out: SyncOutcome = { results: [], rejected: [], stopped: null };
  const stop = (err: unknown): SyncOutcome => ({ ...out, stopped: isConnectivityError(err) ? "offline" : "error" });
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize).map((q) => q.decision);
    try {
      out.results.push(...(await send(batch)));
      continue;
    } catch (err) {
      if (!isDefinitiveRejection(err)) return stop(err);
    }
    for (const decision of batch) {
      try {
        out.results.push(...(await send([decision])));
      } catch (err) {
        if (!isDefinitiveRejection(err)) return stop(err);
        out.rejected.push(decision.nonce);
      }
    }
  }
  return out;
}

/** Aviso visible al guardia cuando la sincronizacion no termina bien (antes se descartaba en silencio). */
export function syncProblemText(rejected: number, failed: boolean): string | null {
  if (rejected > 0) {
    const what = rejected === 1 ? "1 decisión tomada" : `${rejected} decisiones tomadas`;
    return `El servidor no aceptó ${what} sin conexión. Quedan guardadas en este lector: avisa al administrador.`;
  }
  return failed ? "No se pudo sincronizar lo decidido sin conexión; se reintentará." : null;
}
