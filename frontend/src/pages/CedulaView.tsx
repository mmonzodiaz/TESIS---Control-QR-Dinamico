import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronDown, HelpCircle, Info, QrCode, ShieldCheck, Sun, X } from "lucide-react";
import { CedulaCard } from "../components/CedulaCard";
import { buildQr, photoDataUrl } from "../credential";
import { formatRut } from "../rut";
import { serverNow, type UnlockedWallet } from "../wallet";

// Cada cuánto se renueva el QR. Coincide con QR_TTL_SECONDS de los lectores (docs/ttl-justification.md).
const QR_REFRESH_SECONDS = 45;

// Onboarding informativo para el arquetipo "Mayoría desinformada activa" (47 % de la muestra):
// personas digitalmente capaces que nunca oyeron hablar del mecanismo, dispuestas a usarlo si
// entienden cómo funciona (Anexo A.2). Se muestra expandido la primera vez de cada navegador.
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
      try {
        localStorage.setItem("control-acceso-que-es-esto-visto", "1");
      } catch {
        // localStorage puede fallar (modo privado); no es crítico
      }
      return !prev;
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#d3e5f2] bg-[#f3f9fd]">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <Info className="size-5 shrink-0 text-[#2f6fb3]" />
        <span className="flex-1 text-[14px] font-bold text-[#244a6d]">Qué es esto y para qué sirve</span>
        <ChevronDown className={`size-5 text-[#5d86ad] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2.5 px-4 pb-4 text-[14px] leading-6 text-[#2f4b63]">
          <p>
            El QR de tu carnet físico es siempre el mismo: una foto o fotocopia sirve igual que el original. Este código lo
            genera tu teléfono y dura unos segundos. Lleva tu foto, nombre y RUN firmados por el Registro Civil y cifrados:
            solo un lector autorizado puede verlos.
          </p>
          <p>
            <strong>Cambia solo cada {QR_REFRESH_SECONDS} segundos</strong> y <strong>sirve una sola vez</strong>. Una captura de tu
            pantalla no le sirve a nadie, y si otra persona lo muestra, el guardia ve tu foto, no la suya.
          </p>
        </div>
      )}
    </div>
  );
}

// Mensajería comparativa explícita para el arquetipo "Escéptico" (11 %): cree que esto equivale a
// una clave como ClaveÚnica y no percibe valor diferencial (Anexo A.2).
function DiferenciaClavePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#dde8e6] bg-white">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <HelpCircle className="size-5 shrink-0 text-[#4f6a6d]" />
        <span className="flex-1 text-[14px] font-bold text-[#34565c]">¿En qué se diferencia de una clave?</span>
        <ChevronDown className={`size-5 text-[#7c9496] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <p className="px-4 pb-4 text-[14px] leading-6 text-[#3d5a5e]">
          Una clave, como la ClaveÚnica, te identifica ante un sistema para hacer trámites en línea. Este QR{" "}
          <strong>acredita tu identidad en persona</strong>, ante quien te escanea (por ejemplo, en la entrada de un estadio),
          y deja de servir apenas se usa o pasan unos segundos. No reemplaza tu clave: resuelve otro problema.
        </p>
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
          <img src={photo} alt="" className="h-12 w-9 shrink-0 rounded-md object-cover ring-1 ring-[#cfe3dd]" />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-extrabold text-[#123f4a]">{wallet.identity.name}</p>
            <p className="font-mono text-[13px] text-[#4f6a6d]">RUN {formatRut(wallet.identity.rut)}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Cerrar QR" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#eef4f3] text-[#34565c]">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4">
        <div className="w-full max-w-[min(92vw,62vh)] rounded-2xl bg-white p-2 ring-1 ring-[#e3ebea]">
          {qrValue && <QRCodeSVG value={qrValue} size={600} level="L" className="h-auto w-full" />}
        </div>
        <div className="w-full max-w-[min(92vw,62vh)]">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#e3ebea]">
            <div
              className="h-full rounded-full bg-[#18ac98] transition-[width] duration-300 ease-linear"
              style={{ width: `${(secondsLeft / QR_REFRESH_SECONDS) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-center text-[14px] font-semibold text-[#3d5a5e]">
            Se renueva en <span className="font-mono tabular-nums">{secondsLeft}</span> s · sirve una sola vez
          </p>
        </div>
      </div>

      <p className="flex items-center justify-center gap-2 px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-[13px] font-semibold text-[#4f6a6d]">
        <Sun className="size-4" /> Sube el brillo al máximo para que se lea mejor
      </p>
    </div>
  );
}

/** La cédula abierta: el documento y el acceso directo al QR, que se genera sin conexión. */
export function CedulaView({ wallet }: { wallet: UnlockedWallet }) {
  const [showQr, setShowQr] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4">
      <CedulaCard identity={wallet.identity} photo={wallet.credential.photo} />

      <button
        onClick={() => setShowQr(true)}
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[#123f4a] px-4 py-4 text-[16px] font-extrabold text-white shadow-[0_10px_22px_rgba(18,63,74,.2)] transition active:scale-[.99]"
      >
        <QrCode className="size-5" /> Mostrar mi QR
      </button>

      <p className="flex items-start gap-2.5 rounded-2xl bg-[#eaf5f1] px-4 py-3 text-[13px] font-semibold leading-5 text-[#2f5b56]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#0e806c]" />
        Cada código sirve una sola vez y funciona sin conexión. Solo este teléfono puede generarlo.
      </p>

      <QueEsEstoPanel />
      <DiferenciaClavePanel />

      {showQr && <QrScreen wallet={wallet} onClose={() => setShowQr(false)} />}
    </div>
  );
}
