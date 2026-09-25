import { useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2, UserRoundCheck, UserRoundX, UsersRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type Role, type User } from "../api";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  guard: "Guardia",
};

const ROLE_TONE: Record<Role, string> = {
  admin: "bg-[#f1eaff] text-[#7652b9]",
  guard: "bg-[#eaf0ff] text-[#315bbd]",
};

const emptyForm = { email: "", full_name: "", password: "", role: "guard" as Role, document_id: "" };

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

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
      setError(err instanceof ApiError ? err.message : "No se pudo crear el usuario");
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
    if (!confirm(`Eliminar a ${user.full_name}?`)) return;
    await api.deleteUser(token, user.id);
    await load();
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
        <span className="size-1.5 rounded-full bg-[#1ba792]" /> Administracion
      </div>
      <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Usuarios</h1>
      <p className="mt-2 max-w-[560px] text-[13px] leading-6 text-[#82989a]">
        Crea al personal del evento: guardias que validan QRs en las filas y administradores. Los asistentes no son usuarios: obtienen su QR con RUT + codigo de entrada.
      </p>

      <form
        onSubmit={handleCreate}
        className="mt-6 rounded-[24px] border border-[#e3ebea] bg-white p-5 shadow-[0_12px_32px_rgba(37,73,79,.05)] sm:p-6"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-[#eaf0ff]">
            <UsersRound className="size-[19px] text-[#3b69c8]" />
          </div>
          <div>
            <p className="font-display text-[14px] font-extrabold text-[#234953]">Nuevo usuario</p>
            <p className="text-[11px] text-[#96a8a9]">Completa los datos para crear una cuenta</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <input
            placeholder="Nombre completo"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
            className="rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3.5 py-2.5 text-[12px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3] xl:col-span-2"
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            className="rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3.5 py-2.5 text-[12px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]"
          />
          <input
            type="password"
            placeholder="Contrasena"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            className="rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3.5 py-2.5 text-[12px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3.5 py-2.5 text-[12px] font-semibold text-[#274b53] outline-none focus:border-[#8dcfc3]"
          >
            <option value="guard">Guardia</option>
            <option value="admin">Administrador</option>
          </select>
        </div>

        {error && <p className="mt-3 rounded-xl bg-[#fdeceb] px-3 py-2 text-[11px] font-semibold text-[#c6505b]">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#123f4a] px-4 py-2.5 text-[11px] font-bold text-white shadow-[0_8px_18px_rgba(18,63,74,.18)] transition hover:-translate-y-0.5 hover:bg-[#0c5360] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="size-3.5" /> Crear usuario
        </button>
      </form>

      <div className="mt-6 overflow-hidden rounded-[24px] border border-[#e3ebea] bg-white shadow-[0_12px_32px_rgba(37,73,79,.05)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[#edf2f1] bg-[#fbfdfc]">
                <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-[.1em] text-[#96a8a9]">Persona</th>
                <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-[.1em] text-[#96a8a9]">Rol</th>
                <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-[.1em] text-[#96a8a9]">Estado</th>
                <th className="px-6 py-3.5 text-right text-[10px] font-extrabold uppercase tracking-[.1em] text-[#96a8a9]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#edf2f1] last:border-b-0 hover:bg-[#fbfdfc]">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={`grid size-9 place-items-center rounded-xl text-[11px] font-extrabold ${ROLE_TONE[u.role]}`}>
                        {initials(u.full_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-bold text-[#274b53]">{u.full_name}</p>
                        <p className="truncate text-[11px] text-[#93a5a7]">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold ${ROLE_TONE[u.role]}`}>
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    {u.is_active ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#178263]">
                        <ShieldCheck className="size-3.5" /> Activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#9aacad]">Inactivo</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => toggleActive(u)}
                        title={u.is_active ? "Desactivar" : "Activar"}
                        className="grid size-8 place-items-center rounded-lg border border-[#e4ecea] text-[#789093] transition hover:border-[#b9dcd5] hover:text-[#148d79]"
                      >
                        {u.is_active ? <UserRoundX className="size-3.5" /> : <UserRoundCheck className="size-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        title="Eliminar"
                        className="grid size-8 place-items-center rounded-lg border border-[#f3dede] text-[#c6505b] transition hover:border-[#e8b6b6] hover:bg-[#fdeceb]"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-[11px] text-[#91a4a5]">
                    Aun no hay usuarios registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
