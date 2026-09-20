import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronDown, HelpCircle, Info, QrCode, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError } from "../api";

// Onboarding informativo para el arquetipo "Mayoria desinformada activa" (47% de la muestra):
// personas digitalmente capaces que nunca oyeron hablar del mecanismo, dispuestas a usarlo si
// entienden como funciona (Anexo A.2). Se muestra expandido la primera vez de cada navegador.
function QueEsEstoPanel() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("control-acceso-que-es-esto-visto") !== "1";
    } catch {
      return true;
    }
  });

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("control-acceso-que-es-esto-visto", "1");
      } catch {
        // localStorage puede fallar (modo privado); no es critico para la funcionalidad
      }
      return next;
    });
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[#dbe9f5] bg-[#f3f9fd]">
      <button onClick={toggle} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <Info className="size-4 shrink-0 text-[#3b7fc9]" />
        <span className="flex-1 text-[11px] font-bold text-[#2c567f]">Que es esto y para que sirve</span>
        <ChevronDown className={`size-4 text-[#7fa3c9] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4 text-[11px] leading-5 text-[#3d5a75]">
          <p>
            Este codigo QR reemplaza mostrar tu identificacion en papel en portería. Cada vez que lo generas se crea
            un codigo distinto, valido por poco tiempo y para un solo ingreso.
          </p>
          <p>
            Por eso <strong>se ve diferente cada vez</strong> y <strong>caduca solo</strong>: es la forma en que el
            sistema evita que alguien tome una foto de tu pantalla y lo use despues en tu lugar.
          </p>
        </div>
      )}
    </div>
  );
}

// Mensajeria comparativa explicita para el arquetipo "Esceptico" (11%): cree que esto equivale a
// una clave como ClaveUnica y no percibe valor diferencial (Anexo A.2).
function DiferenciaClavePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-[#e3ebea] bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <HelpCircle className="size-4 shrink-0 text-[#7c8f92]" />
        <span className="flex-1 text-[11px] font-bold text-[#557276]">En que se diferencia de una clave o contrasena</span>
        <ChevronDown className={`size-4 text-[#a7b8b9] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 text-[11px] leading-5 text-[#6b8386]">
          <p>
            Una clave (como ClaveUnica) te identifica frente a un sistema para que hagas tramites en linea. Este QR
            hace algo distinto: autoriza <strong>un ingreso fisico puntual</strong> a este recinto, se muestra a una
            persona (el portero) y deja de servir apenas se usa o pasan unos segundos. No reemplaza tu clave, resuelve
            un problema diferente.
          </p>
        </div>
      )}
    </div>
  );
}

export function MyAccessPage() {
  const { token, user } = useAuth();
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [ttl, setTtl] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const expiresAtRef = useRef<number>(0);

  useEffect(() => {
    if (!qrValue) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.round((expiresAtRef.current - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setQrValue(null);
        clearInterval(interval);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [qrValue]);

  async function handleGenerate() {
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.generateQr(token);
      expiresAtRef.current = new Date(`${res.expires_at}Z`).getTime();
      setQrValue(res.token);
      setSecondsLeft(res.ttl_seconds);
      setTtl(res.ttl_seconds);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el QR");
    } finally {
      setLoading(false);
    }
  }

  const progress = qrValue && ttl ? secondsLeft / ttl : 0;
  const circumference = 2 * Math.PI * 26;

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
          <span className="size-1.5 rounded-full bg-[#1ba792]" /> Hola, {user?.full_name?.split(" ")[0]}
        </div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Mi acceso</h1>
        <p className="mt-2 text-[13px] leading-6 text-[#82989a]">
          Genera un codigo QR de un solo uso y presentalo en porteria para ingresar al recinto.
        </p>

        <div className="mt-6 overflow-hidden rounded-[24px] border border-[#e3ebea] bg-white shadow-[0_12px_32px_rgba(37,73,79,.06)]">
          <div className="flex items-center justify-between border-b border-[#edf2f1] px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-[#e5f7f1]">
                <QrCode className="size-[19px] text-[#0e806c]" />
              </div>
              <div>
                <p className="font-display text-[14px] font-extrabold text-[#234953]">Codigo de acceso</p>
                <p className="text-[11px] text-[#96a8a9]">Un solo uso{ttl ? `, expira en ${ttl}s` : ", tiempo limitado"}</p>
              </div>
            </div>
            {qrValue && (
              <span className="rounded-full bg-[#e7f7f1] px-2.5 py-1 text-[9px] font-extrabold text-[#15917c]">Activo</span>
            )}
          </div>

          <div className="flex flex-col items-center gap-5 px-6 py-8">
            {qrValue ? (
              <>
                <div className="rounded-2xl bg-white p-4 shadow-[0_6px_20px_rgba(37,73,79,.08)] ring-1 ring-[#edf2f1]">
                  <QRCodeSVG value={qrValue} size={220} />
                </div>
                <div className="flex items-center gap-3">
                  <svg width="60" height="60" viewBox="0 0 60 60" className="-rotate-90">
                    <circle cx="30" cy="30" r="26" fill="none" stroke="#e3ebea" strokeWidth="5" />
                    <circle
                      cx="30"
                      cy="30"
                      r="26"
                      fill="none"
                      stroke="#18ac98"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference * (1 - progress)}
                      style={{ transition: "stroke-dashoffset .25s linear" }}
                    />
                  </svg>
                  <div>
                    <p className="font-display text-[20px] font-extrabold tracking-[-.03em] text-[#173c47]">{secondsLeft}s</p>
                    <p className="text-[10px] text-[#9aacad]">restantes o hasta escanear</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#dbe8e5] text-center">
                <QrCode className="size-8 text-[#b7cbc9]" />
                <p className="px-6 text-[11px] font-semibold text-[#9aacad]">Sin codigo activo</p>
              </div>
            )}

            {error && (
              <div className="w-full rounded-xl bg-[#fdeceb] px-3 py-2.5 text-[11px] font-semibold text-[#c6505b]">
                <p className="flex items-center gap-2">
                  <TriangleAlert className="size-3.5 shrink-0" /> {error}
                </p>
                <p className="mt-1 font-normal text-[#b96b6b]">
                  Puedes intentarlo de nuevo sin salir de esta pantalla.
                </p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-3 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(18,63,74,.18)] transition hover:-translate-y-0.5 hover:bg-[#0c5360] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Generando..." : error ? "Reintentar" : qrValue ? "Generar nuevo QR" : "Generar QR de acceso"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-[#f1f8f6] px-4 py-3 text-[11px] font-semibold text-[#5f7a7d]">
          <ShieldCheck className="size-4 text-[#18a892]" /> Cada codigo se invalida automaticamente al usarse.
        </div>

        <QueEsEstoPanel />
        <DiferenciaClavePanel />
      </div>
    </div>
  );
}
