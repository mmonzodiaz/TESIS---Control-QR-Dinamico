import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, LANE_LABEL, type Lane, type Ticket } from "../api";
import { formatRut, isValidRut } from "../rut";
import { useEventSelection } from "../useEventSelection";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function EventsPage() {
  const { token } = useAuth();
  const { events, gates, eventId, setEventId, reloadEvents, reloadGates } = useEventSelection(token);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [newEvent, setNewEvent] = useState("");
  const [newGate, setNewGate] = useState<{ name: string; lane: Lane }>({ name: "", lane: "digital" });
  const [newTicket, setNewTicket] = useState({ holder_name: "", rut: "" });
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
      setError(err instanceof ApiError ? err.message : "Ocurrió un error");
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
    if (!isValidRut(newTicket.rut)) return setError("RUT inválido");
    return run(async () => {
      await api.createTicket(token!, eventId!, newTicket);
      setNewTicket({ holder_name: "", rut: "" });
      await reloadTickets();
    });
  };

  const deleteTicket = (id: number) =>
    run(async () => {
      await api.deleteTicket(token!, id);
      await reloadTickets();
    });

  const admitted = tickets.filter((t) => t.admitted_at).length;

  return (
    <div>
      <h1 className="page-title">Eventos</h1>
      <p className="page-lead">
        Crea el evento, sus filas de ingreso y la lista de entradas por RUT. En la puerta, el guardia escanea la cédula digital
        y el sistema coteja el RUT firmado con esta lista. No hay códigos de entrada: la cédula es de la persona, no del evento.
      </p>

      {error && (
        <p role="alert" className="notice notice-error mt-5">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Evento</h2>
            <p className="section-meta">{plural(events.length, "evento", "eventos")}</p>
          </div>
          <div className="section-body">
            <label htmlFor="event-select" className="field-label">
              Evento seleccionado
            </label>
            <select id="event-select" value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))} className="field mt-1.5">
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
            <form onSubmit={createEvent} className="mt-5">
              <label htmlFor="event-new" className="field-label">
                Nuevo evento
              </label>
              <div className="mt-1.5 flex gap-2">
                <input id="event-new" value={newEvent} onChange={(e) => setNewEvent(e.target.value)} required placeholder="Nombre del evento" className="field" />
                <button className="btn btn-primary shrink-0">Crear</button>
              </div>
            </form>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Filas de ingreso</h2>
            <p className="section-meta">Cada lectura queda asociada a su fila</p>
          </div>
          <ul>
            {gates.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-2.5 text-[14px]">
                {g.name}
                <span className="tag tag-neutral">{LANE_LABEL[g.lane]}</span>
              </li>
            ))}
          </ul>
          {eventId !== null && (
            <form onSubmit={createGate} className="section-body">
              <label htmlFor="gate-new" className="field-label">
                Nueva fila
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input
                  id="gate-new"
                  value={newGate.name}
                  onChange={(e) => setNewGate({ ...newGate, name: e.target.value })}
                  required
                  placeholder="Ej. Puerta norte"
                  className="field min-w-[160px] flex-1"
                />
                <select
                  value={newGate.lane}
                  onChange={(e) => setNewGate({ ...newGate, lane: e.target.value as Lane })}
                  aria-label="Tipo de fila"
                  className="field w-auto"
                >
                  <option value="digital">Cédula digital</option>
                  <option value="normal">Normal</option>
                </select>
                <button className="btn btn-primary">Agregar fila</button>
              </div>
            </form>
          )}
        </section>
      </div>

      {eventId !== null && (
        <section className="section mt-6">
          <div className="section-head">
            <h2 className="section-title">Entradas</h2>
            <p className="section-meta">
              {plural(tickets.length, "entrada", "entradas")}, {plural(admitted, "ingresada", "ingresadas")}
            </p>
          </div>
          <form onSubmit={createTicket} className="section-body flex flex-wrap items-end gap-3 border-b border-line-soft">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="ticket-name" className="field-label">
                Nombre del titular
              </label>
              <input
                id="ticket-name"
                value={newTicket.holder_name}
                onChange={(e) => setNewTicket({ ...newTicket, holder_name: e.target.value })}
                required
                className="field mt-1.5"
              />
            </div>
            <div className="w-[170px]">
              <label htmlFor="ticket-rut" className="field-label">
                RUT
              </label>
              <input
                id="ticket-rut"
                value={newTicket.rut}
                onChange={(e) => setNewTicket({ ...newTicket, rut: formatRut(e.target.value) })}
                required
                placeholder="12.345.678-5"
                className="field tnum mt-1.5"
              />
            </div>
            <button className="btn btn-primary">Agregar entrada</button>
          </form>

          <div className="overflow-x-auto">
            <table className="data-table min-w-[520px]">
              <thead>
                <tr>
                  <th>Titular</th>
                  <th>RUT</th>
                  <th>Estado</th>
                  <th className="w-[1%]">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.holder_name}</td>
                    <td className="tnum">{formatRut(t.document_id)}</td>
                    <td>{t.admitted_at ? <span className="tag tag-ok">Ingresó</span> : <span className="text-ink-2">Sin ingresar</span>}</td>
                    <td className="text-right">
                      {!t.admitted_at && (
                        <button onClick={() => deleteTicket(t.id)} className="btn-link whitespace-nowrap text-bad">
                          Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {tickets.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-ink-2">
                      Este evento todavía no tiene entradas. Agrega el primer RUT con el formulario de arriba.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
