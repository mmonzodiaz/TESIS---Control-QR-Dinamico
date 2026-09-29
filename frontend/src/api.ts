export type Role = "admin" | "guard";
export type Lane = "rapida" | "normal";

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
  claimed_at: string | null;
  admitted_at: string | null;
  created_at: string;
}

export interface TicketCreated extends Ticket {
  code: string;
}

export interface Attendee {
  ticket_id: number;
  holder_name: string;
  rut_masked: string;
  event: EventInfo;
  admitted_at: string | null;
}

/** Lo que el telefono necesita para generar QR sin conexion. */
export interface QRParams {
  event_id: number;
  ticket_id: number;
  event_public_key: string;
  ttl_seconds: number;
  server_time: number;
}

export interface TicketSession {
  attendee: Attendee;
  qr: QRParams;
}

export interface TicketClaimResponse extends TicketSession {
  access_token: string;
  token_type: string;
}

export interface TicketClaimRequest {
  rut: string;
  code: string;
  device_public_key: string;
  /** Credencial del Registro Civil SIN la foto (la foto no sale del telefono). */
  credential_core: string;
  issuer_sig: string;
}

/** Claves del escaner para leer y verificar QR localmente. */
export interface VerifierKeys {
  event_id: number;
  event_private_key: string;
  issuer_public_key: string;
  ttl_seconds: number;
  clock_skew_seconds: number;
  server_time: number;
}

export interface QRValidateRequest {
  gate_id: number | null;
  ticket_id: number;
  nonce: string;
  issued_at: number;
  device_sig: string;
  credential_core: string;
  issuer_sig: string;
}

export interface QRValidateResponse {
  granted: boolean;
  reason: "ok" | "expired" | "already_used" | "invalid" | "already_admitted" | "wrong_event" | "banned";
  attendee: Attendee | null;
  latency_ms: number | null;
}

export interface AccessLog {
  id: number;
  token_id: string | null;
  granted: boolean;
  reason: string;
  latency_ms: number;
  created_at: string;
  holder_name: string | null;
  rut_masked: string | null;
  gate: Gate | null;
  scanned_by: User | null;
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
  tickets_claimed: number;
  tickets_admitted: number;
  gates: GateMetrics[];
}

// Por defecto /api, que Vite reenvia al backend (vite.config.ts): asi funciona igual desde el
// celular en la red local. VITE_API_URL permite apuntar a otro backend.
const API_URL = import.meta.env.VITE_API_URL || "/api";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof URLSearchParams)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail ?? detail;
    } catch {
      // ignore, keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
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
    request<TicketCreated>(`/events/${eventId}/tickets`, { method: "POST", body: JSON.stringify(payload) }, token),
  resetTicket: (token: string, ticketId: number) => request<Ticket>(`/tickets/${ticketId}/reset`, { method: "POST" }, token),

  // Flujo publico del asistente: RUT + codigo de entrada + cedula importada -> sesion ligada al dispositivo.
  claimTicket: (payload: TicketClaimRequest) =>
    request<TicketClaimResponse>("/tickets/claim", { method: "POST", body: JSON.stringify(payload) }),
  myTicket: (attendeeToken: string) => request<TicketSession>("/tickets/me", {}, attendeeToken),

  // Escaner: claves para verificar localmente, y consulta en linea sin la foto.
  verifierKeys: (token: string, eventId: number) => request<VerifierKeys>(`/events/${eventId}/verifier`, {}, token),
  validateQr: (token: string, payload: QRValidateRequest) =>
    request<QRValidateResponse>("/qr/validate", { method: "POST", body: JSON.stringify(payload) }, token),

  listBans: (token: string) => request<Ban[]>("/bans", {}, token),
  addBan: (token: string, payload: { rut: string; reason: string }) =>
    request<Ban>("/bans", { method: "POST", body: JSON.stringify(payload) }, token),
  removeBan: (token: string, id: number) => request<void>(`/bans/${id}`, { method: "DELETE" }, token),

  listLogs: (token: string) => request<AccessLog[]>("/logs", {}, token),
  eventMetrics: (token: string, eventId: number) => request<EventMetrics>(`/metrics?event_id=${eventId}`, {}, token),
};

export { ApiError };
