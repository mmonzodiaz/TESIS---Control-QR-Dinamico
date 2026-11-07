import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronDown, HelpCircle, Info, Loader2, MapPin, QrCode, Sun, X } from "lucide-react";
import { api, type PublicEvent } from "../api";
import { CedulaCard } from "../components/CedulaCard";
import { buildQr, photoDataUrl } from "../credential";
import { formatRut } from "../rut";
import { serverNow, type UnlockedWallet } from "../wallet";

// Cada cuánto se renueva el QR. Coincide con QR_TTL_SECONDS de los lectores (docs/ttl-justification.md).
const QR_REFRESH_SECONDS = 45;

// Onboarding informativo para el arquetipo "Mayoría desinformada activa" (47 % de la muestra):
// personas digitalmente capaces que nunca oyeron hablar del mecanismo, dispuestas a usarlo si
// entienden cómo funciona (Anexo A.2). Se muestra expandido solo la primera vez de cada navegador:
// queda marcado como visto al mostrarlo, no al cerrarlo.
const QUE_ES_ESTO_KEY = "control-acceso-que-es-esto-visto";

export function QueEsEstoPanel() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(QUE_ES_ESTO_KEY) !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(QUE_ES_ESTO_KEY, "1");
    } catch {
      // localStorage puede fallar (modo privado); no es crítico
    }
  }, []);

  return (
    <div>
      <button type="button" onClick={() => setOpen((prev) => !prev)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <Info className="size-5 shrink-0 text-ink-2" strokeWidth={1.75} />
        <span className="flex-1 text-[15px] font-semibold text-ink">Qué es esto y para qué sirve</span>
        <ChevronDown className={`size-5 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2.5 px-4 pb-4 text-[15px] leading-6 text-ink-2">
          <p>
            El QR de tu carnet físico es siempre el mismo: una foto o fotocopia sirve igual que el original. Este código lo
            genera tu teléfono y dura unos segundos. Lleva tu foto, nombre y RUN firmados por el Registro Civil y cifrados:
            solo un lector autorizado puede verlos.
          </p>
          <p>
            Cambia cada {QR_REFRESH_SECONDS} segundos y sirve una sola vez. Una captura de tu
            pantalla no le sirve a nadie, y si otra persona lo muestra, el guardia ve tu foto, no la suya.
          </p>
        </div>
      )}
    </div>
  );
}

// Mensajería comparativa explícita para el arquetipo "Escéptico" (11 %): cree que esto equivale a
// una clave como ClaveÚnica y no percibe valor diferencial (Anexo A.2).
export function DiferenciaClavePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <HelpCircle className="size-5 shrink-0 text-ink-2" strokeWidth={1.75} />
        <span className="flex-1 text-[15px] font-semibold text-ink">¿En qué se diferencia de una clave o contraseña?</span>
        <ChevronDown className={`size-5 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <p className="px-4 pb-4 text-[15px] leading-6 text-ink-2">
          Una clave, como la ClaveÚnica, te identifica ante un sistema para hacer trámites en línea. Este QR{" "}
          acredita tu identidad en persona, ante quien te escanea (por ejemplo, en la entrada de un estadio),
          y deja de servir apenas se usa o pasan unos segundos. No reemplaza tu clave: resuelve otro problema.
        </p>
      )}
    </div>
  );
}

function formatEventDate(value: string) {
  // El backend guarda UTC sin zona.
  return new Date(`${value}Z`).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
}

type AcceptedEvents = { kind: "loading" } | { kind: "error" } | { kind: "ok"; events: PublicEvent[] };

