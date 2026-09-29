import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { CheckCircle2, ImageUp, Loader2, ShieldAlert, TriangleAlert, Usb, UserCheck, UserX, WifiOff, X, XCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type QRValidateRequest, type QRValidateResponse, type VerifierKeys } from "../api";
import { installBarcodeDetector } from "../barcodeDetector";
import { KeyboardWedge, normalizeScannedText } from "../keyboardWedge";
import { connectSerialScanner, isSerialSupported } from "../serialScanner";
import { b64decode, checkQr, CredentialError, decodeQr, photoDataUrl, validatePayload, type IdentityCore } from "../credential";
import { REASON_LABEL } from "../reasons";
import { formatRut } from "../rut";
import { useEventSelection } from "../useEventSelection";

// Escaner del guardia: en su celular (camara a pantalla completa) o en un PC con webcam o con una
// pistola lectora 2D (en modo teclado, o por puerto serie con Web Serial). El resultado aparece en un panel inferior con la foto grande. Flujo en dos pasos (ADR-12): el servidor verifica sin
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
  /** Clave de lectores autorizados: descifra cualquier cedula digital (no solo de este evento). */
  verifierSecret: Uint8Array;
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
    verifierSecret: b64decode(keys.verifier_private_key),
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
  // Pistola por puerto serie: funcion para desconectarla, o null si no esta conectada.
  const [serialDisconnect, setSerialDisconnect] = useState<(() => Promise<void>) | null>(null);
  const [serialError, setSerialError] = useState<string | null>(null);
  // Lo que lleva este guardia en la sesion: da contexto sin ir al historial.
  const [session, setSession] = useState({ admitted: 0, rejected: 0 });
  const { events, gates, eventId, setEventId, gateId, setGateId } = useEventSelection(token);
  // El callback del lector se registra una sola vez; leer puerta y claves desde refs evita
  // que queden "congeladas" en el valor del primer render.
  const gateIdRef = useRef<number | null>(gateId);
  gateIdRef.current = gateId;
  const verifierRef = useRef<Verifier | null>(null);
  const outcomeRef = useRef<Outcome | null>(outcome);
  outcomeRef.current = outcome;

  useEffect(() => {
    // Claves de lector autorizado y del emisor: con ellas se verifica la cedula sin depender de la red.
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
      .catch((err) => setCameraError(`No se pudo acceder a la cámara: ${String(err)}`));

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

  useEffect(() => {
    // Pistola lectora en modo teclado: se escucha en toda la pagina (fase de captura) para que la
    // rafaga de teclas no active botones ni cambie los selectores.
    const wedge = new KeyboardWedge();
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      const { consume, scanned } = wedge.handleKey(e.key, e.timeStamp);
      if (consume) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (scanned) void handleWedgeScan(scanned);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!outcome) return;
    if (outcome.kind === "final") {
      setSession((c) => (outcome.response.granted ? { ...c, admitted: c.admitted + 1 } : { ...c, rejected: c.rejected + 1 }));
    } else if (outcome.kind === "unreadable") {
      setSession((c) => ({ ...c, rejected: c.rejected + 1 }));
    }
  }, [outcome]);

  useEffect(() => {
    // Al salir del escaner se libera el puerto serie (si no, queda tomado hasta cerrar la pestana).
    return () => void serialDisconnect?.();
  }, [serialDisconnect]);

  async function toggleSerial() {
    setSerialError(null);
    if (serialDisconnect) {
      await serialDisconnect();
      setSerialDisconnect(null);
      return;
    }
    try {
      // La lectura por puerto serie llega por el mismo camino que la pistola en modo teclado.
      const disconnect = await connectSerialScanner(
        (text) => void handleWedgeScan(text),
        () => {
          setSerialDisconnect(null);
          setSerialError("Se desconectó la pistola lectora.");
        },
      );
      setSerialDisconnect(() => disconnect);
    } catch (err) {
      // Cerrar el selector de puerto sin elegir no es un error.
      if (err instanceof DOMException && err.name === "NotFoundError") return;
      setSerialError(err instanceof Error ? err.message : "No se pudo abrir el puerto de la pistola");
    }
  }

  async function handleWedgeScan(raw: string) {
    const current = outcomeRef.current;
    // Mientras el guardia decide sobre una persona, una nueva lectura espera.
    if (current && (current.kind === "checking" || current.kind === "pending" || current.kind === "deciding")) return;
    let text: string;
    try {
      text = normalizeScannedText(raw);
    } catch (err) {
      busyRef.current = true;
      setOutcome({ kind: "unreadable", message: err instanceof Error ? err.message : "Lectura inválida" });
      return;
    }
    // Una lectura nueva reemplaza el resultado anterior (no hace falta tocar "Siguiente").
    if (current) next();
    lastQrRef.current = null;
    await handleScan(text);
  }

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
      setOutcome({ kind: "unreadable", message: "No se encontró un QR legible en la imagen" });
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
      contents = decodeQr(qrText, verifier.verifierSecret);
      identity = checkQr(contents, verifier.issuerPublic);
    } catch (err) {
      vibrate([90, 60, 90]);
      setOutcome({ kind: "unreadable", message: err instanceof CredentialError ? err.message : "QR inválido" });
      return;
    }
    const gate = gateIdRef.current;
    if (gate === null) {
      setOutcome({ kind: "unreadable", message: "Elige la fila antes de escanear" });
      return;
    }
    const seen: Seen = { identity, photo: contents.photo, payload: validatePayload(contents, gate) };
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
      const localReason = localFreshness(verifier, contents.issuedAt);
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

  // Con la pistola conectada, que no haya camara no es un problema.
  const status =
    keysError ?? serialError ?? (serialDisconnect ? null : cameraError) ?? (keysReady || eventId === null ? null : "Cargando claves del evento…");

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      {/* Barra superior: acciones arriba; evento y fila a lo ancho (en un celular no caben en una fila) */}
      <div className="absolute inset-x-0 top-0 z-20 space-y-2 bg-gradient-to-b from-black/85 via-black/60 to-transparent px-3 pb-8 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/historial")}
            aria-label="Salir del escáner"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15 backdrop-blur"
          >
            <X className="size-5" />
          </button>
          <p className="flex-1 text-[17px] font-extrabold">Escanear cédula</p>
          {isSerialSupported() && (
            <button
              onClick={() => void toggleSerial()}
              aria-label={serialDisconnect ? "Desconectar pistola lectora" : "Conectar pistola lectora por puerto serie"}
              title={serialDisconnect ? "Pistola conectada (tocar para desconectar)" : "Conectar pistola lectora (puerto serie)"}
              className={`grid size-11 shrink-0 place-items-center rounded-full backdrop-blur ${serialDisconnect ? "bg-[#0e806c]" : "bg-white/15"}`}
            >
              <Usb className="size-5" />
            </button>
          )}
          <label
            aria-label="Leer QR desde una imagen"
            title="Leer QR desde una imagen"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-white/15 backdrop-blur"
          >
            <ImageUp className="size-5" />
            <input type="file" accept="image/*" onChange={handleImage} className="hidden" />
          </label>
        </div>
        <div className="grid grid-cols-[3fr_2fr] gap-2">
          <select
            value={eventId ?? ""}
            onChange={(e) => {
              setEventId(Number(e.target.value));
              e.target.blur(); // que la pistola lectora no escriba en el selector
            }}
            aria-label="Evento"
            className="w-full min-w-0 truncate rounded-xl bg-white/15 px-3 py-2.5 text-[14px] font-bold outline-none backdrop-blur [&>option]:text-black"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <select
            value={gateId ?? ""}
            onChange={(e) => {
              setGateId(Number(e.target.value));
              e.target.blur();
            }}
            aria-label="Fila"
            className="w-full min-w-0 truncate rounded-xl bg-white/15 px-3 py-2.5 text-[14px] font-bold outline-none backdrop-blur [&>option]:text-black"
          >
            {gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-black/55 px-3 py-1.5 text-[13px] font-bold backdrop-blur">
            <span className="text-[#6ff0d8]">Ingresos {session.admitted}</span>
            <span className="mx-1.5 text-white/40">·</span>
            <span className="text-[#ff9aa3]">Rechazos {session.rejected}</span>
          </span>
          {serialDisconnect && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#0e806c] px-3 py-1.5 text-[13px] font-bold">
              <Usb className="size-4" /> Pistola conectada
            </span>
          )}
        </div>
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
              <p className="rounded-full bg-white/15 px-4 py-2 text-[13px] font-bold backdrop-blur">
                {serialDisconnect ? "Pistola conectada: dispara al QR de la persona" : "Apunta al QR o escanéalo con la pistola lectora"}
              </p>
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
      <img src={src} alt={`Foto de ${identity.name}`} className="h-[200px] w-[150px] shrink-0 rounded-2xl bg-white object-cover shadow-md ring-4 ring-white" />
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-[.14em] opacity-70">Firmado por el Registro Civil</p>
        <p className="mt-1 text-balance font-display text-[24px] font-extrabold leading-tight tracking-[-.02em]">{identity.name}</p>
        <p className="mt-1.5 font-mono text-[16px] font-medium opacity-80">RUN {formatRut(identity.rut)}</p>
      </div>
    </div>
  );
}

