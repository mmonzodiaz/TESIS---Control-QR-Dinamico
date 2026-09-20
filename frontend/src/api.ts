export type Role = "admin" | "guard" | "resident";

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

export interface QRGenerateResponse {
  token: string;
  expires_at: string;
  ttl_seconds: number;
}

export interface QRValidateResponse {
  granted: boolean;
  reason: "ok" | "expired" | "already_used" | "invalid";
  user: User | null;
}

export interface AccessLog {
  id: number;
  token_id: string | null;
  granted: boolean;
  reason: string;
  created_at: string;
  user: User | null;
  scanned_by: User | null;
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

  generateQr: (token: string) => request<QRGenerateResponse>("/qr/generate", { method: "POST" }, token),
  validateQr: (token: string, qrToken: string) =>
    request<QRValidateResponse>("/qr/validate", { method: "POST", body: JSON.stringify({ token: qrToken }) }, token),

  listLogs: (token: string) => request<AccessLog[]>("/logs", {}, token),
};

export { ApiError };
