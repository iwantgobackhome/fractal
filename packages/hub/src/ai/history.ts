import { randomUUID } from 'node:crypto';
import type { AiSseEvent, HistoryEntry } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import { invalidInput, notFound } from '../store/errors';
import { toHttp } from '../api/errors';

interface Flight {
  controller: AbortController;
  events: AiSseEvent[];
  listeners: Set<() => void>;
  finished: boolean;
}
const flights = new WeakMap<SqlitePaperStore, Map<string, Flight>>();
function active(store: SqlitePaperStore): Map<string, Flight> {
  let map = flights.get(store);
  if (!map) {
    map = new Map();
    flights.set(store, map);
  }
  return map;
}
const terminal = (entry: HistoryEntry): boolean => !['pending', 'running'].includes(entry.status);
export function cancelHistory(store: SqlitePaperStore, id: string): HistoryEntry {
  const entry = store.getHistory(id);
  if (!entry || entry.deleted) throw notFound('History not found');
  if (terminal(entry)) return entry;
  const next = store.putHistory({ ...entry, status: 'canceled', completedAt: new Date().toISOString(), error: null });
  const flight = active(store).get(id);
  if (flight) {
    flight.controller.abort();
    finish(flight);
  }
  return next;
}
function finish(flight: Flight): void {
  flight.finished = true;
  for (const wake of flight.listeners) wake();
  flight.listeners.clear();
}
function replay(entry: HistoryEntry): AsyncIterable<AiSseEvent> {
  return (async function* () {
    yield { type: 'delta', text: entry.text, historyId: entry.id } as AiSseEvent;
    if (entry.answer && entry.status === 'completed') yield { type: 'done', answer: entry.answer, latex: entry.latex, historyId: entry.id } as AiSseEvent;
    else if (entry.error) yield { type: 'error', error: entry.error, historyId: entry.id } as AiSseEvent;
  })();
}
function observe(flight: Flight): AsyncIterable<AiSseEvent> {
  return (async function* () {
    let index = 0;
    let wake: (() => void) | undefined;
    try {
      while (true) {
        while (index < flight.events.length) yield flight.events[index++]!;
        if (flight.finished) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
          flight.listeners.add(resolve);
        });
        if (wake) flight.listeners.delete(wake);
      }
    } finally {
      if (wake) flight.listeners.delete(wake);
      // A closed iterator/panel detaches only; cancellation requires the explicit API.
    }
  })();
}
/** Admit durably and run independently of the client's stream consumption. */
export function persistentGeneration(
  store: SqlitePaperStore,
  input: { paperKey: string | null; kind: 'question' | 'explanation'; question: string; requestId?: string; context: HistoryEntry['context'] },
  generate: (signal: AbortSignal) => AsyncIterable<AiSseEvent>,
): AsyncIterable<AiSseEvent> {
  const previous = input.requestId
    ? store.listHistory(undefined, true).find((entry) => entry.paperKey === input.paperKey && entry.kind === input.kind && entry.requestId === input.requestId)
    : undefined;
  if (previous) {
    if (previous.deleted) throw invalidInput('Request history was deleted; use a new requestId');
    if (previous.question !== input.question || JSON.stringify(previous.context) !== JSON.stringify(input.context))
      throw invalidInput('requestId was already used for a different request');
    const flight = active(store).get(previous.id);
    return flight ? observe(flight) : replay(previous);
  }
  const now = new Date().toISOString();
  let entry = store.putHistory({
    id: randomUUID(),
    paperKey: input.paperKey,
    kind: input.kind,
    question: input.question,
    context: input.context,
    text: '',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    requestId: input.requestId ?? null,
    answer: null,
    error: null,
    deleted: false,
    rev: 0,
    deviceId: 'hub',
  });
  const flight: Flight = {
    controller: new AbortController(),
    events: [{ type: 'delta', text: '', historyId: entry.id }],
    listeners: new Set(),
    finished: false,
  };
  active(store).set(entry.id, flight);
  void (async () => {
    try {
      entry = store.putHistory({ ...entry, status: 'running' });
      for await (const event of generate(flight.controller.signal)) {
        const current = store.getHistory(entry.id);
        if (!current || current.deleted || terminal(current)) break;
        if (event.type === 'delta') entry = store.putHistory({ ...current, text: current.text + event.text });
        if (event.type === 'done')
          entry = store.putHistory({
            ...current,
            text: event.answer.text,
            answer: event.answer,
            latex: event.latex,
            status: 'completed',
            completedAt: new Date().toISOString(),
          });
        if (event.type === 'error') entry = store.putHistory({ ...current, status: 'failed', error: event.error, completedAt: new Date().toISOString() });
        flight.events.push({ ...event, historyId: entry.id });
        for (const wake of flight.listeners) wake();
        flight.listeners.clear();
      }
      const current = store.getHistory(entry.id);
      if (current && !current.deleted && !terminal(current)) {
        const error = { code: 'NETWORK' as const, message: 'Generation ended without a completed answer', retryable: true };
        store.putHistory({ ...current, status: 'failed', error, completedAt: new Date().toISOString() });
        flight.events.push({ type: 'error', error, historyId: entry.id });
      }
    } catch (cause) {
      const error = toHttp(cause).error;
      const current = store.getHistory(entry.id);
      if (current && !current.deleted && !terminal(current)) {
        store.putHistory({ ...current, status: 'failed', error, completedAt: new Date().toISOString() });
        flight.events.push({ type: 'error', error, historyId: entry.id });
      }
    } finally {
      finish(flight);
      active(store).delete(entry.id);
    }
  })().catch((cause) => {
    // A storage failure must be visible to subscribers; the durable pending/running row is recovered on restart.
    flight.events.push({ type: 'error', error: toHttp(cause).error, historyId: entry.id });
    finish(flight);
    active(store).delete(entry.id);
  });
  return observe(flight);
}
export function stopHistory(store: SqlitePaperStore): void {
  for (const [id, flight] of active(store)) {
    const entry = store.getHistory(id);
    if (entry && !entry.deleted && !terminal(entry))
      store.putHistory({
        ...entry,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: { code: 'NETWORK', message: 'Generation interrupted by service shutdown', retryable: true },
      });
    flight.controller.abort();
    finish(flight);
  }
}