type Tone = "good" | "bad" | "info" | "warn" | "neutral";

// El guardia mira a la persona, no la pantalla: todo el panel toma el color del veredicto para
// leerlo de reojo. Verde = pasa, rojo = no pasa, azul = falta su decision, ambar = sin conexion.
const SHEET_TONE: Record<Tone, string> = {
  good: "bg-[#dff6ee] text-[#0b5e50]",
  bad: "bg-[#fde6e6] text-[#8e2f39]",
  info: "bg-[#e6f1fb] text-[#1f456b]",
  warn: "bg-[#fff1d6] text-[#7a4f0c]",
  neutral: "bg-white text-[#173c47]",
};

function ResultSheet({ outcome, onDecide, onNext }: { outcome: Outcome; onDecide: (seen: Seen, samePerson: boolean) => void; onNext: () => void }) {
  const nextButton = (
    <button onClick={onNext} className="mt-5 w-full rounded-2xl bg-[#123f4a] py-4 text-[17px] font-extrabold text-white">
      Siguiente
    </button>
  );

  let tone: Tone;
  let icon: React.ReactNode;
  let title: string;
  let detail: string | undefined;
  let actions = nextButton;

  if (outcome.kind === "unreadable") {
    tone = "bad";
    icon = <XCircle className="size-9" />;
    title = REASON_LABEL.invalid;
    detail = outcome.message;
  } else if (outcome.kind === "checking" || outcome.kind === "deciding") {
    tone = "neutral";
    icon = <Loader2 className="size-9 animate-spin" />;
    title = outcome.kind === "checking" ? "Verificando entrada…" : "Registrando…";
    actions = <div className="mt-5 h-[60px]" />;
  } else if (outcome.kind === "pending") {
    tone = "info";
    icon = <ShieldAlert className="size-9" />;
    title = "Cédula válida y con entrada";
    detail = "¿Es la persona que tienes al frente?";
    actions = (
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          onClick={() => onDecide(outcome, false)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white py-4 text-[17px] font-extrabold text-[#b23f4a] ring-2 ring-[#f0b9bf]"
        >
          <UserX className="size-6" /> No coincide
        </button>
        <button
          onClick={() => onDecide(outcome, true)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-[#0e806c] py-4 text-[17px] font-extrabold text-white"
        >
          <UserCheck className="size-6" /> Dejar pasar
        </button>
      </div>
    );
  } else if (outcome.kind === "offline") {
    tone = "warn";
    icon = <WifiOff className="size-9" />;
    title = `Sin conexión: ${outcome.localReason === "ok" ? "cédula auténtica y QR vigente" : REASON_LABEL[outcome.localReason]}`;
    detail = "No se pudo revisar la entrada, el uso único ni las prohibiciones, ni registrar el ingreso. Aplica el protocolo sin conexión.";
  } else if (outcome.response.granted) {
    tone = "good";
    icon = <CheckCircle2 className="size-9" />;
    title = "Ingreso registrado";
    actions = <div className="mt-5 h-[60px]" />;
  } else {
    tone = "bad";
    icon = <XCircle className="size-9" />;
    title = REASON_LABEL[outcome.response.reason] ?? outcome.response.reason;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`absolute inset-x-0 bottom-0 z-30 mx-auto max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-t-[28px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 shadow-[0_-12px_40px_rgba(0,0,0,.35)] ${SHEET_TONE[tone]}`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="text-[22px] font-extrabold leading-tight">{title}</p>
          {detail && <p className="mt-0.5 text-[15px] font-semibold opacity-85">{detail}</p>}
        </div>
      </div>
      {outcome.kind !== "unreadable" && (
        <div className="mt-4">
          <BigIdentity identity={outcome.identity} photo={outcome.photo} />
        </div>
      )}
      {actions}
    </div>
  );
}
