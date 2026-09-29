import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, Loader2, Lock, Ticket as TicketIcon } from "lucide-react";
import { api, ApiError } from "../api";
import { BrandMark } from "../components/BrandMark";
import { IdentityCard } from "../components/IdentityCard";
import { b64encode, devicePublicKey } from "../credential";
import { formatRut } from "../rut";
import {
  clearSession,
  deviceSecret,
  forgetCredential,
  importCredential,
  loadCredential,
  loadSession,
  saveSession,
  type StoredCredential,
  type StoredSession,
} from "../wallet";
import { MyAccessPage } from "./MyAccessPage";

export function ClaimTicketPage() {
  const [cedula, setCedula] = useState<StoredCredential | null>(loadCredential);
  const [session, setSession] = useState<StoredSession | null>(loadSession);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Refresca la sesion al abrir (hora del servidor, si ya ingreso). Sin red se sigue usando la guardada.
    if (!session) return;
    api
      .myTicket(session.token)
      .then((res) => setSession(saveSession(session.token, res.attendee, res.qr)))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) sessionLost();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sessionLost() {
    clearSession();
    setSession(null);
    setError("Tu entrada se abrio en otro dispositivo o fue liberada por soporte. Activala de nuevo.");
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      setCedula(await importCredential(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la cedula");
    }
  }

  function changeCedula() {
    forgetCredential();
    setCedula(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cedula) return;
    setError(null);
    setSubmitting(true);
    try {
      // Solo viajan el core (con el hash de la foto) y la firma del emisor: la foto se queda aqui.
      const res = await api.claimTicket({
        rut: cedula.identity.rut,
        code,
        device_public_key: b64encode(devicePublicKey(deviceSecret())),
        credential_core: b64encode(cedula.credential.core),
        issuer_sig: b64encode(cedula.credential.issuerSig),
      });
      setSession(saveSession(res.access_token, res.attendee, res.qr));
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

      {session && cedula ? (
        <MyAccessPage session={session} cedula={cedula} onSessionLost={sessionLost} onSessionRefresh={setSession} />
      ) : (
        <div className="mx-auto w-full max-w-[400px]">
          <div className="rounded-[24px] border border-[#e3ebea] bg-white p-8 shadow-[0_16px_40px_rgba(37,73,79,.08)]">
            <h1 className="font-display text-[22px] font-extrabold tracking-[-.03em] text-[#173c47]">Obten tu QR de acceso</h1>

            {!cedula ? (
              <>
                <p className="mt-1.5 text-[12px] leading-5 text-[#82989a]">
                  Paso 1 de 2: carga tu cedula digital. Tu foto, nombre y RUT iran dentro del QR, firmados por el
                  Registro Civil, para que el guardia los vea al escanear.
                </p>
                <input ref={fileInput} type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="mt-6 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#cfe3de] bg-[#fbfdfc] px-4 py-7 text-center transition hover:border-[#8dcfc3]"
                >
                  <FileUp className="size-6 text-[#0e806c]" />
                  <span className="text-[12px] font-bold text-[#234953]">Cargar cedula digital</span>
                  <span className="text-[10px] text-[#91a4a5]">Archivo .json emitido por el Registro Civil (simulado)</span>
                </button>
                <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-[#7c9294]">
                  <Lock className="mt-0.5 size-3 shrink-0" /> El archivo se lee en este telefono. Tu foto no se sube a
                  ningun servidor.
                </p>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                <p className="mt-1.5 text-[12px] leading-5 text-[#82989a]">
                  Paso 2 de 2: ingresa el codigo de tu entrada. Pedimos cedula y codigo para que nadie que solo conozca
                  tu RUT pueda sacar un QR a tu nombre.
                </p>
                <div className="mt-5">
                  <IdentityCard identity={cedula.identity} photo={cedula.credential.photo} caption="Tu cedula digital" />
                  <button type="button" onClick={changeCedula} className="mt-1.5 text-[10px] font-bold text-[#0e806c] hover:underline">
                    Usar otra cedula
                  </button>
                </div>

                <label className="mt-4 block text-[11px] font-bold text-[#557276]">
                  Codigo de entrada para RUT {formatRut(cedula.identity.rut)}
                  <div className="relative mt-1.5">
                    <TicketIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9eb0b1]" />
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      required
                      autoFocus
                      autoComplete="off"
                      placeholder="8 caracteres, viene en tu entrada"
                      className="w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] py-2.5 pl-10 pr-3 font-mono text-[13px] font-medium tracking-[.15em] text-[#274b53] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-[#acbabb] focus:border-[#8dcfc3]"
                    />
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-3 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(18,63,74,.18)] transition hover:-translate-y-0.5 hover:bg-[#0c5360] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {submitting ? "Validando..." : "Activar mi entrada"}
                </button>
              </form>
            )}

            {error && <p className="mt-4 rounded-xl bg-[#fdeceb] px-3 py-2 text-[11px] font-semibold text-[#c6505b]">{error}</p>}
          </div>

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
