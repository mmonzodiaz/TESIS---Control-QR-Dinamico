import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, LANE_LABEL, type AccessLog, type EventMetrics } from "../api";
import { REASON_LABEL, REASON_TONE } from "../reasons";
import { useEventSelection } from "../useEventSelection";

function formatDate(value: string) {
  return new Date(`${value}Z`).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ms = (value: number) => `${value.toFixed(1).replace(".", ",")} ms`;

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
      <h1 className="page-title">Historial de accesos</h1>
      <p className="page-lead">Cada intento de ingreso queda registrado aquí, se haya concedido o no. El RUT se muestra enmascarado.</p>

      {events.length > 0 && (
        <section className="section mt-6">
          <div className="section-head">
            <div>
              <h2 className="section-title">Rendimiento por fila</h2>
              <p className="section-meta">
                {metrics ? `${metrics.tickets_admitted} de ${metrics.tickets_total} entradas ingresadas` : "Sin datos"}
              </p>
            </div>
            <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))} aria-label="Evento" className="field w-auto py-2 text-[14px]">
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="data-table min-w-[680px]">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th className="text-right">Lecturas</th>
                  <th className="text-right">Concedidas</th>
                  <th className="text-right">Lecturas por minuto</th>
                  <th className="text-right">Latencia p50 / p95</th>
                  <th>Rechazos</th>
                </tr>
              </thead>
              <tbody>
                {metrics?.gates.map((g) => (
                  <tr key={g.gate_id ?? "none"}>
                    <td>
                      <span className="font-medium">{g.gate_name}</span>
                      {g.lane && <span className="ml-2 text-[13px] text-ink-2">{LANE_LABEL[g.lane]}</span>}
                    </td>
                    <td className="tnum text-right">{g.scans}</td>
                    <td className="tnum text-right">{g.granted}</td>
                    <td className="tnum text-right">{g.scans_per_minute !== null ? String(g.scans_per_minute).replace(".", ",") : "—"}</td>
                    <td className="tnum text-right">
                      {g.latency_p50_ms !== null ? `${ms(g.latency_p50_ms)} / ${ms(g.latency_p95_ms ?? 0)}` : "—"}
                    </td>
                    <td className="text-ink-2">
                      {Object.entries(g.rejected_by_reason)
                        .map(([reason, n]) => `${REASON_LABEL[reason] ?? reason}: ${n}`)
                        .join("; ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line-soft px-5 py-3 text-[13px] leading-5 text-ink-2">
            La latencia es el tiempo de validación en el servidor. Las lecturas por minuto se miden entre la primera y la última
            lectura de cada fila; junto con la tasa de llegada permiten estimar el largo de la fila (ley de Little).
          </p>
        </section>
      )}

      <section className="section mt-6">
        <div className="section-head">
          <h2 className="section-title">Actividad reciente</h2>
          <p className="section-meta">{logs.length === 1 ? "Último intento" : `Últimos ${logs.length} intentos`}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Persona</th>
                <th>Resultado</th>
                <th>Fila</th>
                <th>Personal</th>
                <th className="text-right">Latencia</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="tnum whitespace-nowrap text-ink-2">{formatDate(log.created_at)}</td>
                  <td>
                    <p className="font-medium">{log.holder_name ?? "Código desconocido"}</p>
                    {log.rut_masked && <p className="tnum text-[13px] text-ink-2">{log.rut_masked}</p>}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={REASON_TONE[log.reason] ?? "tag tag-neutral"}>{REASON_LABEL[log.reason] ?? log.reason}</span>
                      {log.offline && <span className="tag tag-warn">Sin conexión</span>}
                      {log.offline && log.granted && log.reason !== "ok" && (
                        // Entró sin conexión, pero el servidor no lo habría dejado pasar (ADR-15).
                        <span className="tag tag-alert">Alerta: ingresó</span>
                      )}
                      {log.face_consent && (
                        // Evidencia del consentimiento (ADR-16). El puntaje no se guarda.
                        <span className="tag tag-neutral">Comparación facial consentida</span>
                      )}
                    </div>
                  </td>
                  <td>{log.gate?.name ?? "Sin fila"}</td>
                  <td>{log.scanned_by?.full_name ?? "—"}</td>
                  <td className="tnum whitespace-nowrap text-right text-ink-2">{log.offline ? "Sincronizado después" : ms(log.latency_ms)}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink-2">
                    Todavía no hay intentos. Aparecerán aquí apenas un guardia escanee la primera cédula.
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
