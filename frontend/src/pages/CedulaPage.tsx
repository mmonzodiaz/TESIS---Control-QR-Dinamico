import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, IdCard, KeyRound, Loader2, Lock, LockKeyhole, ShieldX, Smartphone } from "lucide-react";
import { api, ApiError } from "../api";
import { CedulaBrand, CedulaCard } from "../components/CedulaCard";
import { PinPad } from "../components/PinPad";
import { b64encode, credentialId, devicePublicKey, newSecretKey } from "../credential";
import { formatRut, isValidRut } from "../rut";
import {
  clearPinAttempts,
  deleteWallet,
  loadPinAttempts,
  loadSealedWallet,
  newWallet,
  openWallet,
  PIN_LENGTH,
  registerPinFailure,
  saveClockOffset,
  sealWallet,
  storeSealedWallet,
  WrongPinError,
  type SealedWallet,
  type UnlockedWallet,
} from "../wallet";
import { CedulaView } from "./CedulaView";

// La app de cédula digital (como Identificación Digital): es de la persona, no de un evento. Se
// activa una vez con el Registro Civil, queda protegida con un PIN y muestra el QR dinámico que
// cualquier lector autorizado puede verificar.

// Como la app real: si pasa un rato en segundo plano, vuelve a pedir el PIN.
const AUTO_LOCK_MS = 60_000;

const input =
  "w-full rounded-xl border border-[#d6e3e0] bg-[#fbfdfc] py-3 pl-11 pr-3 text-[16px] font-medium text-[#173c47] outline-none placeholder:text-[#8aa0a2] focus:border-[#5fbfae]";
const primaryButton =
  "mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#123f4a] px-4 py-4 text-[16px] font-extrabold text-white shadow-[0_10px_22px_rgba(18,63,74,.2)] transition active:scale-[.99] disabled:opacity-60";

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-4 rounded-xl bg-[#fdeceb] px-3.5 py-2.5 text-[14px] font-semibold text-[#a8404b]">
      {error}
    </p>
  ) : null;
}

/** El enrolamiento es una secuencia real de dos pasos: activar la cédula y crear el PIN. */
function Steps({ current }: { current: 1 | 2 }) {
  const labels = ["Activar cédula", "Crear PIN"];
  return (
    <div className="mb-5">
      <p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#0e806c]">
        Paso {current} de 2 · {labels[current - 1]}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {labels.map((label, i) => (
          <span key={label} className={`h-1.5 rounded-full ${i < current ? "bg-[#18ac98]" : "bg-[#dce8e5]"}`} />
        ))}
      </div>
    </div>
  );
}

