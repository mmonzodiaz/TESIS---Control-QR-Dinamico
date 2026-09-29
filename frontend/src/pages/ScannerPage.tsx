import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { CheckCircle2, ImageUp, Loader2, ShieldAlert, TriangleAlert, UserCheck, UserX, WifiOff, X, XCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type QRValidateRequest, type QRValidateResponse, type VerifierKeys } from "../api";
import { installBarcodeDetector } from "../barcodeDetector";
import { b64decode, checkIdentity, CredentialError, decodeQr, photoDataUrl, validatePayload, type IdentityCore } from "../credential";
import { REASON_LABEL } from "../reasons";
import { formatRut } from "../rut";
import { useEventSelection } from "../useEventSelection";

// Escaner del guardia, pensado para su celular: camara a pantalla completa y el resultado en un
// panel inferior con la foto grande. Flujo en dos pasos (ADR-12): el servidor verifica sin
// registrar ("check"), el guardia compara la foto con la persona y recien ahi decide.

const SCANNER_ELEMENT_ID = "qr-scanner-region";
const FILE_SCANNER_ELEMENT_ID = "qr-file-region";
// El QR lleva la foto y es denso: se lee con BarcodeDetector (nativo o polyfill ZXing-C++), no con zxing-js.
const READER_CONFIG = {
  verbose: false,
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
  useBarCodeDetectorIfSupported: true,
};
installBarcodeDetector();
// Un ingreso concedido se cierra solo; los rechazos esperan a que el guardia toque "Siguiente".
const GRANTED_DISMISS_MS = 1800;

interface Verifier {
  eventId: number;
  eventSecret: Uint8Array;
  issuerPublic: Uint8Array;
  ttl: number;
  skew: number;
  /** server_time - reloj local, en segundos. */
  clockOffset: number;
}

interface Seen {
  identity: IdentityCore;
  photo: Uint8Array;
  payload: QRValidateRequest;
}

type Outcome =
  | { kind: "unreadable"; message: string }
  | ({ kind: "checking" } & Seen)
  | ({ kind: "pending" } & Seen)
  | ({ kind: "deciding" } & Seen)
  | ({ kind: "final"; response: QRValidateResponse } & Seen)
  | ({ kind: "offline"; localReason: string } & Seen);

function toVerifier(keys: VerifierKeys): Verifier {
  return {
    eventId: keys.event_id,
    eventSecret: b64decode(keys.event_private_key),
    issuerPublic: b64decode(keys.issuer_public_key),
    ttl: keys.ttl_seconds,
    skew: keys.clock_skew_seconds,
    clockOffset: keys.server_time - Date.now() / 1000,
  };
}

/** Chequeo de vigencia sin red (el servidor repite este chequeo y ademas el de uso unico). */
function localFreshness(v: Verifier, issuedAt: number): string {
  const now = Date.now() / 1000 + v.clockOffset;
  if (issuedAt > now + v.skew) return "invalid";
  if (now - issuedAt > v.ttl + v.skew) return "expired";
  return "ok";
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // no todos los navegadores lo permiten
  }
}

