import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnswerPlacement, HistoryEntry } from '@fractal/shared';
import { startService, type Service } from '../main';
import { SqlitePaperStore } from '../store/sqlite';

let service: Service | undefined;
let directory: string;
afterEach(async () => {
  await service?.stop();
  service = undefined;
  rmSync(directory, { recursive: true, force: true });
});
const placement: AnswerPlacement = { page: 2, x: 0.2, y: 0.3, state: 'collapsed', updatedAt: '2026-10-06T01:00:00.000Z' };
async function setup() {
  directory = mkdtempSync(join(tmpdir(), 'fractal-placement-'));
  service = await startService({ dataDirectory: directory, port: 0, log: () => {}, allowRealCli: false, startBackground: false });
  const entry: HistoryEntry = {
    id: 'answer',
    paperKey: 'paper',
    kind: 'question',
    question: 'Why?',
    text: 'Because.',
    status: 'completed',
    createdAt: placement.updatedAt,
    updatedAt: placement.updatedAt,
    completedAt: placement.updatedAt,
    requestId: null,
    context: {},
    answer: null,
    error: null,
    rev: 0,
    deviceId: 'android',
    deleted: false,
  };
  const store = service.store as SqlitePaperStore;
  const saved = store.putHistory(entry);
  const url = service.url;
  const headers = { origin: url, 'x-paperread-token': service.token, 'content-type': 'application/json' };
  const call = (path: string, method = 'GET', body?: unknown) =>
    fetch(url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { saved, call, store };
}

describe('answer card placement', () => {
  it('PUT persists placement, bumps rev, exposes GET/pull, validates input and deletes normally', async () => {
    const { saved, call, store } = await setup();
    const path = `/api/papers/paper/history/${saved.id}`;
    const cursor = Number(store.pull(0).cursor);
    const put = await call(path + '/placement', 'PUT', { placement });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ data: { history: { placement, rev: saved.rev + 1 } } });
    expect(await (await call(path)).json()).toMatchObject({ data: { history: { placement } } });
    expect(await (await call('/api/papers/paper/history')).json()).toMatchObject({ data: { history: [{ placement }] } });
    expect(await (await call(`/api/sync/pull?since=${cursor}`)).json()).toMatchObject({ data: { history: [{ id: saved.id, placement, rev: saved.rev + 1 }] } });
    for (const body of [
      {},
      { placement: { ...placement, x: 2 } },
      { placement: { ...placement, page: 0 } },
      { placement: { ...placement, state: 'invalid' } },
      { placement: { ...placement, updatedAt: 'invalid' } },
    ]) {
      expect((await call(path + '/placement', 'PUT', body)).status).toBe(400);
    }
    expect((await call('/api/papers/paper/history/missing/placement', 'PUT', { placement })).status).toBe(404);
    expect((await call('/api/papers/other/history/answer/placement', 'PUT', { placement })).status).toBe(404);
    expect(store.getHistory(saved.id)?.rev).toBe(saved.rev + 1);
    await service!.stop();
    service = undefined;
    const reopened = new SqlitePaperStore(directory);
    try {
      expect(reopened.getHistory(saved.id)?.placement).toEqual(placement);
    } finally {
      reopened.db.close();
    }
    service = await startService({ dataDirectory: directory, port: 0, log: () => {}, allowRealCli: false, startBackground: false });
    // Rebuild the request with the restarted service's URL and token.
    const response = await fetch(`${service.url}${path}`, { method: 'DELETE', headers: { origin: service.url, 'x-paperread-token': service.token } });
    expect(response.status).toBe(200);
    expect((service.store as SqlitePaperStore).listHistory('paper')).toEqual([]);
    expect((service.store as SqlitePaperStore).pull(cursor).history).toMatchObject([{ id: saved.id, deleted: true, placement }]);
  });

  it('sync push round-trips placement and merges by its own clock while retaining revision conflicts', async () => {
    const { saved, call } = await setup();
    let current = saved;
    let index = 0;
    const push = async (candidate: AnswerPlacement | undefined, baseRev = current.rev) => {
      const { placement: ignored, ...withoutPlacement } = current;
      const entry = { ...withoutPlacement, ...(candidate ? { placement: candidate } : {}), text: `Updated ${index}` };
      const response = await call('/api/sync/push', 'POST', { history: [{ entry, baseRev, requestId: `push-${index++}` }] });
      expect(response.status).toBe(200);
      const result = (await response.json()).data.metadataResults[0];
      current = result.current;
      return result;
    };
    expect(await push(placement)).toMatchObject({ applied: true, current: { placement } });
    const newer = { ...placement, state: 'dismissed' as const, updatedAt: '2026-10-06T02:00:00.000Z' };
    expect(await push(newer)).toMatchObject({ applied: true, current: { placement: newer } });
    expect(await push(placement)).toMatchObject({ applied: true, current: { placement: newer } });
    expect(await push(undefined)).toMatchObject({ applied: true, current: { placement: newer } });
    const older = { ...newer, x: 0.7, updatedAt: '2026-10-06T01:30:00.000Z' }; // older instant than 02:00Z
    expect(await push(older)).toMatchObject({ applied: true, current: { placement: newer } });
    expect(await push({ ...newer, x: 0.8 })).toMatchObject({ applied: true, current: { placement: { ...newer, x: 0.8 } } });
    expect(await push(placement, saved.rev)).toMatchObject({ applied: false, conflict: true });
    expect(await (await call('/api/sync/pull?since=0')).json()).toMatchObject({ data: { history: [{ placement: current.placement }] } });
    expect(await (await call('/api/papers/paper/history/answer')).json()).toMatchObject({ data: { history: { placement: current.placement } } });
  });
});
