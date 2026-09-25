import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IdCard, Loader2, Ticket as TicketIcon } from "lucide-react";
import { api, ApiError, type Attendee } from "../api";
import { BrandMark } from "../components/BrandMark";
import { formatRut, isValidRut } from "../rut";
import { MyAccessPage } from "./MyAccessPage";

// Separada de la llave del personal (AuthContext): un asistente no tiene cuenta, solo una
// sesion ligada a su entrada y a este dispositivo.
const ATTENDEE_STORAGE_KEY = "control-acceso-entrada";

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(ATTENDEE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(ATTENDEE_STORAGE_KEY, token);
    else localStorage.removeItem(ATTENDEE_STORAGE_KEY);
  } catch {
    // modo privado: la sesion dura mientras la pestana este abierta
  }
}

export function ClaimTicketPage() {
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [attendee, setAttendee] = useState<Attendee | null>(null);
  const [checking, setChecking] = useState(token !== null);
  const [rut, setRut] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token || attendee) return;
    api
      .myTicket(token)
      .then(setAttendee)
      .catch(() => {
        storeToken(null);
        setToken(null);
      })
      .finally(() => setChecking(false));
  }, [token, attendee]);

  function sessionLost() {
    storeToken(null);
    setToken(null);
    setAttendee(null);
    setError("Tu entrada se abrio en otro dispositivo o fue liberada por soporte. Ingresa tus datos de nuevo.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidRut(rut)) {
      setError("El RUT no es valido. Revisa el digito verificador.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.claimTicket(rut, code);
      storeToken(res.access_token);
      setToken(res.access_token);
      setAttendee(res.attendee);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo validar la entrada");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f9f8] px-4 py-8">
      <div className="mb-8 flex justify-center">
        <BrandMark />
      </div>

      {checking ? (
        <p className="mt-16 text-center text-[13px] font-medium text-[#82989a]">Cargando...</p>
      ) : token && attendee ? (
        <MyAccessPage token={token} attendee={attendee} onSessionLost={sessionLost} />
      ) : (
        <div className="mx-auto w-full max-w-[400px]">
          <form
            onSubmit={handleSubmit}
            className="rounded-[24px] border border-[#e3ebea] bg-white p-8 shadow-[0_16px_40px_rgba(37,73,79,.08)]"
          >
            <h1 className="font-display text-[22px] font-extrabold tracking-[-.03em] text-[#173c47]">Obten tu QR de acceso</h1>
            <p className="mt-1.5 text-[12px] leading-5 text-[#82989a]">
              Ingresa tu RUT y el codigo de tu entrada. Pedimos los dos para que nadie que solo conozca tu RUT pueda
              sacar un QR a tu nombre.
            </p>

            <label className="mt-6 block text-[11px] font-bold text-[#557276]">
              RUT
              <div className="relative mt-1.5">
                <IdCard className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9eb0b1]" />
                <input
                  value={rut}
                  onChange={(e) => setRut(formatRut(e.target.value))}
                  required
                  autoFocus
                  inputMode="text"
                  placeholder="12.345.678-5"
                  className="w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] py-2.5 pl-10 pr-3 text-[13px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]"
                />
              </div>
            </label>

            <label className="mt-4 block text-[11px] font-bold text-[#557276]">
              Codigo de entrada
              <div className="relative mt-1.5">
                <TicketIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9eb0b1]" />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  autoComplete="off"
                  placeholder="8 caracteres, viene en tu entrada"
                  className="w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] py-2.5 pl-10 pr-3 font-mono text-[13px] font-medium tracking-[.15em] text-[#274b53] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-[#acbabb] focus:border-[#8dcfc3]"
                />
              </div>
            </label>

            {error && <p className="mt-4 rounded-xl bg-[#fdeceb] px-3 py-2 text-[11px] font-semibold text-[#c6505b]">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-3 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(18,63,74,.18)] transition hover:-translate-y-0.5 hover:bg-[#0c5360] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Validando..." : "Obtener mi QR"}
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] text-[#91a4a5]">
            ¿Eres parte del personal?{" "}
            <Link to="/login" className="font-bold text-[#0e806c] hover:underline">
              Ingresa aqui
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
