import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { KeyRound, Loader2, Mail } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center bg-[#f6f9f8] px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[24px] border border-[#e3ebea] bg-white p-8 shadow-[0_16px_40px_rgba(37,73,79,.08)]"
        >
          <h1 className="font-display text-[22px] font-extrabold tracking-[-.03em] text-[#173c47]">Acceso del personal</h1>
          <p className="mt-1.5 text-[12px] text-[#82989a]">Guardias y administradores del evento.</p>

          <label className="mt-6 block text-[11px] font-bold text-[#557276]">
            Email
            <div className="relative mt-1.5">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9eb0b1]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="tu@correo.cl"
                className="w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] py-2.5 pl-10 pr-3 text-[13px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]"
              />
            </div>
          </label>

          <label className="mt-4 block text-[11px] font-bold text-[#557276]">
            Contraseña
            <div className="relative mt-1.5">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9eb0b1]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="********"
                className="w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] py-2.5 pl-10 pr-3 text-[13px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]"
              />
            </div>
          </label>

          {error && (
            <p className="mt-4 rounded-xl bg-[#fdeceb] px-3 py-2 text-[11px] font-semibold text-[#c6505b]">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-3 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(18,63,74,.18)] transition hover:-translate-y-0.5 hover:bg-[#0c5360] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-[#91a4a5]">
          ¿Tienes cédula digital?{" "}
          <Link to="/mi-cedula" className="font-bold text-[#0e806c] hover:underline">
            Ábrela aquí
          </Link>
        </p>
      </div>
    </div>
  );
}
