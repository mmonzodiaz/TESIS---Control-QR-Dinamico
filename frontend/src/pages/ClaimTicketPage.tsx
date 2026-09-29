import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IdCard, KeyRound, Loader2, Lock, LockKeyhole, Ticket as TicketIcon } from "lucide-react";
import { api, ApiError } from "../api";
import { BrandMark } from "../components/BrandMark";
import { IdentityCard } from "../components/IdentityCard";
import { b64encode, devicePublicKey } from "../credential";
import { formatRut, isValidRut } from "../rut";
import {
  clearPinAttempts,
  clearSession,
  deleteWallet,
  isValidPin,
  loadPinAttempts,
  loadSealedWallet,
  loadSession,
  newWallet,
  openWallet,
  PIN_LENGTH,
  registerPinFailure,
  saveSession,
  sealWallet,
  storeSealedWallet,
  WrongPinError,
  type SealedWallet,
  type StoredSession,
  type UnlockedWallet,
} from "../wallet";
import { MyAccessPage } from "./MyAccessPage";

// Como la app real: si pasa un rato en segundo plano, vuelve a pedir el PIN.
const AUTO_LOCK_MS = 60_000;

const card = "rounded-[24px] border border-[#e3ebea] bg-white p-8 shadow-[0_16px_40px_rgba(37,73,79,.08)]";
const input =
  "w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] py-2.5 pl-10 pr-3 text-[13px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]";
const primaryButton =
  "mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-3 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(18,63,74,.18)] transition hover:-translate-y-0.5 hover:bg-[#0c5360] disabled:cursor-not-allowed disabled:opacity-60";

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="mt-4 rounded-xl bg-[#fdeceb] px-3 py-2 text-[11px] font-semibold text-[#c6505b]">{error}</p> : null;
}

function PinField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="mt-4 block text-[11px] font-bold text-[#557276]">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={"•".repeat(PIN_LENGTH)}
        className="mt-1.5 w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3 py-3 text-center font-mono text-[22px] tracking-[.5em] text-[#274b53] outline-none placeholder:text-[#c5d1d1] focus:border-[#8dcfc3]"
      />
    </label>
  );
}

/** Paso 1: obtener la cedula digital del Registro Civil (simulado). */
function EnrollScreen({ onEnrolled }: { onEnrolled: (wallet: UnlockedWallet) => void }) {
  const [rut, setRut] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidRut(rut)) {
      setError("El RUT no es valido. Revisa el digito verificador.");
      return;
    }
    setBusy(true);
    try {
      onEnrolled(newWallet(await api.enroll(rut, clave)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo contactar al Registro Civil");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={card}>
      <h1 className="font-display text-[22px] font-extrabold tracking-[-.03em] text-[#173c47]">Activa tu cedula digital</h1>
      <p className="mt-1.5 text-[12px] leading-5 text-[#82989a]">
        Se hace una sola vez en este telefono. El Registro Civil te entrega tu cedula firmada (nombre, RUT y foto) y
        queda guardada aqui, protegida con un PIN.
      </p>
      <label className="mt-6 block text-[11px] font-bold text-[#557276]">
        RUT
        <div className="relative mt-1.5">
          <IdCard className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9eb0b1]" />
          <input value={rut} onChange={(e) => setRut(formatRut(e.target.value))} required autoFocus placeholder="12.345.678-5" className={input} />
        </div>
      </label>
      <label className="mt-4 block text-[11px] font-bold text-[#557276]">
        Clave de activacion
        <div className="relative mt-1.5">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9eb0b1]" />
          <input
            value={clave}
            onChange={(e) => setClave(e.target.value.toUpperCase())}
            required
            autoComplete="off"
            placeholder="Simula tu ClaveUnica"
            className={`${input} font-mono tracking-[.1em]`}
          />
        </div>
      </label>
      <p className="mt-2 text-[10px] leading-4 text-[#91a4a5]">
        Prototipo: el Registro Civil es simulado y la clave de activacion reemplaza a la ClaveUnica.
      </p>
      <ErrorText error={error} />
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? "Consultando al Registro Civil..." : "Obtener mi cedula digital"}
      </button>
    </form>
  );
}

