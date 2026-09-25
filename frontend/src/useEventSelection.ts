import { useCallback, useEffect, useState } from "react";
import { api, type EventInfo, type Gate } from "./api";

const EVENT_KEY = "control-acceso-evento";
const GATE_KEY = "control-acceso-puerta";

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
    if (!token || eventId === null) return setGates([]);
    const list = await api.listGates(token, eventId);
    setGates(list);
    if (!list.some((g) => g.id === gateId)) setGateId(list[0]?.id ?? null);
  }, [token, eventId, gateId, setGateId]);

  useEffect(() => {
    void reloadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    void reloadGates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  return { events, gates, eventId, setEventId, gateId, setGateId, reloadEvents, reloadGates };
}
