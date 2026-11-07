import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type Ban } from "../api";
import { formatRut, isValidRut } from "../rut";

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
      <h1 className="page-title">Prohibiciones de ingreso</h1>
      <p className="page-lead">
        Personas que no pueden ingresar, por ejemplo hinchas sancionados o por derecho de admisión. Se revisa en la puerta, en
        cada lectura. El filtro es por RUT: solo sirve si la credencial presentada no se puede copiar ni prestar con facilidad.
      </p>

      {error && (
        <p role="alert" className="notice notice-error mt-5">
          {error}
        </p>
      )}

      <section className="section mt-6">
        <div className="section-head">
          <h2 className="section-title">Lista vigente</h2>
          <p className="section-meta">{bans.length === 1 ? "1 persona" : `${bans.length} personas`}</p>
        </div>

        <form onSubmit={handleAdd} className="section-body flex flex-wrap items-end gap-3 border-b border-line-soft">
          <div className="w-[170px]">
            <label htmlFor="ban-rut" className="field-label">
              RUT
            </label>
            <input
              id="ban-rut"
              value={form.rut}
              onChange={(e) => setForm({ ...form, rut: formatRut(e.target.value) })}
              required
              placeholder="12.345.678-5"
              className="field tnum mt-1.5"
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label htmlFor="ban-reason" className="field-label">
              Motivo
            </label>
            <input
              id="ban-reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required
              className="field mt-1.5"
            />
          </div>
          <button className="btn btn-primary">Agregar a la lista</button>
        </form>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[520px]">
            <thead>
              <tr>
                <th className="w-[170px]">RUT</th>
                <th>Motivo</th>
                <th className="w-[1%]">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bans.map((b) => (
                <tr key={b.id}>
                  <td className="tnum">{formatRut(b.document_id)}</td>
                  <td>{b.reason}</td>
                  <td className="text-right">
                    <button onClick={() => run(() => api.removeBan(token!, b.id))} aria-label="Levantar prohibición" className="btn-link whitespace-nowrap text-bad">
                      Levantar
                    </button>
                  </td>
                </tr>
              ))}
              {bans.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-ink-2">
                    No hay prohibiciones vigentes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
