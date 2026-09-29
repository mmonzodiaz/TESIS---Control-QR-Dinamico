import { useCallback, useEffect, useState } from "react";
import { Ban as BanIcon, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type Ban } from "../api";
import { formatRut, isValidRut } from "../rut";

const inputClass =
  "rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3.5 py-2.5 text-[12px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]";

export function BansPage() {
  const { token } = useAuth();
  const [bans, setBans] = useState<Ban[]>([]);
  const [form, setForm] = useState({ rut: "", reason: "" });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (token) setBans(await api.listBans(token));
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ocurrió un error");
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidRut(form.rut)) return setError("RUT inválido");
    return run(async () => {
      await api.addBan(token!, form);
      setForm({ rut: "", reason: "" });
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
        <span className="size-1.5 rounded-full bg-[#1ba792]" /> Administración
      </div>
      <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Prohibiciones de ingreso</h1>
      <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-[#82989a]">
        Personas que no pueden ingresar (p. ej. hinchas sancionados o derecho de admision). Se revisa en la puerta, al
        escanear. El filtro es por RUT: solo funciona si la credencial presentada no se puede copiar ni prestar
        facilmente.
      </p>

      {error && <p className="mt-4 rounded-xl bg-[#fdeceb] px-3 py-2 text-[11px] font-semibold text-[#c6505b]">{error}</p>}

      <div className="mt-6 rounded-[24px] border border-[#e3ebea] bg-white px-5 py-5 shadow-[0_12px_32px_rgba(37,73,79,.05)] sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-[#fdeceb]">
            <BanIcon className="size-[19px] text-[#c6505b]" />
          </div>
          <div>
            <p className="font-display text-[14px] font-extrabold text-[#234953]">Lista vigente</p>
            <p className="text-[11px] text-[#96a8a9]">{bans.length} persona(s)</p>
          </div>
        </div>

        <form onSubmit={handleAdd} className="mt-4 flex flex-wrap gap-2">
          <input value={form.rut} onChange={(e) => setForm({ ...form, rut: formatRut(e.target.value) })} required placeholder="RUT" className={`${inputClass} w-[150px]`} />
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required placeholder="Motivo" className={`${inputClass} min-w-0 flex-1`} />
          <button className="flex items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#0c5360]">
            <Plus className="size-4" /> Agregar
          </button>
        </form>

        <ul className="mt-4 space-y-1.5">
          {bans.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f7fbfa] px-3 py-2 text-[12px] text-[#34565c]">
              <span>
                <span className="font-mono font-bold">{formatRut(b.document_id)}</span> · {b.reason}
              </span>
              <button
                onClick={() => run(() => api.removeBan(token!, b.id))}
                aria-label="Levantar prohibición"
                className="rounded-lg p-1.5 text-[#809598] hover:bg-[#fff5f2] hover:text-[#bb684b]"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