export function ScannerPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastQrRef = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysReady, setKeysReady] = useState(false);
  const { events, gates, eventId, setEventId, gateId, setGateId } = useEventSelection(token);
  // El callback del lector se registra una sola vez; leer puerta y claves desde refs evita
  // que queden "congeladas" en el valor del primer render.
  const gateIdRef = useRef<number | null>(gateId);
  gateIdRef.current = gateId;
  const verifierRef = useRef<Verifier | null>(null);

  useEffect(() => {
    // Claves del evento elegido: con ellas el lector descifra y verifica el QR sin depender de la red.
    verifierRef.current = null;
    if (!token || eventId === null) return;
    api
      .verifierKeys(token, eventId)
      .then((keys) => {
        verifierRef.current = toVerifier(keys);
        setKeysError(null);
        setKeysReady(true);
      })
      .catch(() => setKeysError("No se pudieron obtener las claves del evento para leer los QR."));
  }, [token, eventId]);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, READER_CONFIG);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          // Sin recuadro: se lee el cuadro completo. Resolucion alta porque el QR con foto es denso.
          videoConstraints: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        },
        (decodedText) => void handleScan(decodedText),
        undefined,
      )
      .catch((err) => setCameraError(`No se pudo acceder a la camara: ${String(err)}`));

    return () => {
      try {
        scanner
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              scanner.clear();
            } catch {
              // el scanner nunca llego a montarse (p.ej. camara no encontrada)
            }
          });
      } catch {
        // idem: stop() puede lanzar de forma sincrona si nunca inicio
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Pantalla siempre encendida mientras se escanea (si el navegador lo permite).
    let lock: WakeLockSentinel | null = null;
    async function acquire() {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    }
    function onVisibility() {
      if (!document.hidden) void acquire();
    }
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, []);

  function pauseCamera() {
    try {
      scannerRef.current?.pause(true);
    } catch {
      // sin camara activa (p. ej. lectura desde imagen)
    }
  }

  function resumeCamera() {
    try {
      scannerRef.current?.resume();
    } catch {
      // idem
    }
  }

  function next() {
    setOutcome(null);
    busyRef.current = false;
    resumeCamera();
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    // Sin camara (p. ej. en un computador): se lee el QR desde una foto o captura de la pantalla del telefono.
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await new Html5Qrcode(FILE_SCANNER_ELEMENT_ID, READER_CONFIG).scanFile(file, false);
      lastQrRef.current = null;
      busyRef.current = false;
      await handleScan(text);
    } catch {
      setOutcome({ kind: "unreadable", message: "No se encontro un QR legible en la imagen" });
    }
  }

  async function handleScan(qrText: string) {
    // La camara ve el mismo QR varias veces por segundo: se procesa una sola vez.
    if (!token || busyRef.current || qrText === lastQrRef.current) return;
    const verifier = verifierRef.current;
    if (!verifier) return;
    busyRef.current = true;
    lastQrRef.current = qrText;
    pauseCamera();

    let contents;
    let identity: IdentityCore;
    try {
      contents = decodeQr(qrText, verifier.eventSecret);
      identity = checkIdentity(contents, verifier.issuerPublic);
    } catch (err) {
      vibrate([90, 60, 90]);
      setOutcome({ kind: "unreadable", message: err instanceof CredentialError ? err.message : "QR invalido" });
      return;
    }
    const seen: Seen = { identity, photo: contents.photo, payload: validatePayload(contents, gateIdRef.current) };
    // La foto aparece de inmediato; el servidor verifica (sin registrar) en paralelo.
    setOutcome({ ...seen, kind: "checking" });
    try {
      const response = await api.validateQr(token, { ...seen.payload, action: "check" });
      if (response.pending) {
        vibrate(60);
        setOutcome({ ...seen, kind: "pending" });
      } else {
        vibrate([90, 60, 90]);
        setOutcome({ ...seen, kind: "final", response });
      }
    } catch {
      const localReason = contents.eventId !== verifier.eventId ? "wrong_event" : localFreshness(verifier, contents.issuedAt);
      setOutcome({ ...seen, kind: "offline", localReason });
    }
  }

  async function decide(seen: Seen, samePerson: boolean) {
    if (!token) return;
    setOutcome({ ...seen, kind: "deciding" });
    try {
      const response = await api.validateQr(token, { ...seen.payload, action: samePerson ? "admit" : "reject" });
      vibrate(response.granted ? 120 : [90, 60, 90]);
      setOutcome({ ...seen, kind: "final", response });
      if (response.granted) setTimeout(() => next(), GRANTED_DISMISS_MS);
    } catch {
      setOutcome({ ...seen, kind: "offline", localReason: "ok" });
    }
  }

  const status = keysError ?? cameraError ?? (keysReady || eventId === null ? null : "Cargando claves del evento...");

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      {/* Barra superior */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 pb-8 pt-[max(12px,env(safe-area-inset-top))]">
        <button
          onClick={() => navigate("/historial")}
          aria-label="Salir del escaner"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15 backdrop-blur"
        >
          <X className="size-5" />
        </button>
        <select
          value={eventId ?? ""}
          onChange={(e) => setEventId(Number(e.target.value))}
          aria-label="Evento"
          className="min-w-0 flex-1 truncate rounded-full bg-white/15 px-3 py-2 text-[12px] font-bold outline-none backdrop-blur [&>option]:text-black"
        >
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
        <select
          value={gateId ?? ""}
          onChange={(e) => setGateId(Number(e.target.value))}
          aria-label="Fila"
          className="w-[34%] min-w-0 truncate rounded-full bg-white/15 px-3 py-2 text-[12px] font-bold outline-none backdrop-blur [&>option]:text-black"
        >
          {gates.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label
          aria-label="Leer QR desde una imagen"
          className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-white/15 backdrop-blur"
        >
          <ImageUp className="size-5" />
          <input type="file" accept="image/*" onChange={handleImage} className="hidden" />
        </label>
      </div>

      {/* Camara a pantalla completa */}
      <div className="relative flex-1 overflow-hidden">
        <div id={SCANNER_ELEMENT_ID} className="absolute inset-0 [&_video]:!h-full [&_video]:!w-full [&_video]:!object-cover" />
        <div id={FILE_SCANNER_ELEMENT_ID} className="hidden" />
        {!outcome && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative size-[min(72vw,340px)]">
              {[
                "left-0 top-0 rounded-tl-3xl border-l-4 border-t-4",
                "right-0 top-0 rounded-tr-3xl border-r-4 border-t-4",
                "bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4",
                "bottom-0 right-0 rounded-br-3xl border-b-4 border-r-4",
              ].map((corner) => (
                <span key={corner} className={`absolute size-12 border-[#3ee0c6] ${corner}`} />
              ))}
            </div>
          </div>
        )}
        {!outcome && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-10">
            {status ? (
              <p className="flex max-w-[480px] items-start gap-2 rounded-2xl bg-[#c6505b]/90 px-4 py-2.5 text-[12px] font-semibold">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {status}
              </p>
            ) : (
              <p className="rounded-full bg-white/15 px-4 py-2 text-[13px] font-bold backdrop-blur">Apunta al QR de la persona</p>
            )}
          </div>
        )}
      </div>

      {outcome && <ResultSheet outcome={outcome} onDecide={decide} onNext={next} />}
    </div>
  );
}

