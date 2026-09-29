import { useEffect, useState } from "react";
import { ClipboardList, Gauge } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, LANE_LABEL, type AccessLog, type EventMetrics } from "../api";
import { REASON_LABEL, REASON_TONE } from "../reasons";
import { useEventSelection } from "../useEventSelection";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatDate(value: string) {
  return new Date(`${value}Z`).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LogsPage() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [metrics, setMetrics] = useState<EventMetrics | null>(null);
  const { events, eventId, setEventId } = useEventSelection(token);

  useEffect(() => {
    if (!token) return;
    api.listLogs(token).then(setLogs);
  }, [token]);

  useEffect(() => {
    if (!token || eventId === null) return;
    api.eventMetrics(token, eventId).then(setMetrics).catch(() => setMetrics(null));
  }, [token, eventId]);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
        <span className="size-1.5 rounded-full bg-[#1ba792]" /> Trazabilidad
      </div>
      <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Historial de accesos</h1>
      <p className="mt-2 max-w-[560px] text-[13px] leading-6 text-[#82989a]">Cada intento de acceso, concedido o rechazado, queda registrado aquí.</p>

      {events.length > 0 && (
        <div className="mt-6 rounded-[24px] border border-[#e3ebea] bg-white px-5 py-5 shadow-[0_12px_32px_rgba(37,73,79,.05)] sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-[#e5f7f1]">
                <Gauge className="size-[19px] text-[#0e806c]" />
              </div>
              <div>
                <p className="font-display text-[14px] font-extrabold text-[#234953]">Rendimiento por fila</p>
                <p className="text-[11px] text-[#96a8a9]">
                  {metrics
                    ? `${metrics.tickets_admitted} de ${metrics.tickets_total} entradas ingresadas`
                    : "Sin datos"}
                </p>
              </div>
            </div>
            <select
              value={eventId ?? ""}
              onChange={(e) => setEventId(Number(e.target.value))}
              className="rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3 py-2 text-[12px] font-semibold text-[#274b53] outline-none"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead className="text-[10px] uppercase tracking-[.1em] text-[#a2b2b3]">
                <tr>
                  <th className="py-2 font-extrabold">Fila</th>
                  <th className="py-2 text-right font-extrabold">Escaneos</th>
                  <th className="py-2 text-right font-extrabold">Concedidos</th>
                  <th className="py-2 text-right font-extrabold">Escaneos/min</th>
                  <th className="py-2 text-right font-extrabold">Latencia p50 / p95</th>
                  <th className="py-2 pl-4 font-extrabold">Rechazos</th>
                </tr>
              </thead>
              <tbody>
                {metrics?.gates.map((g) => (
                  <tr key={g.gate_id ?? "none"} className="border-t border-[#edf2f1] text-[#34565c]">
                    <td className="py-2.5 font-bold">
                      {g.gate_name}
                      {g.lane && <span className="ml-1.5 text-[10px] font-semibold text-[#93a5a7]">({LANE_LABEL[g.lane]})</span>}
                    </td>
                    <td className="py-2.5 text-right">{g.scans}</td>
                    <td className="py-2.5 text-right">{g.granted}</td>
                    <td className="py-2.5 text-right">{g.scans_per_minute ?? "—"}</td>
                    <td className="py-2.5 text-right font-mono">
                      {g.latency_p50_ms !== null ? `${g.latency_p50_ms.toFixed(1)} / ${g.latency_p95_ms?.toFixed(1)} ms` : "—"}
                    </td>
                    <td className="py-2.5 pl-4">
                      {Object.entries(g.rejected_by_reason)
                        .map(([reason, n]) => `${REASON_LABEL[reason] ?? reason}: ${n}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-[#a2b2b3]">
            La latencia es el tiempo de validación en el servidor. Escaneos/min es la tasa observada entre el primer y el
            último escaneo de cada fila: con la tasa de llegada permite estimar el largo de fila (ley de Little).
          </p>
        </div>
      )}

      <div className="mt-6 rounded-[24px] border border-[#e3ebea] bg-white px-5 py-5 shadow-[0_12px_32px_rgba(37,73,79,.05)] sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-[#eaf0ff]">
            <ClipboardList className="size-[19px] text-[#3b69c8]" />
          </div>
          <div>
            <p className="font-display text-[14px] font-extrabold text-[#234953]">Actividad reciente</p>
            <p className="text-[11px] text-[#96a8a9]">Ultimos {logs.length} movimientos</p>
          </div>
        </div>

        <div className="mt-4">
          {logs.length === 0 && (
            <div className="rounded-2xl bg-[#f7fbfa] py-8 text-center text-[11px] text-[#91a4a5]">Sin movimientos registrados todavía.</div>
          )}
          {logs.map((log) => (
            <div key={log.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#edf2f1] py-3.5 last:border-b-0">
              <div className={`grid size-9 place-items-center rounded-xl text-[11px] font-extrabold ${REASON_TONE[log.reason] ?? "bg-[#f2f7f5] text-[#557276]"}`}>
                {log.holder_name ? initials(log.holder_name) : "?"}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[12px] font-bold text-[#274b53]">{log.holder_name ?? "Código desconocido"}</p>
                  <span className={`hidden rounded-full px-1.5 py-0.5 text-[9px] font-bold sm:inline-flex ${REASON_TONE[log.reason] ?? "bg-[#f2f7f5] text-[#557276]"}`}>
                    {REASON_LABEL[log.reason] ?? log.reason}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[#93a5a7]">
                  {log.gate?.name ?? "Sin fila"} · {log.scanned_by?.full_name ?? "—"} · {log.latency_ms.toFixed(1)} ms
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold text-[#3c5c62]">{formatDate(log.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
