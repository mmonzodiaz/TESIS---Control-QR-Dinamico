import { useCallback, useEffect, useState } from "react";
import { CalendarDays, DoorOpen, KeyRound, Plus, Ticket as TicketIcon, Unlink } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type Lane, type Ticket, type TicketCreated } from "../api";
import { formatRut, isValidRut } from "../rut";
import { useEventSelection } from "../useEventSelection";

const LANE_LABEL: Record<Lane, string> = { rapida: "Fila rapida (QR)", normal: "Fila normal" };

const inputClass =
  "rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3.5 py-2.5 text-[12px] font-medium text-[#274b53] outline-none placeholder:text-[#acbabb] focus:border-[#8dcfc3]";
const buttonClass =
  "flex items-center justify-center gap-2 rounded-xl bg-[#123f4a] px-4 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#0c5360] disabled:opacity-60";

function Card({ icon: Icon, title, subtitle, children }: { icon: typeof CalendarDays; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-[#e3ebea] bg-white px-5 py-5 shadow-[0_12px_32px_rgba(37,73,79,.05)] sm:px-6">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-2xl bg-[#e5f7f1]">
          <Icon className="size-[19px] text-[#0e806c]" />
        </div>
        <div>
          <p className="font-display text-[14px] font-extrabold text-[#234953]">{title}</p>
          <p className="text-[11px] text-[#96a8a9]">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function EventsPage() {
  const { token } = useAuth();
  const { events, gates, eventId, setEventId, reloadEvents, reloadGates } = useEventSelection(token);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [newEvent, setNewEvent] = useState("");
  const [newGate, setNewGate] = useState<{ name: string; lane: Lane }>({ name: "", lane: "rapida" });
  const [newTicket, setNewTicket] = useState({ holder_name: "", rut: "" });
  const [created, setCreated] = useState<TicketCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadTickets = useCallback(async () => {
    if (!token || eventId === null) return setTickets([]);
    setTickets(await api.listTickets(token, eventId));
  }, [token, eventId]);

  useEffect(() => {
    void reloadTickets();
  }, [reloadTickets]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ocurrio un error");
    }
  }

  const createEvent = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const ev = await api.createEvent(token!, newEvent);
      setNewEvent("");
      setEventId(ev.id);
      await reloadEvents();
    });
  };

  const createGate = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api.createGate(token!, eventId!, newGate);
      setNewGate({ name: "", lane: newGate.lane });
      await reloadGates();
    });
  };

  const createTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidRut(newTicket.rut)) return setError("RUT invalido");
    return run(async () => {
      setCreated(await api.createTicket(token!, eventId!, newTicket));
      setNewTicket({ holder_name: "", rut: "" });
      await reloadTickets();
    });
  };

  const resetTicket = (id: number) =>
    run(async () => {
      await api.resetTicket(token!, id);
      await reloadTickets();
    });

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
        <span className="size-1.5 rounded-full bg-[#1ba792]" /> Administracion
      </div>
      <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Eventos</h1>
      <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-[#82989a]">
        Crea el evento, sus filas de ingreso y las entradas nominativas. Cada entrada liga un RUT a un codigo que la
        persona usa en <strong>/mi-entrada</strong> para obtener su QR dinamico.
      </p>

      {error && <p className="mt-4 rounded-xl bg-[#fdeceb] px-3 py-2 text-[11px] font-semibold text-[#c6505b]">{error}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card icon={CalendarDays} title="Evento" subtitle={`${events.length} evento(s)`}>
          <select
            value={eventId ?? ""}
            onChange={(e) => setEventId(Number(e.target.value))}
            className={`${inputClass} w-full font-semibold`}
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <form onSubmit={createEvent} className="mt-3 flex gap-2">
            <input value={newEvent} onChange={(e) => setNewEvent(e.target.value)} required placeholder="Nombre del nuevo evento" className={`${inputClass} flex-1`} />
            <button className={buttonClass}>
              <Plus className="size-4" /> Crear
            </button>
          </form>
        </Card>

        <Card icon={DoorOpen} title="Filas de ingreso" subtitle="Cada escaneo queda asociado a su fila">
          <ul className="space-y-1.5">
            {gates.map((g) => (
              <li key={g.id} className="flex items-center justify-between rounded-xl bg-[#f7fbfa] px-3 py-2 text-[12px] font-semibold text-[#34565c]">
                {g.name}
                <span className="rounded-full bg-[#e5f7f1] px-2 py-0.5 text-[10px] font-bold text-[#0e806c]">{LANE_LABEL[g.lane]}</span>
              </li>
            ))}
          </ul>
          {eventId !== null && (
            <form onSubmit={createGate} className="mt-3 flex flex-wrap gap-2">
              <input value={newGate.name} onChange={(e) => setNewGate({ ...newGate, name: e.target.value })} required placeholder="Ej. Puerta Norte" className={`${inputClass} min-w-0 flex-1`} />
              <select value={newGate.lane} onChange={(e) => setNewGate({ ...newGate, lane: e.target.value as Lane })} className={inputClass}>
                <option value="rapida">Rapida</option>
                <option value="normal">Normal</option>
              </select>
              <button className={buttonClass}>
                <Plus className="size-4" />
              </button>
            </form>
          )}
        </Card>
      </div>

      {eventId !== null && (
        <div className="mt-5">
          <Card icon={TicketIcon} title="Entradas" subtitle={`${tickets.length} emitida(s), ${tickets.filter((t) => t.admitted_at).length} ingresada(s)`}>
            <form onSubmit={createTicket} className="flex flex-wrap gap-2">
              <input value={newTicket.holder_name} onChange={(e) => setNewTicket({ ...newTicket, holder_name: e.target.value })} required placeholder="Nombre del titular" className={`${inputClass} min-w-0 flex-1`} />
              <input value={newTicket.rut} onChange={(e) => setNewTicket({ ...newTicket, rut: formatRut(e.target.value) })} required placeholder="RUT" className={`${inputClass} w-[150px]`} />
              <button className={buttonClass}>
                <Plus className="size-4" /> Emitir entrada
              </button>
            </form>

            {created && (
              <div className="mt-3 flex items-start gap-3 rounded-2xl border border-[#b9e6da] bg-[#effaf6] px-4 py-3">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-[#0e806c]" />
                <div className="text-[11px] text-[#2f6b5f]">
                  <p>
                    Codigo de la entrada de <strong>{created.holder_name}</strong>:{" "}
                    <span className="font-mono text-[14px] font-extrabold tracking-[.2em] text-[#0e806c]">{created.code}</span>
                  </p>
                  <p className="mt-0.5">Se muestra solo esta vez (en la base queda hasheado). Entregalo al titular.</p>
                </div>
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-[.1em] text-[#a2b2b3]">
                  <tr>
                    <th className="py-2 font-extrabold">Titular</th>
                    <th className="py-2 font-extrabold">RUT</th>
                    <th className="py-2 font-extrabold">Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} className="border-t border-[#edf2f1] text-[#34565c]">
                      <td className="py-2.5 font-bold">{t.holder_name}</td>
                      <td className="py-2.5 font-mono">{formatRut(t.document_id)}</td>
                      <td className="py-2.5">
                        {t.admitted_at ? "Ingreso" : t.claimed_at ? "QR activado en un dispositivo" : "Sin activar"}
                      </td>
                      <td className="py-2.5 text-right">
                        {t.claimed_at && !t.admitted_at && (
                          <button onClick={() => resetTicket(t.id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold text-[#809598] hover:bg-[#fff5f2] hover:text-[#bb684b]">
                            <Unlink className="size-3.5" /> Liberar dispositivo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
