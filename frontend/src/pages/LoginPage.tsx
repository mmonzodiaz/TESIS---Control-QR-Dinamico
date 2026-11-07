import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api";
import { BrandMark } from "../components/BrandMark";

export function LoginPage() {
  const { token, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[380px]">
        <BrandMark />

        <form onSubmit={handleSubmit} className="section mt-6 p-6">
          <h1 className="text-[20px] font-semibold text-ink">Acceso del personal</h1>
          <p className="mt-1 text-[14px] text-ink-2">Guardias y administración del recinto.</p>

          <label htmlFor="login-email" className="field-label mt-6">
            Correo
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
            className="field mt-1.5"
          />

          <label htmlFor="login-password" className="field-label mt-4">
            Contraseña
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="field mt-1.5"
          />

          {error && (
            <p role="alert" className="notice notice-error mt-4">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="btn btn-primary btn-lg mt-6">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <p className="mt-6 text-[14px] text-ink-2">
          ¿Tienes cédula digital?{" "}
          <Link to="/mi-cedula" className="btn-link">
            Ábrela aquí
          </Link>
        </p>
      </div>
    </div>
  );
}
