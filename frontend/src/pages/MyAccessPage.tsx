import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, ChevronDown, HelpCircle, Info, QrCode, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { api, ApiError } from "../api";
import { IdentityCard } from "../components/IdentityCard";
import { b64decode, buildQr } from "../credential";
import { deviceSecret, saveSession, serverNow, type StoredCredential, type StoredSession } from "../wallet";

// Cada cuanto el telefono pregunta si la entrada ya ingreso. Generar el QR no necesita red.
const STATUS_POLL_MS = 5000;

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
            El QR de tu carnet fisico es siempre el mismo: una foto o fotocopia sirve igual que el original. Este
            codigo, en cambio, lo genera tu telefono y solo funciona unos segundos. Lleva tu foto, nombre y RUT
            firmados por el Registro Civil y cifrados: solo el lector del guardia los puede ver.
          </p>
          <p>
            El codigo <strong>cambia solo cada pocos segundos</strong> y <strong>sirve para un unico ingreso</strong>: asi
            nadie puede usar una captura de tu pantalla ni revender tu entrada.
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
            hace algo distinto: autoriza <strong>un ingreso fisico puntual</strong> a este evento, se muestra en la
            puerta y deja de servir apenas se usa o pasan unos segundos. No reemplaza tu clave, resuelve
            un problema diferente.
          </p>
        </div>
      )}
    </div>
  );
}

interface MyAccessPageProps {
  session: StoredSession;
  cedula: StoredCredential;
  /** Se llama si la sesion deja de valer (p.ej. soporte libero la entrada a otro dispositivo). */
  onSessionLost: () => void;
  onSessionRefresh: (session: StoredSession) => void;
}

export function MyAccessPage({ session, cedula, onSessionLost, onSessionRefresh }: MyAccessPageProps) {
  const { attendee, qr: params } = session;
  const ttl = params.ttl_seconds;
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [offline, setOffline] = useState(false);
  // Una vez activado, el QR se renueva solo al expirar: eso es lo "dinamico" para quien espera en la fila.
  const [autoRenew, setAutoRenew] = useState(false);
  const [admitted, setAdmitted] = useState(attendee.admitted_at !== null);
  const expiresAtRef = useRef<number>(0);

  function handleGenerate() {
    // Sin conexion: todo lo necesario esta en el telefono (cedula, clave del dispositivo, clave del evento).
    const issuedAt = serverNow(session.clockOffset);
    setQrValue(
      buildQr({
        credential: cedula.credential,
        deviceSecret: deviceSecret(),
        eventId: params.event_id,
        ticketId: params.ticket_id,
        eventPublic: b64decode(params.event_public_key),
        issuedAt,
      }),
    );
    expiresAtRef.current = (issuedAt - session.clockOffset + ttl) * 1000;
    setSecondsLeft(ttl);
    setAutoRenew(true);
  }

  useEffect(() => {
    if (!qrValue) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.round((expiresAtRef.current - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        setQrValue(null);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [qrValue]);

  useEffect(() => {
    if (autoRenew && !qrValue && !admitted) handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRenew, qrValue]);

  useEffect(() => {
    // Mientras el QR esta activo, pregunta si ya ingreso para pasar a "Ingreso registrado".
    if (!autoRenew || admitted) return;
    const interval = setInterval(() => {
      api
        .myTicket(session.token)
        .then((res) => {
          setOffline(false);
          onSessionRefresh(saveSession(session.token, res.attendee, res.qr));
          if (res.attendee.admitted_at) {
            setAdmitted(true);
            setQrValue(null);
          }
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) onSessionLost();
          else setOffline(true);
        });
    }, STATUS_POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRenew, admitted]);

  const progress = qrValue ? secondsLeft / ttl : 0;
  const circumference = 2 * Math.PI * 26;

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
          <span className="size-1.5 rounded-full bg-[#1ba792]" /> Hola, {attendee.holder_name.split(" ")[0]}
        </div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">{attendee.event.name}</h1>
        <p className="mt-2 text-[13px] leading-6 text-[#82989a]">
          Entrada de {attendee.holder_name} ({attendee.rut_masked}). Activa tu QR al acercarte a la puerta y
          muestralo al guardia.
        </p>

        <div className="mt-6 overflow-hidden rounded-[24px] border border-[#e3ebea] bg-white shadow-[0_12px_32px_rgba(37,73,79,.06)]">
          <div className="flex items-center justify-between border-b border-[#edf2f1] px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-[#e5f7f1]">
                <QrCode className="size-[19px] text-[#0e806c]" />
              </div>
              <div>
                <p className="font-display text-[14px] font-extrabold text-[#234953]">Codigo de acceso</p>
                <p className="text-[11px] text-[#96a8a9]">Un solo uso, se renueva cada {ttl}s</p>
              </div>
            </div>
            {qrValue && (
              <span className="rounded-full bg-[#e7f7f1] px-2.5 py-1 text-[9px] font-extrabold text-[#15917c]">Activo</span>
            )}
          </div>

          <div className="flex flex-col items-center gap-5 px-6 py-8">
            {admitted ? (
              <div className="flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 rounded-2xl bg-[#e5f7f1] text-center">
                <CheckCircle2 className="size-10 text-[#0e806c]" />
                <p className="px-6 text-[13px] font-extrabold text-[#0e806c]">Ingreso registrado</p>
                <p className="px-6 text-[11px] text-[#3d7d70]">Esta entrada ya se uso. Que disfrutes el evento.</p>
              </div>
            ) : qrValue ? (
              <>
                <div className="w-full max-w-[332px] rounded-2xl bg-white p-3 shadow-[0_6px_20px_rgba(37,73,79,.08)] ring-1 ring-[#edf2f1]">
                  {/* Nivel L: el QR lleva la foto (~1,4 KB); con mas correccion de errores seria demasiado denso. */}
                  <QRCodeSVG value={qrValue} size={300} level="L" className="h-auto w-full" />
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
                    <p className="text-[10px] text-[#9aacad]">para el siguiente codigo</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#dbe8e5] text-center">
                <QrCode className="size-8 text-[#b7cbc9]" />
                <p className="px-6 text-[11px] font-semibold text-[#9aacad]">Sin codigo activo</p>
              </div>
            )}

            {offline && (
              <p className="flex w-full items-center gap-2 rounded-xl bg-[#fff3d9] px-3 py-2.5 text-[11px] font-semibold text-[#a26a11]">
                <WifiOff className="size-3.5 shrink-0" /> Sin conexion. Tu QR igual funciona: se genera en este telefono.
              </p>
            )}

            {!admitted && (
            <button
              onClick={handleGenerate}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-3 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(18,63,74,.18)] transition hover:-translate-y-0.5 hover:bg-[#0c5360] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className="size-4" />
              {qrValue ? "Renovar ahora" : "Activar mi QR"}
            </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-[#f1f8f6] px-4 py-3 text-[11px] font-semibold text-[#5f7a7d]">
          <ShieldCheck className="size-4 text-[#18a892]" /> Cada codigo se invalida automaticamente al usarse.
        </div>

        <div className="mt-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#a2b2b3]">Esto vera el guardia al escanear</p>
          <IdentityCard identity={cedula.identity} photo={cedula.credential.photo} caption="Firmado por el Registro Civil" />
        </div>

        <QueEsEstoPanel />
        <DiferenciaClavePanel />
      </div>
    </div>
  );
}
