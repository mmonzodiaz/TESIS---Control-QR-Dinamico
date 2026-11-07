import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type Role, type User } from "../api";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  guard: "Guardia",
};

const emptyForm = { email: "", full_name: "", password: "", role: "guard" as Role, document_id: "" };

export function UsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!token) return;
    setUsers(await api.listUsers(token));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      await api.createUser(token, form);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la cuenta");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(user: User) {
    if (!token) return;
    await api.updateUser(token, user.id, { is_active: !user.is_active });
    await load();
  }

  async function handleDelete(user: User) {
    if (!token) return;
    if (!confirm(`¿Eliminar la cuenta de ${user.full_name}?`)) return;
    await api.deleteUser(token, user.id);
    await load();
  }

  return (
    <div>
      <h1 className="page-title">Personal</h1>
      <p className="page-lead">
        Cuentas de quienes trabajan en el recinto: guardias, que escanean en las filas, y administración. Las personas que
        asisten no tienen cuenta: muestran su cédula digital.
      </p>

      <form onSubmit={handleCreate} className="section mt-6">
        <div className="section-head">
          <h2 className="section-title">Nueva cuenta</h2>
        </div>
        <div className="section-body grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="user-name" className="field-label">
              Nombre completo
            </label>
            <input id="user-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required className="field mt-1.5" />
          </div>
          <div>
            <label htmlFor="user-email" className="field-label">
              Correo
            </label>
            <input id="user-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="field mt-1.5" />
          </div>
          <div>
            <label htmlFor="user-password" className="field-label">
              Contraseña
            </label>
            <input
              id="user-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              aria-describedby="user-password-help"
              className="field mt-1.5"
            />
            <p id="user-password-help" className="mt-1 text-[13px] text-ink-2">
              Al menos 12 caracteres.
            </p>
          </div>
          <div>
            <label htmlFor="user-role" className="field-label">
              Rol
            </label>
            <select id="user-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="field mt-1.5">
              <option value="guard">Guardia</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line-soft px-5 py-4">
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading && <Loader2 className="size-4 animate-spin" />}
            Crear cuenta
          </button>
          {error && (
            <p role="alert" className="text-[14px] text-bad">
              {error}
            </p>
          )}
        </div>
      </form>

      <section className="section mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Rol</th>
                <th>Estado</th>
                <th className="w-[1%]">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="font-semibold">{u.full_name}</p>
                    <p className="text-[13px] text-ink-2">{u.email}</p>
                  </td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.is_active ? <span className="tag tag-ok">Activa</span> : <span className="tag tag-neutral">Desactivada</span>}</td>
                  <td>
                    <div className="flex justify-end gap-4 whitespace-nowrap">
                      <button onClick={() => toggleActive(u)} className="btn-link">
                        {u.is_active ? "Desactivar" : "Activar"}
                      </button>
                      <button onClick={() => handleDelete(u)} className="btn-link text-bad">
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-ink-2">
                    Todavía no hay cuentas. Crea la primera con el formulario de arriba.
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
