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

export interface TicketClaimResponse {
  access_token: string;
  token_type: string;
  attendee: Attendee;
}

export interface QRGenerateResponse {
  token: string;
  expires_at: string;
  ttl_seconds: number;
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

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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

  // Flujo publico del asistente: RUT + codigo de entrada -> sesion ligada al dispositivo.
  claimTicket: (rut: string, code: string) =>
    request<TicketClaimResponse>("/tickets/claim", { method: "POST", body: JSON.stringify({ rut, code }) }),
  myTicket: (attendeeToken: string) => request<Attendee>("/tickets/me", {}, attendeeToken),

  generateQr: (attendeeToken: string) => request<QRGenerateResponse>("/qr/generate", { method: "POST" }, attendeeToken),
  validateQr: (token: string, qrToken: string, gateId?: number | null) =>
    request<QRValidateResponse>(
      "/qr/validate",
      { method: "POST", body: JSON.stringify({ token: qrToken, gate_id: gateId ?? null }) },
      token,
    ),

  listBans: (token: string) => request<Ban[]>("/bans", {}, token),
  addBan: (token: string, payload: { rut: string; reason: string }) =>
    request<Ban>("/bans", { method: "POST", body: JSON.stringify(payload) }, token),
  removeBan: (token: string, id: number) => request<void>(`/bans/${id}`, { method: "DELETE" }, token),

  listLogs: (token: string) => request<AccessLog[]>("/logs", {}, token),
  eventMetrics: (token: string, eventId: number) => request<EventMetrics>(`/metrics?event_id=${eventId}`, {}, token),
};

export { ApiError };