/** Paso 2: crear el PIN que protege la cedula en este telefono. */
function CreatePinScreen({ wallet, onDone, onCancel }: { wallet: UnlockedWallet; onDone: (sealed: SealedWallet) => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) return setError(`El PIN debe tener ${PIN_LENGTH} digitos.`);
    if (pin !== confirm) return setError("Los PIN no coinciden.");
    setBusy(true);
    const sealed = await sealWallet(pin, wallet);
    storeSealedWallet(sealed);
    onDone(sealed);
  }

  return (
    <form onSubmit={submit} className={card}>
      <h1 className="font-display text-[22px] font-extrabold tracking-[-.03em] text-[#173c47]">Crea tu PIN</h1>
      <p className="mt-1.5 text-[12px] leading-5 text-[#82989a]">
        Lo pediremos cada vez que abras tu cedula. Tu cedula y la clave de este telefono quedan cifradas con el.
      </p>
      <div className="mt-5">
        <IdentityCard identity={wallet.identity} photo={wallet.credential.photo} caption="Cedula entregada por el Registro Civil" />
      </div>
      <PinField label={`PIN (${PIN_LENGTH} digitos)`} value={pin} onChange={setPin} autoFocus />
      <PinField label="Repite el PIN" value={confirm} onChange={setConfirm} />
      <ErrorText error={error} />
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? "Protegiendo tu cedula..." : "Guardar PIN"}
      </button>
      <button type="button" onClick={onCancel} className="mt-3 w-full text-[11px] font-bold text-[#82989a] hover:underline">
        Cancelar
      </button>
    </form>
  );
}

/** Uso diario: desbloquear la cedula con el PIN. */
function UnlockScreen({ sealed, onUnlocked, onForgot }: { sealed: SealedWallet; onUnlocked: (w: UnlockedWallet) => void; onForgot: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(loadPinAttempts);
  const [now, setNow] = useState(() => Date.now());
  const [confirmForgot, setConfirmForgot] = useState(false);
  const lockedFor = Math.max(0, Math.ceil((attempts.lockedUntil - now) / 1000));

  useEffect(() => {
    if (!attempts.lockedUntil) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [attempts.lockedUntil]);

  async function tryPin(value: string) {
    if (busy || lockedFor > 0 || !isValidPin(value)) return;
    setBusy(true);
    setError(null);
    try {
      const wallet = await openWallet(value, sealed);
      clearPinAttempts();
      onUnlocked(wallet);
    } catch (err) {
      if (!(err instanceof WrongPinError)) throw err;
      const next = registerPinFailure(attempts);
      setAttempts(next);
      setNow(Date.now());
      setPin("");
      setError(next.lockedUntil ? "Demasiados intentos. Espera un minuto." : "PIN incorrecto.");
    } finally {
      setBusy(false);
    }
  }

  function change(value: string) {
    setPin(value);
    if (value.length === PIN_LENGTH) void tryPin(value);
  }

  return (
    <div className={card}>
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e5f7f1]">
        <LockKeyhole className="size-6 text-[#0e806c]" />
      </div>
      <h1 className="mt-4 text-center font-display text-[22px] font-extrabold tracking-[-.03em] text-[#173c47]">Ingresa tu PIN</h1>
      <p className="mt-1.5 text-center text-[12px] leading-5 text-[#82989a]">Para abrir tu cedula digital.</p>
      {lockedFor > 0 ? (
        <p className="mt-6 rounded-xl bg-[#fff3d9] px-3 py-3 text-center text-[12px] font-bold text-[#a26a11]">
          Bloqueado por seguridad. Intenta de nuevo en {lockedFor} s.
        </p>
      ) : (
        <PinField label="PIN" value={pin} onChange={change} autoFocus />
      )}
      {busy && (
        <p className="mt-3 flex items-center justify-center gap-2 text-[11px] font-semibold text-[#82989a]">
          <Loader2 className="size-3.5 animate-spin" /> Verificando...
        </p>
      )}
      <ErrorText error={error} />

      {confirmForgot ? (
        <div className="mt-6 rounded-xl bg-[#fdf2e6] p-3 text-[11px] leading-5 text-[#8a5a1c]">
          <p>
            Se borrara tu cedula de este telefono y tendras que activarla de nuevo. Si ya activaste una entrada, quedo
            ligada a este telefono y soporte del evento tendra que liberarla.
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={onForgot} className="rounded-lg bg-[#c6505b] px-3 py-1.5 font-bold text-white">
              Borrar y activar de nuevo
            </button>
            <button onClick={() => setConfirmForgot(false)} className="rounded-lg px-3 py-1.5 font-bold">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmForgot(true)} className="mt-6 w-full text-[11px] font-bold text-[#0e806c] hover:underline">
          ¿Olvidaste tu PIN?
        </button>
      )}
    </div>
  );
}