// Para el arquetipo "Adoptante potencial informado" (25 %): dispuesto a usarla, pero no sabe dónde le
// sirve (Anexo A.2: "mostrar dónde se acepta hoy"), y para la barrera del rechazo institucional. Se
// consulta solo al abrir el panel: la cédula no necesita hablar con el recinto para funcionar (ADR-13).
export function DondeSeAceptaPanel() {
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedEvents | null>(null);

  function load() {
    setAccepted({ kind: "loading" });
    api
      .publicEvents()
      .then((events) => setAccepted({ kind: "ok", events }))
      .catch(() => setAccepted({ kind: "error" }));
  }

  function toggle() {
    if (!open && accepted?.kind !== "ok") load();
    setOpen((v) => !v);
  }

  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <MapPin className="size-5 shrink-0 text-ink-2" strokeWidth={1.75} />
        <span className="flex-1 text-[15px] font-semibold text-ink">Dónde puedes usarla</span>
        <ChevronDown className={`size-5 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2.5 px-4 pb-4 text-[15px] leading-6 text-ink-2">
          {accepted?.kind === "loading" && (
            <p role="status" className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Buscando eventos…
            </p>
          )}
          {accepted?.kind === "error" && (
            <div role="alert">
              <p>No se pudo cargar la lista. Tu cédula funciona igual: esto solo es informativo.</p>
              <button type="button" onClick={load} className="btn-link mt-1.5">
                Reintentar
              </button>
            </div>
          )}
          {accepted?.kind === "ok" && accepted.events.length === 0 && <p>Por ahora no hay eventos con fila de cédula digital.</p>}
          {accepted?.kind === "ok" && accepted.events.length > 0 && (
            <>
              <p>Eventos de este prototipo con fila de cédula digital:</p>
              <ul className="border-y border-line-soft">
                {accepted.events.map((event) => (
                  <li key={`${event.name}-${event.starts_at}`} className="border-b border-line-soft py-2 last:border-b-0">
                    <span className="font-semibold text-ink">{event.name}</span>
                    {event.starts_at && <span className="block text-[14px]">{formatEventDate(event.starts_at)}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-[14px] leading-5">
            Tu carnet físico sigue sirviendo: quien no use la cédula digital entra por la fila normal. Al consultar esta lista no
            se envía tu RUN ni tu cédula.
          </p>
        </div>
      )}
    </div>
  );
}

/** QR a pantalla completa, con renovación automática. Así lo lee mejor una cámara o una pistola. */
function QrScreen({ wallet, onClose }: { wallet: UnlockedWallet; onClose: () => void }) {
  const [qrValue, setQrValue] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(QR_REFRESH_SECONDS);
  const expiresAtRef = useRef(0);
  const photo = useMemo(() => photoDataUrl(wallet.credential.photo), [wallet]);

  function renew() {
    // Sin conexión: todo lo necesario está en el teléfono (cédula y clave desbloqueadas con el PIN).
    setQrValue(
      buildQr({
        credential: wallet.credential,
        deviceSecret: wallet.deviceSecret,
        verifierPublic: wallet.verifierPublic,
        issuedAt: serverNow(),
      }),
    );
    expiresAtRef.current = Date.now() + QR_REFRESH_SECONDS * 1000;
    setSecondsLeft(QR_REFRESH_SECONDS);
  }

  useEffect(() => {
    renew();
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) renew();
    }, 250);
    // Pantalla encendida mientras se muestra el QR (si el navegador lo permite).
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      clearInterval(interval);
      void lock?.release().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="Tu código QR" className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(14px,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-3">
          <img src={photo} alt="" className="h-12 w-9 shrink-0 rounded-[3px] border border-line object-cover" />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-ink">{wallet.identity.name}</p>
            <p className="tnum text-[14px] text-ink-2">RUN {formatRut(wallet.identity.rut)}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Cerrar QR" className="btn btn-secondary size-11 shrink-0 p-0">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4">
        <div className="w-full max-w-[min(92vw,62vh)] rounded-md border border-line bg-white p-3">
          {qrValue && <QRCodeSVG value={qrValue} size={600} level="L" title="Código QR de tu cédula" className="h-auto w-full" />}
        </div>
        <div className="w-full max-w-[min(92vw,62vh)]">
          <div className="h-1 overflow-hidden bg-line-soft">
            <div
              className="h-full bg-ink transition-[width] duration-300 ease-linear motion-reduce:transition-none"
              style={{ width: `${(secondsLeft / QR_REFRESH_SECONDS) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-center text-[15px] text-ink-2">
            Se renueva en <span className="tnum font-semibold text-ink">{secondsLeft}</span> s. Sirve una sola vez.
          </p>
        </div>
      </div>

      <p className="flex items-center justify-center gap-2 px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-[14px] text-ink-2">
        <Sun className="size-4" /> Sube el brillo al máximo para que se lea mejor.
      </p>
    </div>
  );
}

/** La cédula abierta: el documento y el acceso directo al QR, que se genera sin conexión. */
export function CedulaView({ wallet }: { wallet: UnlockedWallet }) {
  const [showQr, setShowQr] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4">
      <h1 className="sr-only">Tu cédula digital</h1>
      <CedulaCard identity={wallet.identity} photo={wallet.credential.photo} />

      <button onClick={() => setShowQr(true)} className="btn btn-primary btn-lg">
        <QrCode className="size-5" /> Mostrar mi QR
      </button>

      <p className="text-[14px] leading-5 text-ink-2">
        Cada código sirve una sola vez y funciona sin conexión. Solo este teléfono puede generarlo.
      </p>

      <div className="disclosure-group mt-4">
        <QueEsEstoPanel />
        <DondeSeAceptaPanel />
        <DiferenciaClavePanel />
      </div>

      {showQr && <QrScreen wallet={wallet} onClose={() => setShowQr(false)} />}
    </div>
  );
}