function BigIdentity({ identity, photo }: { identity: IdentityCore; photo: Uint8Array }) {
  const src = useMemo(() => photoDataUrl(photo), [photo]);
  return (
    <div className="flex items-center gap-4">
      <img src={src} alt={`Foto de ${identity.name}`} className="h-[188px] w-[141px] shrink-0 rounded-2xl bg-[#eef3f2] object-cover shadow-md" />
      <div className="min-w-0">
        <p className="text-[9px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">Firmado por el Registro Civil</p>
        <p className="mt-1 font-display text-[22px] font-extrabold leading-tight tracking-[-.02em] text-[#173c47]">{identity.name}</p>
        <p className="mt-1.5 font-mono text-[14px] font-semibold text-[#557276]">{formatRut(identity.rut)}</p>
      </div>
    </div>
  );
}

function ResultSheet({ outcome, onDecide, onNext }: { outcome: Outcome; onDecide: (seen: Seen, samePerson: boolean) => void; onNext: () => void }) {
  const sheet =
    "absolute inset-x-0 bottom-0 z-30 mx-auto max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 text-[#173c47] shadow-[0_-12px_40px_rgba(0,0,0,.35)]";
  const nextButton = (
    <button onClick={onNext} className="mt-5 w-full rounded-2xl bg-[#123f4a] py-4 text-[15px] font-extrabold text-white">
      Siguiente
    </button>
  );

  if (outcome.kind === "unreadable") {
    return (
      <div className={sheet}>
        <Banner tone="bad" icon={<XCircle className="size-7" />} title={REASON_LABEL.invalid} detail={outcome.message} />
        {nextButton}
      </div>
    );
  }

  let banner;
  let actions = nextButton;
  if (outcome.kind === "checking" || outcome.kind === "deciding") {
    banner = (
      <Banner
        tone="neutral"
        icon={<Loader2 className="size-7 animate-spin" />}
        title={outcome.kind === "checking" ? "Verificando entrada..." : "Registrando..."}
      />
    );
    actions = <div className="mt-5 h-[60px]" />;
  } else if (outcome.kind === "pending") {
    banner = <Banner tone="info" icon={<ShieldAlert className="size-7" />} title="Cedula valida y entrada vigente" detail="¿Es la persona que tienes al frente?" />;
    actions = (
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          onClick={() => onDecide(outcome, false)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-[#fdeceb] py-4 text-[15px] font-extrabold text-[#c6505b]"
        >
          <UserX className="size-5" /> No coincide
        </button>
        <button
          onClick={() => onDecide(outcome, true)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-[#0e806c] py-4 text-[15px] font-extrabold text-white"
        >
          <UserCheck className="size-5" /> Dejar pasar
        </button>
      </div>
    );
  } else if (outcome.kind === "offline") {
    banner = (
      <Banner
        tone="warn"
        icon={<WifiOff className="size-7" />}
        title={`Sin conexion: ${outcome.localReason === "ok" ? "cedula autentica y QR vigente" : REASON_LABEL[outcome.localReason]}`}
        detail="No se pudo comprobar uso unico ni prohibiciones, ni registrar el ingreso. Aplica el protocolo sin conexion."
      />
    );
  } else if (outcome.response.granted) {
    banner = <Banner tone="good" icon={<CheckCircle2 className="size-7" />} title="Ingreso registrado" />;
    actions = <div className="mt-5 h-[60px]" />;
  } else {
    banner = <Banner tone="bad" icon={<XCircle className="size-7" />} title={REASON_LABEL[outcome.response.reason] ?? outcome.response.reason} />;
  }

  return (
    <div className={sheet}>
      {banner}
      <div className="mt-4">
        <BigIdentity identity={outcome.identity} photo={outcome.photo} />
      </div>
      {actions}
    </div>
  );
}

function Banner({ tone, icon, title, detail }: { tone: "good" | "bad" | "info" | "warn" | "neutral"; icon: React.ReactNode; title: string; detail?: string }) {
  const tones = {
    good: "bg-[#e5f7f1] text-[#0e806c]",
    bad: "bg-[#fdeceb] text-[#c6505b]",
    info: "bg-[#e8f3fb] text-[#2c567f]",
    warn: "bg-[#fff3d9] text-[#a26a11]",
    neutral: "bg-[#f2f7f5] text-[#557276]",
  };
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${tones[tone]}`}>
      {icon}
      <div className="min-w-0">
        <p className="text-[17px] font-extrabold leading-tight">{title}</p>
        {detail && <p className="mt-0.5 text-[12px] font-semibold opacity-85">{detail}</p>}
      </div>
    </div>
  );
}