/** Paso 1: obtener la cédula digital del Registro Civil (simulado). */
function EnrollScreen({ onEnrolled, onReportLoss }: { onEnrolled: (wallet: UnlockedWallet) => void; onReportLoss: () => void }) {
  const [rut, setRut] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidRut(rut)) {
      setError("El RUN no es válido. Revisa el dígito verificador.");
      return;
    }
    setBusy(true);
    try {
      // La clave del teléfono se crea aquí y el Registro Civil la firma dentro de la cédula: solo este
      // teléfono podrá generar QR válidos con ella.
      const deviceSecret = newSecretKey();
      const res = await api.enroll(rut, clave, b64encode(devicePublicKey(deviceSecret)));
      saveClockOffset(res.server_time);
      onEnrolled(newWallet(res, deviceSecret));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "No se pudo contactar al Registro Civil.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Steps current={1} />
      <h1 className="text-balance font-display text-[26px] font-extrabold leading-tight tracking-[-.03em] text-[#123f4a]">
        Activa tu cédula digital
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-[#3d5a5e]">
        Se hace una sola vez en este teléfono. El Registro Civil te entrega tu cédula firmada, con tu nombre, RUN y foto, ligada
        a este teléfono. Si la tenías en otro teléfono, allá quedará desactivada.
      </p>
      <label htmlFor="enroll-rut" className="mt-6 block text-[14px] font-bold text-[#34565c]">
        RUN
      </label>
      <div className="relative mt-1.5">
        <IdCard className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[#7c9496]" />
        <input
          id="enroll-rut"
          value={rut}
          onChange={(e) => setRut(formatRut(e.target.value))}
          required
          autoFocus
          autoComplete="off"
          placeholder="12.345.678-5"
          className={input}
        />
      </div>
      <label htmlFor="enroll-clave" className="mt-4 block text-[14px] font-bold text-[#34565c]">
        Clave de activación
      </label>
      <div className="relative mt-1.5">
        <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[#7c9496]" />
        <input
          id="enroll-clave"
          value={clave}
          onChange={(e) => setClave(e.target.value.toUpperCase())}
          required
          autoComplete="off"
          placeholder="Ej. RCUNO234"
          className={`${input} font-mono tracking-[.12em]`}
        />
      </div>
      <p className="mt-2.5 text-[13px] leading-5 text-[#4f6a6d]">
        En la app real esto se hace con tu ClaveÚnica y una prueba facial. En este prototipo, la clave de activación reemplaza
        ese paso.
      </p>
      <ErrorText error={error} />
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy && <Loader2 className="size-5 animate-spin" />}
        {busy ? "Consultando al Registro Civil…" : "Obtener mi cédula digital"}
      </button>
      <button type="button" onClick={onReportLoss} className="mt-4 flex w-full items-center justify-center gap-2 py-2 text-[14px] font-bold text-[#b23f4a]">
        <Smartphone className="size-4" /> ¿Perdiste tu teléfono? Desactiva tu cédula
      </button>
    </form>
  );
}

/** "Perdí mi teléfono": desde otro dispositivo, desactiva la cédula del teléfono perdido (ADR-14). */
function ReportLossScreen({ onBack }: { onBack: () => void }) {
  const [rut, setRut] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidRut(rut)) {
      setError("El RUN no es válido. Revisa el dígito verificador.");
      return;
    }
    setBusy(true);
    try {
      await api.reportLoss(rut, clave);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo contactar al Registro Civil.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#e3f4ef]">
          <CheckCircle2 className="size-7 text-[#0e806c]" />
        </div>
        <h1 className="mt-4 font-display text-[24px] font-extrabold tracking-[-.02em] text-[#123f4a]">Cédula desactivada</h1>
        <p className="mt-2 text-[15px] leading-6 text-[#3d5a5e]">
          Los QR del teléfono perdido serán rechazados por los lectores en alrededor de un minuto, aunque alguien conozca tu PIN.
          Puedes activar tu cédula en este teléfono cuando quieras.
        </p>
        <button type="button" onClick={onBack} className={primaryButton}>
          Activar mi cédula aquí
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-balance font-display text-[26px] font-extrabold leading-tight tracking-[-.03em] text-[#123f4a]">
        Desactiva tu cédula perdida
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-[#3d5a5e]">
        El Registro Civil revoca la cédula que quedó en el teléfono perdido o robado. Se identifica con los mismos datos que al
        activarla.
      </p>
      <label htmlFor="loss-rut" className="mt-6 block text-[14px] font-bold text-[#34565c]">
        RUN
      </label>
      <div className="relative mt-1.5">
        <IdCard className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[#7c9496]" />
        <input
          id="loss-rut"
          value={rut}
          onChange={(e) => setRut(formatRut(e.target.value))}
          required
          autoFocus
          autoComplete="off"
          placeholder="12.345.678-5"
          className={input}
        />
      </div>
      <label htmlFor="loss-clave" className="mt-4 block text-[14px] font-bold text-[#34565c]">
        Clave de activación
      </label>
      <div className="relative mt-1.5">
        <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[#7c9496]" />
        <input
          id="loss-clave"
          value={clave}
          onChange={(e) => setClave(e.target.value.toUpperCase())}
          required
          autoComplete="off"
          placeholder="Ej. RCUNO234"
          className={`${input} font-mono tracking-[.12em]`}
        />
      </div>
      <ErrorText error={error} />
      <button type="submit" disabled={busy} className={`${primaryButton} bg-[#b23f4a] shadow-[0_10px_22px_rgba(178,63,74,.2)]`}>
        {busy && <Loader2 className="size-5 animate-spin" />}
        {busy ? "Consultando al Registro Civil…" : "Desactivar mi cédula"}
      </button>
      <button type="button" onClick={onBack} className="mt-4 w-full py-2 text-[14px] font-bold text-[#4f6a6d]">
        Volver
      </button>
    </form>
  );
}

/** La cédula de este teléfono fue revocada: se activó en otro teléfono o se reportó la pérdida. */
function RevokedScreen({ onReset }: { onReset: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#fdeceb]">
        <ShieldX className="size-7 text-[#b23f4a]" />
      </div>
      <h1 className="mt-4 text-balance font-display text-[24px] font-extrabold tracking-[-.02em] text-[#123f4a]">
        Tu cédula ya no es válida en este teléfono
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-[#3d5a5e]">
        Se activó en otro teléfono o se reportó la pérdida de este. Los lectores rechazarán sus QR. Si fuiste tú, puedes
        activarla de nuevo aquí.
      </p>
      <button type="button" onClick={onReset} className={primaryButton}>
        Borrar de este teléfono y activar de nuevo
      </button>
    </div>
  );
}

/** Paso 2: crear el PIN (dos veces) que protege la cédula en este teléfono. */
function CreatePinScreen({ wallet, onDone, onCancel }: { wallet: UnlockedWallet; onDone: (sealed: SealedWallet) => void; onCancel: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function complete(pin: string) {
    if (first === null) {
      setFirst(pin);
      setError(null);
      return true;
    }
    if (pin !== first) {
      setFirst(null);
      setError("Los PIN no coinciden. Créalo de nuevo.");
      return false;
    }
    setSaving(true);
    const sealed = await sealWallet(pin, wallet);
    storeSealedWallet(sealed);
    onDone(sealed);
    return true;
  }

  return (
    <div>
      <Steps current={2} />
      <CedulaCard identity={wallet.identity} photo={wallet.credential.photo} />
      <h1 className="mt-6 text-center font-display text-[22px] font-extrabold tracking-[-.02em] text-[#123f4a]">
        {first === null ? "Crea tu PIN de 6 dígitos" : "Repite tu PIN"}
      </h1>
      <p className="mx-auto mt-1.5 max-w-[320px] text-center text-[14px] leading-5 text-[#3d5a5e]">
        Lo pediremos cada vez que abras tu cédula. Tu cédula queda cifrada con él.
      </p>
      <div className="mt-6">
        {saving ? (
          <p className="flex items-center justify-center gap-2 py-16 text-[15px] font-semibold text-[#3d5a5e]">
            <Loader2 className="size-5 animate-spin" /> Protegiendo tu cédula…
          </p>
        ) : (
          <PinPad key={first === null ? "primero" : "repetir"} length={PIN_LENGTH} onComplete={complete} />
        )}
      </div>
      <ErrorText error={error} />
      <button type="button" onClick={onCancel} className="mt-5 w-full py-2 text-[14px] font-bold text-[#4f6a6d]">
        Cancelar
      </button>
    </div>
  );
}

/** Uso diario: desbloquear la cédula con el PIN. */
function UnlockScreen({ sealed, onUnlocked, onForgot }: { sealed: SealedWallet; onUnlocked: (w: UnlockedWallet) => void; onForgot: () => void }) {
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

  async function tryPin(pin: string) {
    setBusy(true);
    setError(null);
    try {
      const wallet = await openWallet(pin, sealed);
      clearPinAttempts();
      onUnlocked(wallet);
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
    <div className="flex flex-col items-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-[#e3f4ef]">
        <LockKeyhole className="size-7 text-[#0e806c]" />
      </div>
      <h1 className="mt-4 font-display text-[24px] font-extrabold tracking-[-.02em] text-[#123f4a]">Ingresa tu PIN</h1>
      <p className="mt-1 text-[15px] text-[#3d5a5e]">Para abrir tu cédula digital.</p>
      <div className="mt-7 w-full">
        {lockedFor > 0 ? (
          <p role="status" className="rounded-2xl bg-[#fff3d9] px-4 py-4 text-center text-[15px] font-bold text-[#8a5a10]">
            Bloqueado por seguridad. Intenta de nuevo en {lockedFor} s.
          </p>
        ) : (
          <PinPad length={PIN_LENGTH} onComplete={tryPin} disabled={busy} />
        )}
      </div>
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-[14px] font-semibold text-[#3d5a5e]">
          <Loader2 className="size-4 animate-spin" /> Verificando…
        </p>
      )}
      <div className="w-full">
        <ErrorText error={error} />
      </div>

      {confirmForgot ? (
        <div className="mt-6 w-full rounded-2xl bg-[#fdf2e6] p-4 text-[14px] leading-5 text-[#7a4f18]">
          <p>Se borrará tu cédula de este teléfono y tendrás que activarla de nuevo con el Registro Civil.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={onForgot} className="rounded-xl bg-[#b23f4a] px-4 py-2.5 font-bold text-white">
              Borrar y activar de nuevo
            </button>
            <button onClick={() => setConfirmForgot(false)} className="rounded-xl px-4 py-2.5 font-bold">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmForgot(true)} className="mt-6 py-2 text-[14px] font-bold text-[#0e806c]">
          ¿Olvidaste tu PIN?
        </button>
      )}
    </div>
  );
}

export function CedulaPage() {
  const [sealed, setSealed] = useState<SealedWallet | null>(loadSealedWallet);
  const [wallet, setWallet] = useState<UnlockedWallet | null>(null);
  const [enrolled, setEnrolled] = useState<UnlockedWallet | null>(null); // falta crear el PIN
  const [notice, setNotice] = useState<string | null>(null);
  const [reportingLoss, setReportingLoss] = useState(false);
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    // Al abrir la cédula, corrige el reloj con la hora oficial (el QR lleva la hora) y revisa si esta
    // cédula fue revocada (ADR-14). Sin red, sigue igual: los lectores igual la rechazarían.
    if (!wallet) return;
    api
      .officialTime()
      .then((res) => saveClockOffset(res.server_time))
      .catch(() => {});
    const id = credentialId(wallet.credential.core);
    api
      .revocations()
      .then((list) => setRevoked(list.revoked.includes(id)))
      .catch(() => {});
  }, [wallet]);

  useEffect(() => {
    // Bloqueo automático al volver después de un rato en segundo plano.
    if (!wallet) return;
    let hiddenAt = 0;
    function onVisibility() {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) setWallet(null);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [wallet]);

  function forgotPin() {
    deleteWallet();
    setSealed(null);
    setNotice("Se borró la cédula de este teléfono. Actívala de nuevo.");
  }

  function resetRevoked() {
    deleteWallet();
    setSealed(null);
    setWallet(null);
    setRevoked(false);
    setNotice(null);
  }

  let content;
  if (wallet && revoked) {
    content = <RevokedScreen onReset={resetRevoked} />;
  } else if (wallet) {
    content = <CedulaView wallet={wallet} />;
  } else if (enrolled) {
    content = (
      <CreatePinScreen
        wallet={enrolled}
        onDone={(s) => {
          setSealed(s);
          setWallet(enrolled);
          setEnrolled(null);
        }}
        onCancel={() => setEnrolled(null)}
      />
    );
  } else {
    content = (
      <>
        {sealed ? (
          <UnlockScreen sealed={sealed} onUnlocked={setWallet} onForgot={forgotPin} />
        ) : reportingLoss ? (
          <ReportLossScreen onBack={() => setReportingLoss(false)} />
        ) : (
          <EnrollScreen onEnrolled={setEnrolled} onReportLoss={() => setReportingLoss(true)} />
        )}
        <p className="mt-8 text-center text-[13px] text-[#4f6a6d]">
          ¿Verificas identidades en un recinto?{" "}
          <Link to="/login" className="font-bold text-[#0e806c] underline-offset-2 hover:underline">
            Ingresa como personal
          </Link>
        </p>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f9f8] px-4 pb-10 pt-[max(20px,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-[420px]">
        <header className="mb-7 flex items-center justify-between">
          <CedulaBrand />
          {wallet && (
            <button
              onClick={() => setWallet(null)}
              className="flex items-center gap-1.5 rounded-full border border-[#d6e3e0] bg-white px-3.5 py-2 text-[13px] font-bold text-[#34565c]"
            >
              <Lock className="size-4" /> Bloquear
            </button>
          )}
        </header>
        {notice && !wallet && (
          <p role="status" className="mb-5 rounded-xl bg-[#fff3d9] px-3.5 py-2.5 text-[14px] font-semibold text-[#8a5a10]">
            {notice}
          </p>
        )}
        {content}
      </div>
    </div>
  );
}
