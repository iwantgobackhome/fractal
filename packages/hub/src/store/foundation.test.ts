import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { AiSseEvent, Annotation, Block, ChatMessage, HistoryEntry, LibraryRecord, Paper, Translator } from '@fractal/shared';
import { syncPullSchema, syncPushSchema } from '@fractal/shared';
import { SqlitePaperStore } from './sqlite';
import { pushMetadata } from './metadata-sync';
import { handleLibrary } from '../api/routes/library';
import { handleHistory } from '../api/routes/history';
import { handleSync } from '../api/routes/sync';
import { persistentGeneration, cancelHistory, stopHistory } from '../ai/history';
import { ChatService } from '../chat/index';
import { createApiServer, TOKEN_HEADER } from '../api/index';
import { ProviderRegistry } from '../ai/registry';
import { FtsLibrarySearch } from '../ai/library-search';
import { JobManager } from '../jobs/state';
import { TranslationPipeline } from '../translation/index';

const date = '2026-01-01T00:00:00.000Z';
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const roots: string[] = [];
const stores = new Set<SqlitePaperStore>();
afterEach(() => {
  for (const store of stores) {
    stopHistory(store);
    store.db.close();
  }
  stores.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'fractal-foundation-'));
  roots.push(root);
  return root;
}
function open(root = directory()) {
  const store = new SqlitePaperStore(root);
  stores.add(store);
  return store;
}
function close(store: SqlitePaperStore) {
  stores.delete(store);
  store.db.close();
}
function paper(): Paper {
  return {
    paperKey: `pdf-${sha('url')}-${sha('fixture')}`,
    sourceKind: 'publication',
    arxivId: null,
    version: null,
    title: 'Fixture',
    authors: ['Ada Lovelace'],
    sourceUrl: 'https://example.org/fixture.pdf',
    pdfSha256: sha('fixture'),
    pageCount: 3,
    extractionVersion: 'fixture-v1',
    status: 'ready',
    coverage: { totalPages: 3, textPages: 3, unsupportedPages: [] },
    createdAt: date,
  };
}
function block(key: string): Block {
  return {
    blockId: 'block',
    paperKey: key,
    order: 0,
    kind: 'paragraph',
    sourceText: 'Fixture text',
    sourceHash: sha('Fixture text'),
    regions: [{ page: 2, x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
    alignment: 'exact',
    translatable: true,
    fontFamily: 'serif',
    fontWeight: 'normal',
    fontSize: 0.02,
    pageOrdinal: 0,
  };
}
function memo(key: string): Annotation {
  return {
    kind: 'memo',
    id: randomUUID(),
    paperKey: key,
    page: 2,
    text: 'Keep memo',
    rect: null,
    quote: null,
    updatedAt: date,
    deleted: false,
    rev: 1,
    deviceId: 'android',
  };
}
function messages(): ChatMessage[] {
  return [
    { messageId: 'question', role: 'user', text: 'Why?', status: 'completed', modelId: null, error: null, usage: null, createdAt: date },
    { messageId: 'answer', role: 'assistant', text: 'Because.', status: 'completed', modelId: 'model', error: null, usage: null, createdAt: date },
  ];
}
function request(data: unknown = {}, url = '/'): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(data))]) as IncomingMessage;
  req.headers = {};
  req.url = url;
  return req;
}
const acquirer = {
  resolve: async () => paper(),
  acquire: async () => ({ paper: paper(), blocks: [], pdf: Buffer.from('pdf') }),
  reextract: async () => ({ paper: paper(), blocks: [] }),
};
function oldFixture(root: string) {
  const db = new DatabaseSync(join(root, 'library.sqlite'));
  db.exec(readFileSync(new URL('./fixtures/sqlite-v10.sql', import.meta.url), 'utf8'));
  const bytes = readFileSync(new URL('../../test/fixtures/structure.pdf', import.meta.url));
  const p = { ...paper(), pdfSha256: sha(bytes) };
  const record: LibraryRecord = {
    id: randomUUID(),
    paperKey: p.paperKey,
    title: 'Edited old title',
    authors: [{ given: 'Ada', family: 'Lovelace' }],
    year: 1843,
    venue: 'Edited venue',
    doi: '10.1234/fixture',
    arxivId: null,
    url: p.sourceUrl,
    abstract: 'Preserved abstract',
    tags: ['old', 'kept'],
    collections: ['root-one', 'root-two'],
    addedAt: date,
    updatedAt: date,
    status: 'read',
    bibtexKey: 'edited-key',
  };
  const annotation = memo(p.paperKey);
  const conversation = { conversationId: 'conversation-old', messages: messages() };
  db.prepare('INSERT INTO papers VALUES(?,?,?)').run(p.paperKey, JSON.stringify(p), p.pdfSha256);
  db.prepare('INSERT INTO bibliography VALUES(?,?,?,?,?)').run(p.paperKey, record.doi!, null, p.pdfSha256, JSON.stringify(record));
  db.exec("INSERT INTO collections VALUES('root-one','First'); INSERT INTO collections VALUES('root-two','Second'); INSERT INTO tags VALUES('old')");
  db.prepare('INSERT INTO blocks VALUES(?,?,?)').run(p.paperKey, 'block', JSON.stringify(block(p.paperKey)));
  db.prepare('INSERT INTO annotations VALUES(?,?,?)').run(annotation.id, p.paperKey, JSON.stringify(annotation));
  db.prepare('INSERT INTO conversations VALUES(?,?)').run(p.paperKey, JSON.stringify(conversation));
  db.prepare('INSERT INTO translations VALUES(?,?,?)').run(
    p.paperKey,
    'identity',
    JSON.stringify({
      blockId: 'block',
      sourceHash: block(p.paperKey).sourceHash,
      modelId: 'model',
      promptVersion: 'old-prompt',
      status: 'completed',
      text: 'translation preserved',
      error: null,
      completedAt: date,
    }),
  );
  db.prepare('INSERT INTO jobs VALUES(?,?,?)').run(
    'old-job',
    p.paperKey,
    JSON.stringify({
      jobId: 'old-job',
      paperKey: p.paperKey,
      modelId: 'model',
      promptVersion: 'old-prompt',
      generation: 1,
      state: 'paused',
      pauseReason: 'user',
      completedBlocks: 1,
      totalTranslatableBlocks: 1,
      usage: { inputTokens: 2, outputTokens: 3, limits: null, observedAt: date },
      updatedAt: date,
      currentPage: 2,
    }),
  );
  db.prepare('INSERT INTO highlights VALUES(?,?,?)').run(
    'legacy-highlight',
    p.paperKey,
    JSON.stringify({
      highlightId: 'legacy-highlight',
      paperKey: p.paperKey,
      page: 2,
      rects: [{ page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
      text: 'preserved highlight',
      color: 'yellow',
      note: 'Preserved note',
      createdAt: date,
      updatedAt: date,
    }),
  );
  mkdirSync(join(root, 'pdfs'));
  writeFileSync(join(root, 'pdfs', `${p.pdfSha256}.pdf`), bytes);
  db.close();
  return { p, record, annotation, conversation, bytes };
}
function history(paperKey: string | null = null): HistoryEntry {
  return {
    id: randomUUID(),
    paperKey,
    kind: 'question',
    question: 'Question?',
    text: 'Answer',
    status: 'completed',
    createdAt: date,
    updatedAt: date,
    completedAt: date,
    requestId: null,
    context: {},
    answer: null,
    error: null,
    deleted: false,
    rev: 0,
    deviceId: 'android',
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const answer = { text: 'Full answer', provider: 'codex' as const, model: 'model', inputTokens: null, outputTokens: null, durationMs: 10 };
async function collect(events: AsyncIterable<AiSseEvent>) {
  const out: AiSseEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('data foundation migration and library', () => {
  it('migrates a real v10 SQLite fixture, preserving all old data and PDF bytes, and runs once', () => {
    const root = directory();
    const old = oldFixture(root);
    const store = open(root);
    expect(store.getLibrary(old.p.paperKey)).toMatchObject({ ...old.record, saved: true, savedAt: date, lastReadAt: null, readProgress: null });
    expect(store.getPdf(old.p.paperKey)).toEqual(old.bytes);
    expect(store.getPaper(old.p.paperKey)).toEqual(old.p);
    expect(store.getConversation(old.p.paperKey)).toEqual(old.conversation);
    expect(store.getAnnotation(old.annotation.id)).toEqual(old.annotation);
    expect(store.listTranslations(old.p.paperKey)[0]).toMatchObject({ text: 'translation preserved' });
    expect(store.getJob('old-job')).toMatchObject({ state: 'paused' });
    expect(store.listHighlights(old.p.paperKey)[0]).toMatchObject({ text: 'preserved highlight' });
    expect(store.listBlocks(old.p.paperKey)[0].pageOrdinal).toBe(0);
    expect(store.listFolders()).toMatchObject([
      { id: 'root-one', parentId: null },
      { id: 'root-two', parentId: null },
    ]);
    expect(store.listHistory(old.p.paperKey)).toMatchObject([{ kind: 'conversation', conversation: old.conversation, status: 'completed' }]);
    const cursor = store.pull(0).cursor;
    const revision = store.getLibrary(old.p.paperKey)?.rev;
    close(store);
    const reopened = open(root);
    expect(reopened.pull(0).cursor).toBe(cursor);
    expect(reopened.getLibrary(old.p.paperKey)?.rev).toBe(revision);
    expect(reopened.db.prepare('SELECT count(*) n FROM migrations WHERE version=11').get()).toMatchObject({ n: 1 });
  });
  it('rolls back migration DDL and metadata together on a change-log failure', () => {
    const root = directory();
    const old = oldFixture(root);
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec("CREATE TRIGGER fail_migration BEFORE INSERT ON changes BEGIN SELECT RAISE(FAIL,'fixture failure'); END");
    db.close();
    expect(() => new SqlitePaperStore(root)).toThrow('fixture failure');
    const check = new DatabaseSync(join(root, 'library.sqlite'));
    expect(JSON.parse(String(check.prepare('SELECT data FROM bibliography').get()!.data))).toEqual(old.record);
    expect(check.prepare('SELECT 1 FROM migrations WHERE version=11').get()).toBeUndefined();
    expect(check.prepare("SELECT 1 FROM sqlite_master WHERE name='history'").get()).toBeUndefined();
    expect(
      check
        .prepare('PRAGMA table_info(collections)')
        .all()
        .map((r) => r.name),
    ).toEqual(['id', 'name']);
    check.exec('DROP TRIGGER fail_migration');
    check.close();
    expect(open(root).getLibrary(old.p.paperKey)?.saved).toBe(true);
  });
  it('distinguishes ingest, save and read, and removing saved state retains all resources', async () => {
    const store = open();
    const p = paper();
    store.savePaper(p, Buffer.from('pdf'));
    store.saveBlocks(p.paperKey, [block(p.paperKey)]);
    store.upsertAnnotation(memo(p.paperKey));
    store.saveConversation(p.paperKey, { conversationId: 'conversation', messages: messages() });
    expect(store.getLibrary(p.paperKey)).toMatchObject({ saved: false, savedAt: null, lastReadAt: null, readProgress: null });
    const ctx = { store, acquirer };
    await handleLibrary(
      'POST',
      ['api', 'papers', p.paperKey, 'read'],
      request({ readProgress: { page: 2, fraction: 0.5, scrollOffset: 0.25, blockId: 'block' } }),
      ctx,
    );
    expect(store.getLibrary(p.paperKey)).toMatchObject({ saved: false, readProgress: { page: 2, fraction: 0.5, scrollOffset: 0.25 } });
    expect(store.getLibrary(p.paperKey)?.lastReadAt).toBeTruthy();
    expect(await handleLibrary('GET', ['api', 'library'], request({}, '/api/library?view=saved'), ctx)).toMatchObject({ data: [] });
    expect(await handleLibrary('GET', ['api', 'library'], request({}, '/api/library?view=recent'), ctx)).toMatchObject({ data: [{ paperKey: p.paperKey }] });
    store.patchLibrary(p.paperKey, { saved: true });
    expect(store.getLibrary(p.paperKey)?.savedAt).toBeTruthy();
    await handleLibrary('DELETE', ['api', 'library', p.paperKey], request(), ctx);
    expect(store.getLibrary(p.paperKey)).toMatchObject({ saved: false, savedAt: null });
    expect(store.getPdf(p.paperKey)?.toString()).toBe('pdf');
    expect(store.getPaper(p.paperKey)).not.toBeNull();
    expect(store.listAnnotations(p.paperKey)).toHaveLength(1);
    expect(store.listHistory(p.paperKey)).toHaveLength(1);
    expect(store.getConversation(p.paperKey)?.messages).toHaveLength(2);
    expect(() => store.patchLibrary(p.paperKey, { readProgress: { page: 4 } })).toThrow();
  });
  it('supports metadata-only publication and subsequent acquisition without implicitly saving', () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    const template = store.getLibrary(p.paperKey)!;
    const key = `pdf-${sha('other-url')}-${sha('other-fixture')}`;
    const record = store.publishMetadata({ ...template, paperKey: key, id: randomUUID(), doi: '10.1234/metadata', bibtexKey: 'metadata' });
    expect(record.saved).toBe(false);
    expect(store.getPaper(key)).toBeNull();
    expect(store.getPdf(key)).toBeNull();
    expect(store.pull(0).papers.some((r) => r.paperKey === key)).toBe(true);
    store.savePaper({ ...p, paperKey: key }, Buffer.from('pdf acquired'));
    expect(store.getLibrary(key)).toMatchObject({ saved: false, doi: '10.1234/metadata', bibtexKey: 'metadata' });
  });
});

describe('nested folders', () => {
  it('keeps legacy collection routes, multiple memberships and tags, and rejects cycles', async () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    const ctx = { store, acquirer };
    await handleLibrary('POST', ['api', 'library', 'collections'], request({ id: 'root', name: 'Root' }), ctx);
    await handleLibrary('POST', ['api', 'library', 'folders'], request({ id: 'child', name: 'Child', parentId: 'root' }), ctx);
    store.putFolder({ id: 'leaf', name: 'Leaf', parentId: 'child' });
    store.patchLibrary(p.paperKey, { collections: ['root', 'leaf', 'root'], tags: ['tag', 'tag', 'other'] });
    expect(store.getLibrary(p.paperKey)).toMatchObject({ collections: ['root', 'leaf'], tags: ['tag', 'other'] });
    await handleLibrary('PATCH', ['api', 'library', 'collections', 'child'], request({ name: 'Renamed' }), ctx);
    expect(store.getFolder('child')).toMatchObject({ name: 'Renamed', parentId: 'root' });
    expect(() => store.putFolder({ id: 'root', name: 'Root', parentId: 'leaf' })).toThrow('cycle');
    expect(() => store.putFolder({ id: 'root', name: 'Root', parentId: 'root' })).toThrow('cycle');
    expect(() => store.putFolder({ id: 'root', name: 'Root', parentId: 'missing' })).toThrow();
    expect(() => store.patchLibrary(p.paperKey, { collections: ['missing'] })).toThrow();
  });
  it('promotes children and retains every paper on folder deletion, including root deletion', () => {
    const store = open();
    const p = paper();
    store.savePaper(p, Buffer.from('pdf'));
    store.putFolder({ id: 'root', name: 'Root' });
    store.putFolder({ id: 'child', name: 'Child', parentId: 'root' });
    store.putFolder({ id: 'leaf', name: 'Leaf', parentId: 'child' });
    store.patchLibrary(p.paperKey, { collections: ['child', 'leaf'], saved: true });
    const before = Number(store.pull(0).cursor);
    store.deleteFolder('child');
    expect(store.getFolder('leaf')?.parentId).toBe('root');
    expect(store.getLibrary(p.paperKey)?.collections).toEqual(['leaf']);
    expect(store.getPdf(p.paperKey)?.toString()).toBe('pdf');
    expect(store.getLibrary(p.paperKey)?.saved).toBe(true);
    expect(store.pull(before).folders).toMatchObject([{ id: 'leaf' }, { id: 'child', deleted: true }]);
    store.deleteFolder('root');
    expect(store.getFolder('leaf')?.parentId).toBeNull();
    expect(store.listFolders().map((f) => f.id)).toEqual(['leaf']);
    expect(() => store.putFolder({ id: 'root', name: 'Reused' })).toThrow();
  });
  it('rolls back child promotion, membership edits and tombstones as one transaction', () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    store.putFolder({ id: 'root', name: 'Root' });
    store.putFolder({ id: 'child', name: 'Child', parentId: 'root' });
    store.patchLibrary(p.paperKey, { collections: ['root'] });
    const before = store.pull(0).cursor;
    store.db.exec("CREATE TEMP TRIGGER reject_root BEFORE UPDATE ON collections WHEN NEW.id='root' BEGIN SELECT RAISE(FAIL,'reject root'); END");
    expect(() => store.deleteFolder('root')).toThrow();
    expect(store.getFolder('child')?.parentId).toBe('root');
    expect(store.getFolder('root')?.deleted).toBe(false);
    expect(store.getLibrary(p.paperKey)?.collections).toEqual(['root']);
    expect(store.pull(0).cursor).toBe(before);
  });
});

describe('metadata sync', () => {
  it('returns current data on stale offline edits, permits rebasing and durably replays exact requests', () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    const original = store.getLibrary(p.paperKey)!;
    const edit = { paperKey: p.paperKey, baseRev: original.rev!, patch: { saved: true }, deviceId: 'desktop', requestId: 'save-1' };
    const result = pushMetadata(store, syncPushSchema.parse({ papers: [edit] }));
    expect(result[0]).toMatchObject({ applied: true, current: { saved: true } });
    const cursor = store.pull(0).cursor;
    expect(pushMetadata(store, syncPushSchema.parse({ papers: [edit] }))).toEqual(result);
    expect(store.pull(0).cursor).toBe(cursor);
    const progress = { ...edit, deviceId: 'android', requestId: 'read-1', patch: { readProgress: { page: 2 } } };
    expect(pushMetadata(store, syncPushSchema.parse({ papers: [progress] }))[0]).toMatchObject({
      applied: false,
      conflict: true,
      current: { saved: true },
      rev: result[0]!.rev,
    });
    const rebase = { ...progress, baseRev: result[0]!.rev, requestId: 'read-2' };
    expect(pushMetadata(store, syncPushSchema.parse({ papers: [rebase] }))[0]).toMatchObject({
      applied: true,
      current: { saved: true, readProgress: { page: 2 } },
    });
    expect(() => pushMetadata(store, syncPushSchema.parse({ papers: [{ ...edit, patch: { saved: false } }] }))).toThrow('requestId');
    const root = store.root;
    close(store);
    const reopened = open(root);
    expect(pushMetadata(reopened, syncPushSchema.parse({ papers: [edit] }))).toEqual(result);
  });
  it('syncs folders/history tombstones without resurrection, and retains annotation payload compatibility', async () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    const ctx = { store, acquirer };
    const folder = { id: 'offline-folder', baseRev: 0, patch: { name: 'Offline' }, deviceId: 'android', requestId: 'folder-create' };
    pushMetadata(store, syncPushSchema.parse({ folders: [folder] }));
    pushMetadata(store, syncPushSchema.parse({ folders: [{ ...folder, baseRev: 1, deleted: true, requestId: 'folder-delete' }] }));
    expect(pushMetadata(store, syncPushSchema.parse({ folders: [{ ...folder, requestId: 'folder-stale' }] }))[0]).toMatchObject({
      conflict: true,
      current: { deleted: true },
    });
    const entry = history(p.paperKey);
    expect(pushMetadata(store, syncPushSchema.parse({ history: [{ entry, baseRev: 0, requestId: 'history-create' }] }))[0].applied).toBe(true);
    store.deleteHistory(entry.id);
    expect(pushMetadata(store, syncPushSchema.parse({ history: [{ entry, baseRev: 1, requestId: 'history-stale' }] }))[0]).toMatchObject({
      conflict: true,
      current: { deleted: true },
    });
    const a = memo(p.paperKey);
    expect(await handleSync('POST', ['api', 'sync', 'push'], request({ annotations: [a] }), ctx)).toMatchObject({
      data: { results: [{ id: a.id, applied: true }] },
    });
    const pull = syncPullSchema.parse(store.pull(0));
    expect(pull.folders).toMatchObject([{ deleted: true }]);
    expect(pull.history).toMatchObject([{ deleted: true }]);
    expect(pull.annotations).toHaveLength(1);
    // Original decoders select only their known fields and preserve all annotation geometry.
    expect(syncPushSchema.parse({ annotations: [a] }).annotations[0]).toEqual(a);
  });
  it('never treats push head as a consumed pull checkpoint, so concurrent changes remain pullable', async () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    const consumed = store.pull(0);
    const remote = memo(p.paperKey);
    store.upsertAnnotation(remote);
    const ctx = { store, acquirer };
    const pushed = await handleSync('POST', ['api', 'sync', 'push'], request({ annotations: [] }), ctx);
    expect(pushed).toMatchObject({ data: { cursor: store.pull(0).cursor, serverHead: store.pull(0).cursor } });
    const next = store.pull(Number(consumed.cursor));
    expect(next.annotations[0]?.id).toBe(remote.id);
    expect(Number(next.cursor)).toBeGreaterThan(Number(consumed.cursor));
  });
  it('rolls back metadata write and idempotency receipt if publishing the change fails', () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    const original = store.getLibrary(p.paperKey)!;
    store.db.exec("CREATE TEMP TRIGGER reject_metadata BEFORE INSERT ON changes BEGIN SELECT RAISE(FAIL,'reject metadata'); END");
    expect(() =>
      pushMetadata(
        store,
        syncPushSchema.parse({ papers: [{ paperKey: p.paperKey, baseRev: original.rev!, patch: { saved: true }, deviceId: 'android', requestId: 'atomic' }] }),
      ),
    ).toThrow();
    expect(store.getLibrary(p.paperKey)).toEqual(original);
    expect(store.db.prepare('SELECT count(*) n FROM mutation_receipts').get()).toMatchObject({ n: 0 });
  });
  it('publishes tombstones for explicit hard paper deletion while retaining other paper data', () => {
    const store = open();
    const p = paper();
    store.savePaper(p, Buffer.from('pdf'));
    const annotation = memo(p.paperKey);
    store.upsertAnnotation(annotation);
    const entry = store.putHistory(history(p.paperKey));
    const before = Number(store.pull(0).cursor);
    store.deletePaper(p.paperKey);
    expect(store.getPaper(p.paperKey)).toBeNull();
    expect(store.getPdf(p.paperKey)).toBeNull();
    expect(store.pull(before)).toMatchObject({
      deletedPapers: [p.paperKey],
      annotations: [{ id: annotation.id, deleted: true }],
      history: [{ id: entry.id, deleted: true }],
    });
  });
});

