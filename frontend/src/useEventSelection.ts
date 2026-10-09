import { useCallback, useEffect, useRef, useState } from "react";
import { api, type EventInfo, type Gate } from "./api";

const EVENT_KEY = "control-acceso-evento";
const GATE_KEY = "control-acceso-puerta";
/** Espera entre reintentos automaticos cuando la lista de filas no se pudo cargar. */
export const GATES_RETRY_MS = 10_000;

function readNumber(key: string): number | null {
  try {
    const value = localStorage.getItem(key);
    return value ? Number(value) : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // preferencia de conveniencia; si falla solo se pierde entre recargas
  }
}

/** Evento y puerta seleccionados por el personal, recordados por navegador (una tablet por fila). */
export function useEventSelection(token: string | null) {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [eventId, setEventIdState] = useState<number | null>(() => readNumber(EVENT_KEY));
  const [gateId, setGateIdState] = useState<number | null>(() => readNumber(GATE_KEY));
  // Evento al que corresponde `gates`. Al cambiar de evento, la lista (y la fila elegida) siguen
  // siendo del anterior hasta que llega la nueva: mientras tanto no se expone ninguna fila, para que
  // el escaner no valide contra el evento equivocado (y para siempre si la lista no llega).
  const [gatesFor, setGatesFor] = useState<number | null>(null);
  const [gatesError, setGatesError] = useState<string | null>(null);
  // Cuenta las fallas seguidas: cada una vuelve a programar el reintento automatico.
  const [gatesFailures, setGatesFailures] = useState(0);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const gateIdRef = useRef(gateId);
  gateIdRef.current = gateId;

  const setEventId = useCallback((id: number | null) => {
    setEventIdState(id);
    writeNumber(EVENT_KEY, id);
  }, []);

  const setGateId = useCallback((id: number | null) => {
    setGateIdState(id);
    writeNumber(GATE_KEY, id);
  }, []);

  const reloadEvents = useCallback(async () => {
    if (!token) return;
    const list = await api.listEvents(token);
    setEvents(list);
    if (list.length && !list.some((e) => e.id === eventId)) setEventId(list[0].id);
  }, [token, eventId, setEventId]);

  const reloadGates = useCallback(async () => {
    if (!token || eventId === null) {
      setGates([]);
      setGatesFor(null);
      return;
    }
    const forEvent = eventId;
    try {
      const list = await api.listGates(token, forEvent);
      if (eventIdRef.current !== forEvent) return; // llego tarde: ya se eligio otro evento
      setGates(list);
      setGatesFor(forEvent);
      setGatesError(null);
      setGatesFailures(0);
      if (!list.some((g) => g.id === gateIdRef.current)) setGateId(list[0]?.id ?? null);
    } catch (err) {
      if (eventIdRef.current === forEvent) {
        setGates([]);
        setGatesFor(forEvent);
        setGatesError("No se pudieron cargar las filas del evento.");
        setGatesFailures((n) => n + 1);
      }
      throw err;
    }
  }, [token, eventId, setGateId]);

  /** Reintento a pedido (boton "Reintentar"); el error, si vuelve, queda en gatesError. */
  const retryGates = useCallback(() => {
    reloadGates().catch(() => {});
  }, [reloadGates]);

  useEffect(() => {
    void reloadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    reloadGates().catch(() => {}); // el error queda en gatesError
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  // Una falla pasajera al cargar las filas no debe dejar el escaner sin fila hasta que el guardia
  // cambie de evento o recargue: mientras dure el error, se reintenta solo cada GATES_RETRY_MS.
  useEffect(() => {
    if (gatesFailures === 0) return;
    const timer = setTimeout(retryGates, GATES_RETRY_MS);
    return () => clearTimeout(timer);
  }, [gatesFailures, retryGates]);

  const current = gatesFor === eventId;
  const currentGates = current ? gates : [];
  return {
    events,
    gates: currentGates,
    eventId,
    setEventId,
    // Solo una fila del evento elegido; null mientras se carga o si no se pudo cargar.
    gateId: currentGates.some((g) => g.id === gateId) ? gateId : null,
    setGateId,
    gatesError: current ? gatesError : null,
    reloadEvents,
    reloadGates,
    retryGates,
  };
}
