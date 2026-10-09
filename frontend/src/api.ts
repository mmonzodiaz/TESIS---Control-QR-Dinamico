export type Role = "admin" | "guard";
export type Lane = "digital" | "normal";

export const LANE_LABEL: Record<Lane, string> = { digital: "Fila cédula digital", normal: "Fila normal" };

export interface User {
  id: number;
  email: string;
  full_name: string;
  document_id: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface EventInfo {
  id: number;
  name: string;
  starts_at: string | null;
  created_at: string;
}

export interface Gate {
  id: number;
  event_id: number;
  name: string;
  lane: Lane;
}

export interface Ticket {
  id: number;
  event_id: number;
  holder_name: string;
  document_id: string;
  admitted_at: string | null;
  created_at: string;
}

export interface Attendee {
  ticket_id: number;
  holder_name: string;
  rut_masked: string;
  event: EventInfo;
  admitted_at: string | null;
}

/** Claves del escaner para leer y verificar QR localmente. */
export interface VerifierKeys {
  /** X25519 de lectores autorizados (la entrega el Registro Civil). */
  verifier_private_key: string;
  issuer_public_key: string;
  ttl_seconds: number;
  clock_skew_seconds: number;
  server_time: number;
}

export interface QRValidateRequest {
  /** "check" verifica sin registrar; luego "admit" (la foto coincide) o "reject" (no coincide). */
  action?: "check" | "admit" | "reject";
  gate_id: number;
  nonce: string;
  issued_at: number;
  device_sig: string;
  credential_core: string;
  issuer_sig: string;
}

export interface QRValidateResponse {
  granted: boolean;
  reason: "ok" | "expired" | "already_used" | "invalid" | "already_admitted" | "no_ticket" | "banned" | "photo_mismatch" | "revoked";
  /** "check" aprobo todo: falta que el guardia confirme la foto (ADR-12). */
  pending: boolean;
  attendee: Attendee | null;
  latency_ms: number | null;
}

export interface AccessLog {
  id: number;
  token_id: string | null;
  granted: boolean;
  reason: string;
  /** Decidido sin conexion y sincronizado despues (ADR-15). */
  offline: boolean;
  latency_ms: number;
  created_at: string;
  holder_name: string | null;
  rut_masked: string | null;
  gate: Gate | null;
  /** Quien escaneo, sin email ni RUT: el historial lo leen tambien los guardias. */
  scanned_by: StaffRef | null;
}

export interface StaffRef {
  id: number;
  full_name: string;
  role: Role;
}

/** Copia de contingencia del escaner para operar sin conexion (ADR-15). Solo en memoria. */
export interface Contingency {
  event_id: number;
  generated_at: number;
  /** Sello del servidor sobre (evento, generated_at): acota la hora de las decisiones sin red. */
  seal: string;
  max_age_seconds: number;
  ticket_ruts: string[];
  admitted_ruts: string[];
  banned_ruts: string[];
  revoked_ids: string[];
  revocation_list_issued_at: number | null;
}

/** Lo que el guardia decidio sin conexion; se envia a /qr/sync al volver la red. */
export interface OfflineDecision {
  decision: "admit" | "reject";
  scanned_at: number;
  /** Copia de contingencia vigente al decidir; sin ella el servidor evalua a la hora de sincronizar. */
  contingency_generated_at?: number;
  contingency_seal?: string;
  gate_id: number;
  nonce: string;
  issued_at: number;
  device_sig: string;
  credential_core: string;
  issuer_sig: string;
}

export interface OfflineSyncResult {
  nonce: string;
  reason: string;
  /** El guardia dejo pasar a alguien que el servidor no habria admitido. */
  alert: boolean;
}

/** Lista de cedulas revocadas que publica el Registro Civil (hashes de cada emision). */
export interface RevocationList {
  issued_at: number;
  revoked: string[];
  sig: string;
}

export interface Ban {
  id: number;
  document_id: string;
  reason: string;
  created_at: string;
}

export interface GateMetrics {
  gate_id: number | null;
  gate_name: string;
  lane: Lane | null;
  scans: number;
  granted: number;
  rejected_by_reason: Record<string, number>;
  scans_per_minute: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
}

export interface EventMetrics {
  event_id: number;
  tickets_total: number;
  tickets_admitted: number;
  gates: GateMetrics[];
}

// Por defecto /api, que Vite reenvia al backend (vite.config.ts): asi funciona igual desde el
// celular en la red local. VITE_API_URL permite apuntar a otro backend.
const API_URL = import.meta.env.VITE_API_URL || "/api";
// Registro Civil simulado: servicio aparte (registro_civil/app.py), tambien detras del proxy de Vite.
const REGISTRO_CIVIL_URL = import.meta.env.VITE_REGISTRO_CIVIL_URL || "/registro-civil";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const SESSION_EXPIRED_EVENT = "control-acceso:sesion-expirada";

/** `detail` de FastAPI: texto, o lista de errores de validacion (422) con su mensaje en `msg`. */
export function errorDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item && typeof item === "object" && "msg" in item ? String(item.msg) : null))
      .filter((m): m is string => Boolean(m))
      .map((m) => m.replace(/^Value error, /, ""));
    return messages.length ? messages.join(". ") : undefined;
  }
  return undefined;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null, baseUrl = API_URL): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof URLSearchParams)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = errorDetail((await res.json()).detail) ?? detail;
    } catch {
      // ignore, keep statusText
    }
    // La sesion dejo de valer en el servidor (vencio, cambio de contrasena o de rol, cuenta
    // desactivada): la app vuelve al login en vez de seguir mostrando datos viejos.
    if (res.status === 401 && token && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Cedula digital tal como la entrega el Registro Civil (incluye la foto; se guarda cifrada en el telefono). */
export interface EnrollResponse {
  format: string;
  core: string;
  issuer_sig: string;
  photo: string;
  verifier_public_key: string;
  server_time: number;
}

export const api = {
  // Registro Civil simulado: RUT + clave de activacion (simula la ClaveUnica) + clave publica del
  // telefono -> cedula firmada, ligada a este telefono.
  enroll: (rut: string, clave: string, devicePublicKey: string) =>
    request<EnrollResponse>(
      "/enrolar",
      { method: "POST", body: JSON.stringify({ rut, clave, device_public_key: devicePublicKey }) },
      null,
      REGISTRO_CIVIL_URL,
    ),
  officialTime: () => request<{ server_time: number }>("/hora", {}, null, REGISTRO_CIVIL_URL),
  revocations: () => request<RevocationList>("/revocaciones", {}, null, REGISTRO_CIVIL_URL),
  // "Perdi mi telefono": desde otro dispositivo, con la misma clave de activacion (ADR-14).
  reportLoss: (rut: string, clave: string) =>
    request<{ revoked: number }>("/reportar-perdida", { method: "POST", body: JSON.stringify({ rut, clave }) }, null, REGISTRO_CIVIL_URL),

  login: (email: string, password: string) => {
    const body = new URLSearchParams({ username: email, password });
    return request<LoginResponse>("/auth/login", { method: "POST", body });
  },
  me: (token: string) => request<User>("/auth/me", {}, token),

  listUsers: (token: string) => request<User[]>("/users", {}, token),
  createUser: (token: string, payload: { email: string; full_name: string; password: string; role: Role; document_id?: string }) =>
    request<User>("/users", { method: "POST", body: JSON.stringify(payload) }, token),
  updateUser: (token: string, id: number, payload: Partial<{ full_name: string; role: Role; is_active: boolean; password: string; document_id: string }>) =>
    request<User>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, token),
  deleteUser: (token: string, id: number) => request<void>(`/users/${id}`, { method: "DELETE" }, token),

  listEvents: (token: string) => request<EventInfo[]>("/events", {}, token),
  createEvent: (token: string, name: string) =>
    request<EventInfo>("/events", { method: "POST", body: JSON.stringify({ name }) }, token),
  listGates: (token: string, eventId: number) => request<Gate[]>(`/events/${eventId}/gates`, {}, token),
  createGate: (token: string, eventId: number, payload: { name: string; lane: Lane }) =>
    request<Gate>(`/events/${eventId}/gates`, { method: "POST", body: JSON.stringify(payload) }, token),
  listTickets: (token: string, eventId: number) => request<Ticket[]>(`/events/${eventId}/tickets`, {}, token),
  createTicket: (token: string, eventId: number, payload: { holder_name: string; rut: string }) =>
    request<Ticket>(`/events/${eventId}/tickets`, { method: "POST", body: JSON.stringify(payload) }, token),
  deleteTicket: (token: string, ticketId: number) => request<void>(`/tickets/${ticketId}`, { method: "DELETE" }, token),

  // Escaner: claves para verificar localmente, y consulta en linea sin la foto.
  verifierKeys: (token: string, eventId: number) => request<VerifierKeys>(`/events/${eventId}/verifier`, {}, token),
  validateQr: (token: string, payload: QRValidateRequest) =>
    request<QRValidateResponse>("/qr/validate", { method: "POST", body: JSON.stringify(payload) }, token),
  contingency: (token: string, eventId: number) => request<Contingency>(`/events/${eventId}/contingencia`, {}, token),
  syncOffline: (token: string, decisions: OfflineDecision[]) =>
    request<OfflineSyncResult[]>("/qr/sync", { method: "POST", body: JSON.stringify({ decisions }) }, token),

  listBans: (token: string) => request<Ban[]>("/bans", {}, token),
  addBan: (token: string, payload: { rut: string; reason: string }) =>
    request<Ban>("/bans", { method: "POST", body: JSON.stringify(payload) }, token),
  removeBan: (token: string, id: number) => request<void>(`/bans/${id}`, { method: "DELETE" }, token),

  listLogs: (token: string) => request<AccessLog[]>("/logs", {}, token),
  eventMetrics: (token: string, eventId: number) => request<EventMetrics>(`/metrics?event_id=${eventId}`, {}, token),
};

export { ApiError };