/** Con la cedula abierta y sin entrada activada: pide el codigo de la entrada. */
function TicketActivation({ wallet, onActivated }: { wallet: UnlockedWallet; onActivated: (s: StoredSession) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Solo viajan el core (con el hash de la foto) y la firma del emisor: la foto se queda aqui.
      const res = await api.claimTicket({
        rut: wallet.identity.rut,
        code,
        device_public_key: b64encode(devicePublicKey(wallet.deviceSecret)),
        credential_core: b64encode(wallet.credential.core),
        issuer_sig: b64encode(wallet.credential.issuerSig),
      });
      onActivated(saveSession(res.access_token, res.attendee, res.qr));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo validar la entrada");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={card}>
      <IdentityCard identity={wallet.identity} photo={wallet.credential.photo} caption="Tu cedula digital" />
      <h2 className="mt-6 font-display text-[18px] font-extrabold tracking-[-.03em] text-[#173c47]">Agrega tu entrada</h2>
      <p className="mt-1 text-[12px] leading-5 text-[#82989a]">
        Ingresa el codigo de tu entrada. Pedimos tu cedula y el codigo para que nadie que solo conozca tu RUT pueda sacar
        un QR a tu nombre.
      </p>
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
            className={`${input} font-mono tracking-[.15em] placeholder:font-sans placeholder:tracking-normal`}
          />
        </div>
      </label>
      <ErrorText error={error} />
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? "Validando..." : "Activar mi entrada"}
      </button>
    </form>
  );
}

export function ClaimTicketPage() {
  const [sealed, setSealed] = useState<SealedWallet | null>(loadSealedWallet);
  const [wallet, setWallet] = useState<UnlockedWallet | null>(null);
  const [enrolled, setEnrolled] = useState<UnlockedWallet | null>(null); // falta crear el PIN
  const [session, setSession] = useState<StoredSession | null>(loadSession);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Refresca la sesion de la entrada (hora del servidor, si ya ingreso). Sin red se usa la guardada.
    if (!session) return;
    api
      .myTicket(session.token)
      .then((res) => setSession(saveSession(session.token, res.attendee, res.qr)))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) sessionLost();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Bloqueo automatico al volver despues de un rato en segundo plano.
    if (!wallet) return;
    let hiddenAt = 0;
    function onVisibility() {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) setWallet(null);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [wallet]);

  function sessionLost() {
    clearSession();
    setSession(null);
    setNotice("Tu entrada se abrio en otro dispositivo o fue liberada por soporte. Activala de nuevo.");
  }

  function forgotPin() {
    deleteWallet();
    setSealed(null);
    setSession(null);
    setNotice("Se borro la cedula de este telefono. Activala de nuevo.");
  }

  let content;
  if (wallet) {
    content = session ? (
      <MyAccessPage session={session} wallet={wallet} onSessionLost={sessionLost} onSessionRefresh={setSession} />
    ) : (
      <div className="mx-auto w-full max-w-[400px]">
        <TicketActivation wallet={wallet} onActivated={setSession} />
      </div>
    );
  } else if (enrolled) {
    content = (
      <div className="mx-auto w-full max-w-[400px]">
        <CreatePinScreen
          wallet={enrolled}
          onDone={(s) => {
            setSealed(s);
            setWallet(enrolled);
            setEnrolled(null);
          }}
          onCancel={() => setEnrolled(null)}
        />
      </div>
    );
  } else {
    content = (
      <div className="mx-auto w-full max-w-[400px]">
        {sealed ? (
          <UnlockScreen sealed={sealed} onUnlocked={setWallet} onForgot={forgotPin} />
        ) : (
          <EnrollScreen onEnrolled={setEnrolled} />
        )}
        <p className="mt-6 text-center text-[11px] text-[#91a4a5]">
          ¿Eres parte del personal?{" "}
          <Link to="/login" className="font-bold text-[#0e806c] hover:underline">
            Ingresa aqui
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f9f8] px-4 py-8">
      <div className="mx-auto mb-8 flex max-w-[420px] items-center justify-between">
        <BrandMark />
        {wallet && (
          <button
            onClick={() => setWallet(null)}
            className="flex items-center gap-1.5 rounded-full border border-[#e3ebea] bg-white px-3 py-1.5 text-[11px] font-bold text-[#557276]"
          >
            <Lock className="size-3.5" /> Bloquear
          </button>
        )}
      </div>
      {notice && !wallet && (
        <p className="mx-auto mb-4 max-w-[400px] rounded-xl bg-[#fff3d9] px-3 py-2 text-[11px] font-semibold text-[#a26a11]">{notice}</p>
      )}
      {content}
    </div>
  );
}
