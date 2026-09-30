import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { PaperStructure } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import { startService } from '../main';
import { TOKEN_HEADER } from '../api/index';
import { PdfJsStructureDetector, STRUCTURE_VERSION } from './detector';
import { StructureService } from './service';

const bytes = readFileSync(new URL('../../test/fixtures/text-layout.pdf', import.meta.url));
const result: PaperStructure = { version: STRUCTURE_VERSION, status: 'ready', items: [], references: [], markers: [] };
const key = '2401.12345v1';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'fractal-structure-shutdown-'));
  cleanups.push(() => {
    if (!root.startsWith(join(tmpdir(), 'fractal-structure-shutdown-'))) throw Error('Unexpected cleanup target');
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function storeAt(root: string) {
  const store = new SqlitePaperStore(root);
  cleanups.push(() => {
    try {
      store.db.close();
    } catch {
      /* Already closed by the shutdown assertion. */
    }
  });
  return store;
}
function seed(store: SqlitePaperStore) {
  store.savePaper(
    {
      paperKey: key,
      sourceKind: 'arxiv',
      arxivId: '2401.12345',
      version: 1,
      title: 'Isolated shutdown fixture',
      authors: [],
      sourceUrl: 'https://arxiv.org/abs/2401.12345v1',
      pdfSha256: createHash('sha256').update(bytes).digest('hex'),
      pageCount: 5,
      extractionVersion: 'shutdown-fixture',
      status: 'ready',
      coverage: { totalPages: 5, textPages: 4, unsupportedPages: [4] },
      createdAt: new Date().toISOString(),
    },
    bytes,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('structure shutdown', () => {
  it('stops scheduled work before its first turn and preserves pending recovery and PDF bytes', async () => {
    const root = directory(),
      store = storeAt(root);
    seed(store);
    const detect = vi.fn(async () => result);
    const service = new StructureService(store, { detect });
    service.schedule(key);
    service.stop();
    service.stop();
    expect(store.onBlocksSaved).toBeUndefined();
    store.db.close();
    expect(() => service.schedule(key, true)).not.toThrow();
    expect(service.read(key).status).toBe('pending');
    await turn();
    expect(detect).not.toHaveBeenCalled();
    const reopened = storeAt(root);
    expect(reopened.getPdf(key)).toEqual(bytes);
    expect(reopened.db.prepare('SELECT status FROM structure_state WHERE paper_key=?').get(key)).toMatchObject({ status: 'running' });
    const recovered = new StructureService(reopened, { detect });
    expect(recovered.read(key).status).toBe('pending');
    recovered.stop();
  });

  it.each(['resolve', 'reject'] as const)('ignores an in-flight detector %s after SQLite closes', async (outcome) => {
    const store = storeAt(directory());
    seed(store);
    const started = deferred<void>(),
      flight = deferred<PaperStructure>();
    const service = new StructureService(store, {
      detect: () => {
        started.resolve();
        return flight.promise;
      },
    });
    service.schedule(key);
    await started.promise;
    const getPaper = vi.spyOn(store, 'getPaper');
    getPaper.mockClear();
    service.stop();
    store.db.close();
    if (outcome === 'resolve') flight.resolve(result);
    else flight.reject(Error('late detector failure'));
    await turn();
    await turn();
    expect(getPaper).not.toHaveBeenCalled(); // Includes the former unhandled catch/getPaper path.
  });

  it('aborts source fetch without waiting and ignores a late successful response', async () => {
    const root = directory(),
      store = storeAt(root);
    seed(store);
    const started = deferred<void>(),
      flight = deferred<Response>();
    let signal: AbortSignal | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      signal = init?.signal ?? undefined;
      started.resolve();
      return flight.promise;
    };
    const service = new StructureService(store, { detect: async () => result }, fetcher);
    service.schedule(key);
    await started.promise;
    service.stop();
    expect(signal?.aborted).toBe(true);
    store.db.close();
    flight.resolve(new Response('\\begin{figure}\\caption{Late result}\\end{figure}'));
    await turn();
    await turn();
    const reopened = storeAt(root);
    expect(reopened.db.prepare('SELECT count(*) n FROM arxiv_source_cache').get()).toMatchObject({ n: 0 });
    expect(reopened.db.prepare('SELECT status FROM structure_state WHERE paper_key=?').get(key)).toMatchObject({ status: 'running' });
  });

  it.each(['success', 'failure'] as const)('does not cache late reference enrichment %s or start a fallback after stop', async (outcome) => {
    const root = directory(),
      store = storeAt(root);
    const started = deferred<void>(),
      flight = deferred<Response>();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal ?? undefined;
      started.resolve();
      return flight.promise;
    });
    const service = new StructureService(store, { detect: async () => result }, fetcher);
    const reference = { n: '1', raw: 'Deep residual learning for image recognition.', doi: '10.1000/correct' };
    const enrichment = service.enrichment(reference);
    await started.promise;
    service.stop();
    expect(signal?.aborted).toBe(true);
    store.db.close();
    flight.resolve(
      outcome === 'success'
        ? new Response(JSON.stringify({ title: 'Deep residual learning for image recognition', externalIds: { DOI: reference.doi } }))
        : new Response('', { status: 503 }),
    );
    expect(await enrichment).toBeNull();
    expect(await service.enrichment(reference)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const reopened = storeAt(root);
    expect(reopened.db.prepare('SELECT count(*) n FROM reference_enrichment').get()).toMatchObject({ n: 0 });
  });

  it('closes the real Hub immediately after HTTP PDF upload while detection is pending', async () => {
    const root = directory(),
      started = deferred<void>(),
      flight = deferred<PaperStructure>();
    vi.spyOn(PdfJsStructureDetector.prototype, 'detect').mockImplementation(() => {
      started.resolve();
      return flight.promise;
    });
    const hub = await startService({ dataDirectory: root, port: 0, allowRealCli: false, startBackground: false, log() {} });
    let stopped = false;
    cleanups.push(async () => {
      flight.resolve(result);
      if (!stopped) await hub.stop();
    });
    const response = await fetch(hub.url + '/api/papers/upload', {
      method: 'POST',
      headers: { origin: hub.url, [TOKEN_HEADER]: hub.token, 'content-type': 'application/pdf' },
      body: bytes,
    });
    expect(response.status).toBe(201);
    const uploaded = ((await response.json()) as { data: { paper: { paperKey: string } } }).data.paper;
    await started.promise;
    // A broken lifecycle would wait forever here if it drained the uncooperative detector.
    await hub.stop();
    stopped = true;
    flight.reject(Error('detector finishes with failure after upload shutdown'));
    await turn();
    await turn();
    const reopened = storeAt(root);
    expect(reopened.getPdf(uploaded.paperKey)).toEqual(bytes);
    const recovered = new StructureService(reopened);
    expect(recovered.read(uploaded.paperKey).status).toBe('pending');
    recovered.stop();
  }, 10_000);
});
