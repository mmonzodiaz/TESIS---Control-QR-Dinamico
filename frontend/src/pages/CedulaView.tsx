import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronDown, HelpCircle, Info, Loader2, MapPin, QrCode, Sun, X } from "lucide-react";
import { api, type PublicEvent } from "../api";
import { CedulaCard } from "../components/CedulaCard";
import { PinPad } from "../components/PinPad";
import { buildQr, photoDataUrl } from "../credential";
import { formatRut } from "../rut";
import {
  clearPinAttempts,
  loadPinAttempts,
  openWallet,
  PIN_LENGTH,
  registerPinFailure,
  serverNow,
  WrongPinError,
  type SealedWallet,
  type UnlockedWallet,
} from "../wallet";

// Cada cuánto se renueva el QR. Coincide con QR_TTL_SECONDS de los lectores (docs/ttl-justification.md).
const QR_REFRESH_SECONDS = 45;

/** Tarjeta de información que se despliega: ícono, título y contenido. */
function InfoCard({
  icon,
  title,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="info-card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className="info-icon">{icon}</span>
        <span className="flex-1 text-[15px] font-bold text-ink">{title}</span>
        <ChevronDown className={`size-5 shrink-0 text-ink-3 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-2.5 px-4 pb-4 text-[15px] leading-6 text-ink-2">{children}</div>}
    </div>
  );
}

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
    <InfoCard icon={<Info className="size-[18px]" />} title="Qué es esto y para qué sirve" open={open} onToggle={() => setOpen((v) => !v)}>
      <p>
        El QR de tu carnet físico es siempre el mismo: una foto o fotocopia sirve igual que el original. Este código lo genera
        tu teléfono y dura unos segundos. Lleva tu foto, nombre y RUN firmados por el Registro Civil y cifrados: solo un lector
        autorizado puede verlos.
      </p>
      <p>
        Cambia cada {QR_REFRESH_SECONDS} segundos y sirve una sola vez. Una captura de tu pantalla no le sirve a nadie, y si otra
        persona lo muestra, el guardia ve tu foto, no la suya.
      </p>
    </InfoCard>
  );
}

// Mensajería comparativa explícita para el arquetipo "Escéptico" (11 %): cree que esto equivale a
// una clave como ClaveÚnica y no percibe valor diferencial (Anexo A.2).
export function DiferenciaClavePanel() {
  const [open, setOpen] = useState(false);
  return (
    <InfoCard
      icon={<HelpCircle className="size-[18px]" />}
      title="¿En qué se diferencia de una clave o contraseña?"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <p>
        Una clave, como la ClaveÚnica, te identifica ante un sistema para hacer trámites en línea. Este QR acredita tu identidad
        en persona, ante quien te escanea (por ejemplo, en la entrada de un estadio), y deja de servir apenas se usa o pasan unos
        segundos. No reemplaza tu clave: resuelve otro problema.
      </p>
    </InfoCard>
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
    <InfoCard icon={<MapPin className="size-[18px]" />} title="Dónde puedes usarla" open={open} onToggle={toggle}>
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
          <ul className="flex flex-col gap-2">
            {accepted.events.map((event) => (
              <li key={`${event.name}-${event.starts_at}`} className="rounded-[12px] bg-paper px-3 py-2.5">
                <span className="font-bold text-ink">{event.name}</span>
                {event.starts_at && <span className="block text-[14px]">{formatEventDate(event.starts_at)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[14px] leading-5">
        Tu carnet físico sigue sirviendo: quien no use la cédula digital entra por la fila normal. Al consultar esta lista no se
        envía tu RUN ni tu cédula.
      </p>
    </InfoCard>
  );
}

/**
 * Antes de cada QR se vuelve a pedir el PIN: si alguien toma el teléfono con la cédula abierta, no puede
 * mostrar un código sin saberlo. Comparte el contador de intentos y el bloqueo con la pantalla de ingreso.
 */
function PinGate({ sealed, onConfirmed, onCancel }: { sealed: SealedWallet; onConfirmed: () => void; onCancel: () => void }) {
  const [attempts, setAttempts] = useState(loadPinAttempts);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lockedFor = Math.max(0, Math.ceil((attempts.lockedUntil - now) / 1000));

  useEffect(() => {
    if (!attempts.lockedUntil) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [attempts.lockedUntil]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function check(pin: string) {
    setBusy(true);
    setError(null);
    try {
      await openWallet(pin, sealed);
      clearPinAttempts();
      onConfirmed();
      return true;
    } catch (err) {
      if (!(err instanceof WrongPinError)) throw err;
      const next = registerPinFailure(attempts);
      setAttempts(next);
      setNow(Date.now());
      setError(next.lockedUntil ? "Demasiados intentos. Espera un minuto." : "PIN incorrecto. Inténtalo de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-gate-title"
      className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-paper px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))]"
    >
      <div className="flex w-full max-w-[420px] flex-col items-center">
        <span className="grid size-14 place-items-center rounded-full bg-tint text-brand">
          <QrCode className="size-7" />
        </span>
        <h2 id="pin-gate-title" className="mt-4 text-[22px] font-extrabold text-ink">
          Confirma tu PIN
        </h2>
        <p className="mt-1 text-center text-[15px] text-ink-2">Para mostrar tu código QR.</p>
        <div className="mt-7 w-full">
          {lockedFor > 0 ? (
            <p role="status" className="notice notice-warn py-4 text-center font-bold">
              Bloqueado por seguridad. Intenta de nuevo en {lockedFor} s.
            </p>
          ) : (
            <PinPad length={PIN_LENGTH} onComplete={check} disabled={busy} />
          )}
        </div>
        {busy && (
          <p className="mt-3 flex items-center gap-2 text-[14px] text-ink-2">
            <Loader2 className="size-4 animate-spin" /> Verificando…
          </p>
        )}
        {error && (
          <p role="alert" className="notice notice-error mt-4 w-full">
            {error}
          </p>
        )}
        <button type="button" onClick={onCancel} className="mt-5 py-2 text-[15px] font-bold text-ink-2 hover:text-ink">
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Cuenta regresiva circular: se entiende de un vistazo cuánto le queda al código. */
function Countdown({ secondsLeft }: { secondsLeft: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative size-[76px]" aria-hidden>
      <svg viewBox="0 0 76 76" className="size-full -rotate-90">
        <circle cx="38" cy="38" r={radius} fill="none" stroke="var(--color-tint)" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - secondsLeft / QR_REFRESH_SECONDS)}
          className="transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none"
        />
      </svg>
      <span className="tnum absolute inset-0 grid place-items-center text-[20px] font-extrabold text-ink">{secondsLeft}</span>
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
    <div role="dialog" aria-modal="true" aria-label="Tu código QR" className="fixed inset-0 z-50 flex flex-col bg-paper">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-3">
          <img src={photo} alt="" className="size-11 shrink-0 rounded-full object-cover ring-2 ring-surface" />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-extrabold text-ink">{wallet.identity.name}</p>
            <p className="tnum text-[14px] font-medium text-ink-2">RUN {formatRut(wallet.identity.rut)}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Cerrar QR" className="btn btn-secondary size-11 shrink-0 rounded-full p-0">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4">
        <p className="text-[18px] font-extrabold text-ink">Muéstralo en la entrada</p>
        <div className="aspect-square w-full max-w-[min(90vw,58vh)] rounded-[22px] bg-white p-4 shadow-soft">
          {qrValue && <QRCodeSVG value={qrValue} size={600} level="L" title="Código QR de tu cédula" className="h-auto w-full" />}
        </div>
        <div className="flex items-center gap-3">
          <Countdown secondsLeft={secondsLeft} />
          <p className="max-w-[200px] text-[15px] font-medium leading-snug text-ink-2">
            Se renueva en <span className="tnum font-extrabold text-ink">{secondsLeft}</span> s. Sirve una sola vez.
          </p>
        </div>
      </div>

      <p className="flex items-center justify-center gap-2 px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-[14px] font-medium text-ink-2">
        <Sun className="size-4" /> Sube el brillo al máximo para que se lea mejor.
      </p>
    </div>
  );
}

/** La cédula abierta: el estado, el documento y el acceso al QR, que se genera sin conexión tras confirmar el PIN. */
export function CedulaView({ wallet, sealed }: { wallet: UnlockedWallet; sealed: SealedWallet }) {
  const [stage, setStage] = useState<"home" | "pin" | "qr">("home");

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4">
      <h1 className="sr-only">Tu cédula digital</h1>
      <span className="inline-flex items-center gap-2 self-start rounded-full bg-ok-soft px-3 py-1.5 text-[13px] font-bold text-ok">
        <span className="size-2 rounded-full bg-ok" aria-hidden /> Tu cédula está activa
      </span>
      <CedulaCard identity={wallet.identity} photo={wallet.credential.photo} />

      <button onClick={() => setStage("pin")} className="btn btn-primary btn-lg mt-1">
        <QrCode className="size-5" /> Mostrar mi QR
      </button>
      <p className="text-center text-[14px] leading-5 text-ink-2">
        Te pediremos tu PIN. El código funciona sin conexión y solo este teléfono puede generarlo.
      </p>

      <div className="mt-2 flex flex-col gap-3">
        <QueEsEstoPanel />
        <DondeSeAceptaPanel />
        <DiferenciaClavePanel />
      </div>

      {stage === "pin" && <PinGate sealed={sealed} onConfirmed={() => setStage("qr")} onCancel={() => setStage("home")} />}
      {stage === "qr" && <QrScreen wallet={wallet} onClose={() => setStage("home")} />}
    </div>
  );
}