describe('durable streamed history', () => {
  it('continues generation after a real HTTP client disconnect and cancels only via the explicit history API', async () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    store.saveBlocks(p.paperKey, [block(p.paperKey)]);
    const gates = [deferred(), deferred()];
    const signals: AbortSignal[] = [];
    let calls = 0;
    const registry = new ProviderRegistry(
      [
        {
          id: 'codex',
          status: async () => ({ id: 'codex', installed: true, loggedIn: true, version: 'test' }),
          listModels: async () => [{ id: 'model', label: 'Model' }],
          usage: async () => null,
          complete: async function* (input) {
            const index = calls++;
            signals.push(input.signal!);
            yield { type: 'text', text: 'Partial over HTTP' };
            await gates[index]!.promise;
            yield { type: 'text', text: ' final' };
          },
        },
      ],
      { read: async () => ({ default: { provider: 'codex', model: 'model' }, overrides: {} }), write: async () => {} },
    );
    const translator: Translator = {
      connection: async () => ({ status: 'subscription', modelIds: ['model'], defaultModelId: 'model', limits: null }),
      translate: async () => {
        throw new Error('unused');
      },
      translatePage: async () => {
        throw new Error('unused');
      },
      disconnect: async () => {},
    };
    const jobs = new JobManager(store);
    const server = createApiServer({
      store,
      jobs,
      translator,
      pipeline: new TranslationPipeline({ store, jobs, translator }),
      acquirer,
      paperChat: {
        forget: async () => {},
        ask: async () => {
          throw new Error('unused');
        },
      },
      aiRegistry: registry,
      librarySearch: new FtsLibrarySearch(store),
    });
    const address = await server.listen(0);
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, data: unknown = {}) =>
      fetch(base + path, {
        method: 'POST',
        headers: { [TOKEN_HEADER]: server.token, origin: base, 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
    try {
      const response = await post(`/api/papers/${p.paperKey}/ask`, { question: 'Why?', requestId: 'http-ask' });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const initial = await reader.read();
      expect(new TextDecoder().decode(initial.value)).toContain('historyId');
      await reader.cancel();
      await vi.waitFor(() => expect(store.listHistory(p.paperKey)[0]?.text).toBe('Partial over HTTP'));
      const askId = store.listHistory(p.paperKey)[0]!.id;
      expect(signals[0]?.aborted).toBe(false);
      gates[0]!.resolve();
      await vi.waitFor(() => expect(store.getHistory(askId)?.status).toBe('completed'));
      const replayed = await post(`/api/papers/${p.paperKey}/ask`, { question: 'Why?', requestId: 'http-ask' });
      expect(await replayed.text()).toContain('event: done');
      expect(calls).toBe(1);
      const explanation = await post(`/api/papers/${p.paperKey}/explain`, {
        kind: 'figure',
        page: 2,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        requestId: 'http-explain',
      });
      const explanationReader = explanation.body!.getReader();
      await explanationReader.read();
      await vi.waitFor(() => expect(store.listHistory(p.paperKey).find((h) => h.kind === 'explanation')?.text).toBe('Partial over HTTP'));
      const explainId = store.listHistory(p.paperKey).find((h) => h.kind === 'explanation')!.id;
      const canceled = await post(`/api/papers/${p.paperKey}/history/${explainId}/cancel`);
      expect(await canceled.json()).toMatchObject({ data: { history: { status: 'canceled', context: { explanationKind: 'figure', page: 2 } } } });
      expect(signals[1]?.aborted).toBe(true);
      gates[1]!.resolve();
      await explanationReader.cancel();
      await new Promise((done) => setImmediate(done));
      expect(store.getHistory(explainId)?.status).toBe('canceled');
      const list = await fetch(`${base}/api/papers/${p.paperKey}/history`);
      expect(await list.json()).toMatchObject({ data: { history: expect.any(Array) } });
    } finally {
      gates.forEach((gate) => gate.resolve());
      await server.close();
      await new Promise((done) => setImmediate(done));
    }
  });
  it('persists before generation, survives observer close/reopen and restart, and replays without regeneration', async () => {
    const store = open();
    const gate = deferred();
    const generate = vi.fn(async function* (): AsyncIterable<AiSseEvent> {
      expect(store.listHistory()[0]?.status).toBe('running');
      yield { type: 'delta', text: 'Partial' };
      await gate.promise;
      yield { type: 'done', answer };
    });
    const input = { paperKey: null, kind: 'question' as const, question: 'Why?', requestId: 'request-one', context: {} };
    const stream = persistentGeneration(store, input, generate);
    const observer = stream[Symbol.asyncIterator]();
    const first = await observer.next();
    expect(first.value).toMatchObject({ type: 'delta', text: '', historyId: expect.any(String) });
    await observer.return?.();
    await vi.waitFor(() => expect(store.listHistory()[0]?.text).toBe('Partial'));
    expect(store.listHistory()[0]?.status).toBe('running');
    gate.resolve();
    await vi.waitFor(() => expect(store.listHistory()[0]?.status).toBe('completed'));
    const root = store.root;
    const id = store.listHistory()[0]!.id;
    close(store);
    const reopened = open(root);
    expect(reopened.getHistory(id)).toMatchObject({ status: 'completed', answer });
    const replayed = await collect(persistentGeneration(reopened, input, generate));
    expect(replayed.at(-1)).toMatchObject({ type: 'done', historyId: id, answer });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(() => persistentGeneration(reopened, { ...input, question: 'Different?' }, generate)).toThrow('requestId');
  });
  it('persists explicit cancellation with partial text and ignores late provider completion', async () => {
    const store = open();
    const gate = deferred();
    let signal!: AbortSignal;
    persistentGeneration(
      store,
      { paperKey: null, kind: 'explanation', question: 'Explain', requestId: 'cancel', context: { explanationKind: 'equation', page: 2 } },
      async function* (abort) {
        signal = abort;
        yield { type: 'delta', text: 'Partial' };
        await gate.promise;
        yield { type: 'done', answer };
      },
    );
    await vi.waitFor(() => expect(store.listHistory()[0]?.text).toBe('Partial'));
    const id = store.listHistory()[0]!.id;
    expect(cancelHistory(store, id)).toMatchObject({ status: 'canceled', text: 'Partial', error: null });
    expect(signal.aborted).toBe(true);
    gate.resolve();
    await new Promise((done) => setImmediate(done));
    expect(store.getHistory(id)?.status).toBe('canceled');
    expect(cancelHistory(store, id).rev).toBe(store.getHistory(id)?.rev);
    const root = store.root;
    close(store);
    expect(open(root).getHistory(id)?.status).toBe('canceled');
  });
  it('persists provider failures and turns pending/running restarts into interrupted failures', async () => {
    const store = open();
    const events = await collect(
      persistentGeneration(store, { paperKey: null, kind: 'question', question: 'Fail', context: {} }, async function* () {
        yield { type: 'delta', text: 'Before error' };
        throw Object.assign(new Error('Provider error'), { code: 'NETWORK', retryable: true });
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'NETWORK' } });
    expect(store.listHistory()[0]).toMatchObject({ status: 'failed', text: 'Before error', error: { retryable: true } });
    const pending = store.putHistory({ ...history(), status: 'pending', text: 'Unfinished', completedAt: null });
    const running = store.putHistory({ ...history(), status: 'running', text: 'Partial running', completedAt: null });
    const root = store.root;
    close(store);
    const reopened = open(root);
    expect(reopened.getHistory(pending.id)).toMatchObject({ status: 'failed', text: 'Unfinished', error: { retryable: true } });
    expect(reopened.getHistory(running.id)).toMatchObject({ status: 'failed', text: 'Partial running', error: { retryable: true } });
  });
  it('provides filtered history list/detail/cancel/delete and synchronizes explicit deletion', async () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    const one = store.putHistory(history(p.paperKey));
    store.putHistory({ ...history(), kind: 'explanation', context: { explanationKind: 'figure' } });
    const ctx = { store };
    expect(await handleHistory('GET', ['api', 'papers', p.paperKey, 'history'], request(), ctx)).toMatchObject({ data: { history: [{ id: one.id }] } });
    expect(await handleHistory('GET', ['api', 'library', 'history'], request({}, '/api/library/history?kind=explanation'), ctx)).toMatchObject({
      data: { history: [{ kind: 'explanation' }] },
    });
    expect(await handleHistory('GET', ['api', 'library', 'history', one.id], request(), ctx)).toMatchObject({ data: { history: { id: one.id } } });
    expect(await handleHistory('POST', ['api', 'library', 'history', one.id, 'cancel'], request(), ctx)).toMatchObject({
      data: { history: { status: 'completed' } },
    });
    await handleHistory('DELETE', ['api', 'library', 'history', one.id], request(), ctx);
    expect(store.listHistory(p.paperKey)).toHaveLength(0);
    expect(store.pull(0).history?.find((h) => h.id === one.id)?.deleted).toBe(true);
    await expect(handleHistory('GET', ['api', 'library', 'history', one.id], request(), ctx)).rejects.toThrow();
  });
  it('keeps legacy active chat compatible while persisting progress, clear archives and startup recovery', async () => {
    const store = open();
    const p = paper();
    store.savePaper(p);
    store.saveBlocks(p.paperKey, [block(p.paperKey)]);
    const gate = deferred();
    const chat = new ChatService({
      store,
      connection: async () => ({ status: 'subscription', modelIds: ['model'], defaultModelId: 'model', limits: null }),
      chat: {
        forget: async () => {},
        ask: async (input) => {
          input.onText?.('Legacy partial');
          await gate.promise;
          return { text: 'Late answer', usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null } };
        },
      },
    });
    const view = await chat.ask(p.paperKey, { question: 'Why?', modelId: 'model' });
    expect(view.answering).toBe(true);
    expect(store.getConversation(p.paperKey)?.messages).toHaveLength(1);
    expect(store.listHistory(p.paperKey)[0]).toMatchObject({ status: 'running', text: 'Legacy partial' });
    chat.clear(p.paperKey);
    expect(store.getConversation(p.paperKey)).toBeNull();
    expect(store.listHistory(p.paperKey)[0]).toMatchObject({ status: 'canceled', text: 'Legacy partial' });
    expect(store.listHistory(p.paperKey)[0]?.conversation?.messages.at(-1)?.status).toBe('canceled');
    gate.resolve();
    await new Promise((done) => setImmediate(done));
    expect(store.getConversation(p.paperKey)).toBeNull();
    store.saveConversation(p.paperKey, { conversationId: 'interrupted', messages: [messages()[0]!] });
    const root = store.root;
    close(store);
    const reopened = open(root);
    expect(reopened.listHistory(p.paperKey).find((h) => h.conversation?.conversationId === 'interrupted')?.status).toBe('failed');
    const recovered = new ChatService({
      store: reopened,
      connection: async () => {
        throw new Error('not used');
      },
      chat: {
        forget: async () => {},
        ask: async () => {
          throw new Error('not used');
        },
      },
    });
    expect(recovered.recoverInterrupted()).toEqual([p.paperKey]);
    expect(reopened.getConversation(p.paperKey)?.messages.at(-1)?.status).toBe('failed');
    expect(recovered.recoverInterrupted()).toEqual([]);
  });
});
