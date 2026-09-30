import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { originalPointToRendered, type OriginalProvenance, type Translator, type Annotation } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import { ProviderRegistry } from '../ai/registry';
import { FtsLibrarySearch } from '../ai/library-search';
import { JobManager } from '../jobs/state';
import { TranslationPipeline } from '../translation/index';
import { bookmark } from '../scholarly/bookmarks';
import { sha256 } from '../pdf/index';
import { TEXT_LAYOUT_VERSION } from '../pdf/text-layout';
import { createApiServer, TOKEN_HEADER } from './index';

const fixture = readFileSync(new URL('../../test/fixtures/text-layout.pdf', import.meta.url));
const roots: string[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function harness() {
  const root = mkdtempSync(join(tmpdir(), 'fractal-provenance-'));
  roots.push(root);
  let store = new SqlitePaperStore(root);
  const key = bookmark(store, { title: 'Reader fixture', authors: [], url: 'https://example.org/reader' }).paperKey;
  const prompts: { system: string; messages: { role: string; content: string }[] }[] = [];
  const registry = new ProviderRegistry(
    [
      {
        id: 'codex',
        status: async () => ({ id: 'codex', installed: true, loggedIn: true, version: 'test' }),
        listModels: async () => [{ id: 'model', label: 'Model' }],
        usage: async () => null,
        complete: async function* (input) {
          prompts.push({ system: input.system, messages: input.messages });
          yield { type: 'text', text: 'Fixture answer' };
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
  const start = async () => {
    const jobs = new JobManager(store);
    const server = createApiServer({
      store,
      jobs,
      translator,
      pipeline: new TranslationPipeline({ store, jobs, translator }),
      acquirer: {
        resolve: async () => {
          throw new Error('no remote acquisition');
        },
        acquire: async () => {
          throw new Error('no remote acquisition');
        },
        reextract: async () => {
          throw new Error('unused');
        },
      },
      paperChat: {
        forget: async () => {},
        ask: async () => {
          throw new Error('unused');
        },
      },
      aiRegistry: registry,
      librarySearch: new FtsLibrarySearch(store),
    });
    // This suite exercises actual transport, PDF extraction and persistence; unrelated background structure detection is excluded.
    store.onBlocksSaved = undefined;
    const { port } = await server.listen(0);
    return { server, base: `http://127.0.0.1:${port}` };
  };
  let active = await start();
  cleanup.push(async () => {
    await active.server.close();
    store.db.close();
  });
  const post = (path: string, value: unknown, headers: Record<string, string> = {}) =>
    fetch(active.base + path, {
      method: 'POST',
      headers: { origin: active.base, [TOKEN_HEADER]: active.server.token, 'content-type': 'application/json', ...headers },
      body: Buffer.isBuffer(value) ? new Uint8Array(value) : JSON.stringify(value),
    });
  const get = (path: string) => fetch(active.base + path);
  const link = (bytes: Buffer = fixture) => post(`/api/library/${key}/pdf`, bytes, { 'content-type': 'application/pdf' });
  const ask = async (value: unknown) => {
    const response = await post(`/api/papers/${key}/ask`, value);
    const text = await response.text();
    return { response, text };
  };
  return {
    get store() {
      return store;
    },
    key,
    post,
    get,
    link,
    ask,
    prompts,
    async restart() {
      await active.server.close();
      store.db.close();
      store = new SqlitePaperStore(root);
      active = await start();
    },
    get base() {
      return active.base;
    },
    get token() {
      return active.server.token;
    },
  };
}
const rect = { x: 0.2, y: 0.3, width: 0.1, height: 0.05 };
const date = '2026-01-01T00:00:00.000Z';

describe('actual HTTP original provenance and reader prerequisites', () => {
  it('admits exact authorized local binary PDF linking while retaining all guards', async () => {
    const h = await harness();
    for (const headers of [{ [TOKEN_HEADER]: '' }, { [TOKEN_HEADER]: 'stale' }, { origin: '' }, { origin: 'https://evil.example' }] as Record<
      string,
      string
    >[]) {
      const response = await h.post(`/api/library/${h.key}/pdf`, fixture, { 'content-type': 'application/pdf', ...headers });
      expect(response.status).toBe(403);
      expect(h.store.getPdf(h.key)).toBeNull();
    }
    expect((await h.post(`/api/library/${h.key}/pdf`, fixture, { 'content-type': 'application/pdf', authorization: `Bearer ${'a'.repeat(64)}` })).status).toBe(
      401,
    );
    expect((await h.post(`/api/library/${h.key}/metadata`, fixture, { 'content-type': 'application/pdf' })).status).toBe(415);
    expect((await h.post(`/api/library/${h.key}/pdf/extra`, fixture, { 'content-type': 'application/pdf' })).status).toBe(415);
    const response = await h.link();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { hasPdf: true, paper: { pageCount: 5, pdfSha256: sha256(fixture) } } });
    expect(h.store.getPdf(h.key)).toEqual(fixture);
  });

  it('rejects impossible ask/explain pages before history or provider calls and leaves unknown counts honest', async () => {
    const h = await harness();
    await h.link();
    for (const [path, value] of [
      ['ask', { question: 'Outside?', page: 6, requestId: 'bad-ask' }],
      ['explain', { kind: 'equation', page: 6, bbox: rect, requestId: 'bad-explain' }],
    ] as const) {
      const response = await h.post(`/api/papers/${h.key}/${path}`, value);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_INPUT', retryable: false, details: { reason: 'page_out_of_range', page: 6, pageCount: 5 } },
      });
    }
    expect((await h.ask({ question: 'Zero?', page: 0 })).response.status).toBe(400);
    expect(h.store.listHistory(h.key)).toHaveLength(0);
    expect(h.prompts).toHaveLength(0);
    h.store.savePaper({ ...h.store.getPaper(h.key)!, pageCount: null, status: 'extracting', coverage: null });
    expect((await h.ask({ question: 'Unverified page', page: 6, requestId: 'unknown' })).response.status).toBe(200);
    expect(h.store.listHistory(h.key)[0]).toMatchObject({ context: { page: 6 }, answer: { contextSourceStatus: 'unknown', citations: [{ page: 6 }] } });
    expect(h.store.listHistory(h.key)[0].answer!.citations![0]).not.toHaveProperty('region');
    const knownDuringLayout = await h.ask({
      question: 'Impossible extraction page',
      page: 6,
      provenance: {
        pdfSha256: sha256(fixture),
        textSource: 'original',
        layoutRange: { page: 6, extractionVersion: TEXT_LAYOUT_VERSION, start: 0, end: 1 },
      },
    });
    expect(knownDuringLayout.response.status).toBe(400);
    expect(JSON.parse(knownDuringLayout.text)).toMatchObject({ error: { details: { reason: 'page_out_of_range', page: 6, pageCount: 5 } } });
    expect(h.store.listHistory(h.key)).toHaveLength(1);
  });

  it('persists truthful layout context, citations and answer language across reopen/restart/replay', async () => {
    const h = await harness();
    await h.link();
    const layout = (await (await h.get(`/api/papers/${h.key}/text-layout?page=2`)).json()).data;
    const provenance: OriginalProvenance = {
      coordinateSpace: 'rendered-page-normalized-v1',
      pdfSha256: layout.pdfSha256,
      textSource: 'original',
      layoutRange: { page: 2, extractionVersion: layout.extractionVersion, start: 17, end: 20 },
    };
    const beforePrefs = h.store.getPreferences();
    const request = { question: 'Why?', page: 2, rect, selectedText: 'iii', provenance, answerLanguage: 'ja', requestId: 'new' };
    const first = await h.ask(request);
    expect(first.response.status).toBe(200);
    expect(first.text).toContain('event: done');
    const entry = h.store.listHistory(h.key)[0];
    expect(entry.context).toMatchObject({ rect, provenance, answerLanguage: 'ja' });
    expect(entry.answer).toMatchObject({
      contextSourceStatus: 'current',
      citations: [
        {
          paperKey: h.key,
          page: 2,
          region: {
            provenance: {
              coordinateSpace: 'unrotated-crop-normalized-v1',
              pdfSha256: sha256(fixture),
              layoutRange: provenance.layoutRange,
              textSource: 'original',
            },
          },
        },
      ],
    });
    expect(entry.answer!.citations![0].region!.provenance).not.toHaveProperty('blockExtractionVersion');
    expect(h.prompts[0].system).toContain('Answer in ja.');
    expect(h.store.getPreferences()).toEqual(beforePrefs);
    await h.restart();
    expect((await (await h.get(`/api/papers/${h.key}/history/${entry.id}`)).json()).data.history).toEqual(entry);
    expect((await (await h.get('/api/sync/pull?since=0')).json()).data.history).toContainEqual(entry);
    const calls = h.prompts.length;
    expect((await h.ask(request)).text).toContain('contextSourceStatus');
    expect(h.prompts).toHaveLength(calls);
    expect((await h.ask({ ...request, answerLanguage: 'en' })).response.status).toBe(400);
    expect((await h.ask({ ...request, provenance: { ...provenance, coordinateSpace: 'unrotated-crop-normalized-v1' } })).response.status).toBe(400);
    const explain = await h.post(`/api/papers/${h.key}/explain`, {
      kind: 'text',
      page: 2,
      bbox: rect,
      surroundingText: 'Translated quotation',
      provenance: { coordinateSpace: 'rendered-page-normalized-v1', textSource: 'translated', pdfSha256: sha256(fixture) },
      answerLanguage: 'en',
      requestId: 'explain-language',
    });
    expect(await explain.text()).toContain('event: done');
    expect(h.prompts.at(-1)!.system).toContain('Explain concisely in en.');
    expect(h.prompts.at(-1)!.messages[0].content).toContain('Context text source: translated');
    expect(h.store.listHistory(h.key).find((e) => e.kind === 'explanation')!.context).toMatchObject({
      answerLanguage: 'en',
      provenance: { textSource: 'translated' },
    });
    const changedLanguage = await h.post(`/api/papers/${h.key}/explain`, {
      kind: 'text',
      page: 2,
      bbox: rect,
      surroundingText: 'Translated quotation',
      provenance: { coordinateSpace: 'rendered-page-normalized-v1', textSource: 'translated', pdfSha256: sha256(fixture) },
      answerLanguage: 'fr',
      requestId: 'explain-language',
    });
    expect(changedLanguage.status).toBe(400);
    h.store.putPreferences({ ...beforePrefs, answerLanguage: 'de' });
    expect((await h.ask({ question: 'Global language?', page: 1, requestId: 'global' })).response.status).toBe(200);
    expect(h.prompts.at(-1)!.system).toContain('Answer in de.');
    const globalCalls = h.prompts.length;
    h.store.putPreferences({ ...beforePrefs, answerLanguage: 'es' });
    expect((await h.ask({ question: 'Global language?', page: 1, requestId: 'global' })).response.status).toBe(200);
    expect(h.prompts).toHaveLength(globalCalls); // replay is the original completed answer, independent of later global preferences
  });

  it('keeps figure/later-paragraph citations page-only when passage linkage is unestablished', async () => {
    const h = await harness();
    await h.link();
    const provenance: OriginalProvenance = { coordinateSpace: 'rendered-page-normalized-v1', pdfSha256: sha256(fixture), textSource: 'original' };
    expect(h.store.listBlocks(h.key).filter((b) => b.regions.some((r) => r.page === 1)).length).toBeGreaterThan(1);
    await h.ask({ question: 'Explain later right-column paragraph', page: 1, rect, selectedText: 'Right 3 beta prose words', provenance, requestId: 'later' });
    const explanation = await h.post(`/api/papers/${h.key}/explain`, { kind: 'figure', page: 1, bbox: rect, provenance, requestId: 'figure' });
    expect(await explanation.text()).toContain('event: done');
    for (const entry of h.store.listHistory(h.key)) expect(entry.answer!.citations).toEqual([{ paperKey: h.key, page: 1 }]);
  });

  it('retains stale context/notes and rejects invalid legal boundaries without silently grounding them', async () => {
    const h = await harness();
    await h.link();
    const base: OriginalProvenance = {
      coordinateSpace: 'unrotated-crop-normalized-v1',
      pdfSha256: sha256(fixture),
      textSource: 'original',
      layoutRange: { page: 5, extractionVersion: TEXT_LAYOUT_VERSION, start: 16, end: 18 },
    };
    const cases: [OriginalProvenance, string][] = [
      [{ ...base, pdfSha256: 'b'.repeat(64) }, 'pdf_changed'],
      [{ ...base, layoutRange: { ...base.layoutRange!, extractionVersion: 'pdfjs6-lines-v4' } }, 'layout_changed'],
      [{ ...base, layoutRange: { ...base.layoutRange!, start: 17 } }, 'range_invalid'],
      [base, 'current'],
    ];
    for (const [provenance, status] of cases) {
      const requestId = status;
      expect((await h.ask({ question: 'Keep draft', page: 5, rect, selectedText: 'fi', provenance, requestId })).response.status).toBe(200);
      const entry = h.store.listHistory(h.key).find((e) => e.requestId === requestId)!;
      expect(entry.context).toMatchObject({ rect, selectedText: 'fi', provenance });
      expect(entry.answer!.contextSourceStatus).toBe(status);
      if (status !== 'current') expect(h.prompts.at(-1)!.messages[0].content).not.toContain('Selected box:');
    }
    const annotation: Annotation = {
      kind: 'memo',
      id: randomUUID(),
      paperKey: h.key,
      page: 5,
      text: 'Keep stale note',
      rect,
      quote: 'fi',
      rev: 0,
      deviceId: 'android',
      updatedAt: date,
      deleted: false,
      provenance: cases[0][0],
    };
    expect((await h.post('/api/sync/push', { annotations: [annotation] })).status).toBe(200);
    expect(h.store.getAnnotation(annotation.id)).toMatchObject({ text: annotation.text, rect, provenance: annotation.provenance });
    await h.restart();
    expect(h.store.listHistory(h.key).find((e) => e.requestId === 'pdf_changed')!.answer!.contextSourceStatus).toBe('pdf_changed');
    const replaced = Buffer.concat([fixture, Buffer.from('\n% a different immutable PDF identity\n')]);
    h.store.savePdf(h.key, replaced);
    await h.ask({ question: 'Retain old source after replacement', page: 5, rect, selectedText: 'fi', provenance: base, requestId: 'replacement' });
    expect(h.store.listHistory(h.key).find((e) => e.requestId === 'replacement')!).toMatchObject({
      context: { provenance: base, rect },
      answer: { contextSourceStatus: 'pdf_changed' },
    });
    const freshLayout = (await (await h.get(`/api/papers/${h.key}/text-layout?page=5`)).json()).data;
    expect(freshLayout.pdfSha256).toBe(sha256(replaced));
    expect(freshLayout.pdfSha256).not.toBe(base.pdfSha256);
    h.store.db.prepare('UPDATE papers SET pdf_hash=NULL WHERE paper_key=?').run(h.key);
    await h.ask({ question: 'Keep note without local PDF', page: 5, rect, selectedText: 'fi', provenance: base, requestId: 'unavailable' });
    expect(h.store.listHistory(h.key).find((e) => e.requestId === 'unavailable')!).toMatchObject({
      context: { provenance: base, rect, selectedText: 'fi' },
      answer: { contextSourceStatus: 'unavailable' },
    });
  });

  it('preserves raw historical JSON, placement and sync retry/CAS while round-tripping new highlights', async () => {
    const h = await harness();
    await h.link();
    const old: Annotation = {
      kind: 'memo',
      id: randomUUID(),
      paperKey: h.key,
      page: 2,
      text: 'Legacy',
      rect: {
        x: 0.88415625,
        y: 0.41452,
        width: 0.02890625,
        height: 0.02664,
      },
      quote: 'iii',
      rev: 7,
      deviceId: 'android',
      updatedAt: date,
      deleted: false,
    };
    const raw = JSON.stringify(old, null, 2);
    h.store.db.prepare('INSERT INTO annotations VALUES(?,?,?)').run(old.id, h.key, raw);
    const oldHistory = {
      id: randomUUID(),
      paperKey: h.key,
      kind: 'question',
      question: 'Historical question',
      text: 'Historical answer',
      status: 'completed',
      createdAt: date,
      updatedAt: date,
      completedAt: date,
      requestId: null,
      context: { page: 2, rect: old.rect, selectedText: 'iii' },
      answer: null,
      error: null,
      rev: 4,
      deviceId: 'android',
      deleted: false,
    };
    const historyRaw = JSON.stringify(oldHistory, null, 2);
    h.store.db.prepare('INSERT INTO history VALUES(?,?,?,?)').run(oldHistory.id, h.key, null, historyRaw);
    const response = await h.post('/api/sync/push', { annotations: [old] });
    expect(await response.json()).toMatchObject({ data: { results: [{ id: old.id, applied: false, rev: 7 }] } });
    expect(h.store.db.prepare('SELECT data FROM annotations WHERE id=?').get(old.id)).toEqual({ data: raw });
    expect((await (await h.get(`/api/papers/${h.key}/annotations`)).json()).data).toContainEqual(old);
    await h.restart();
    expect(h.store.db.prepare('SELECT data FROM annotations WHERE id=?').get(old.id)).toEqual({ data: raw });
    expect(h.store.db.prepare('SELECT data FROM history WHERE id=?').get(oldHistory.id)).toEqual({ data: historyRaw });
    expect((await (await h.get(`/api/papers/${h.key}/history/${oldHistory.id}`)).json()).data.history).toEqual(oldHistory);
    const provenance: OriginalProvenance = { coordinateSpace: 'rendered-page-normalized-v1', textSource: 'original', pdfSha256: sha256(fixture) };
    const created = await h.post(`/api/papers/${h.key}/highlights`, { page: 2, rects: [{ page: 2, ...rect }], text: 'iii', provenance });
    expect(created.status).toBe(201);
    const highlight = (await created.json()).data;
    expect(highlight.provenance).toEqual(provenance);
    expect(h.store.listAnnotations(h.key).find((a) => a.id === highlight.highlightId)).toMatchObject({ provenance, rects: [rect] });
    const newer = { ...old, text: 'Offline edit', updatedAt: '2026-01-02T00:00:00.000Z', rev: 0 };
    const pushed = await h.post('/api/sync/push', { annotations: [newer] });
    expect(await pushed.json()).toMatchObject({ data: { results: [{ applied: true, rev: 8 }] } });
    expect(await (await h.post('/api/sync/push', { annotations: [newer] })).json()).toMatchObject({ data: { results: [{ applied: false, rev: 8 }] } });
    expect(h.store.getAnnotation(old.id)).not.toHaveProperty('provenance');
  });
});

/** Small real cropped PDF; xref offsets are regenerated for each intrinsic rotation. */
function rotatedPdf(rotation: number): Buffer {
  const stream = 'BT /F1 20 Tf 100 400 Td (WWW iii) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [60 80 560 720] /Rotate ${rotation} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((v) => `${String(v).padStart(10, '0')} 00000 n `)
    .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
describe('actual cropped PDF HTTP coordinate frames', () => {
  it.each([0, 90, 180, 270] as const)('matches PDF.js viewport with exactly one intrinsic rotation (%i)', async (rotation) => {
    const h = await harness();
    const bytes = rotatedPdf(rotation);
    expect((await h.link(bytes)).status).toBe(201);
    const layout = (await (await h.get(`/api/papers/${h.key}/text-layout?page=1`)).json()).data;
    expect(layout.page.rotation).toBe(rotation);
    expect(layout.page.cropBox).toEqual([60, 80, 560, 720]);
    const unrotated: [number, number] = layout.page.runs[0].units[0].quad[0];
    const provenance: OriginalProvenance = {
      coordinateSpace: 'unrotated-crop-normalized-v1',
      textSource: 'original',
      pdfSha256: layout.pdfSha256,
      layoutRange: { page: 1, extractionVersion: layout.extractionVersion, start: layout.page.runs[0].units[0].start, end: layout.page.runs[0].units[0].end },
    };
    const rendered = originalPointToRendered(unrotated, provenance, rotation);
    const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const doc = await loading.promise;
    try {
      const page = await doc.getPage(1),
        viewport = page.getViewport({ scale: 1 });
      const expected = viewport.convertToViewportPoint(60 + unrotated[0] * 500, 720 - unrotated[1] * 640);
      expect(rendered[0]).toBeCloseTo(expected[0] / viewport.width, 10);
      expect(rendered[1]).toBeCloseTo(expected[1] / viewport.height, 10);
    } finally {
      await loading.destroy();
    }
    const request = { question: 'Geometry?', page: 1, rect, provenance, requestId: 'rotation' };
    expect((await h.ask(request)).response.status).toBe(200);
    expect(h.store.listHistory(h.key)[0].context.provenance).toEqual(provenance);
    expect(h.store.listHistory(h.key)[0].answer!.citations![0].region!.provenance!.coordinateSpace).toBe('unrotated-crop-normalized-v1');
    // An already rendered point, and an untagged historical point, never get rotated again.
    expect(originalPointToRendered(rendered, { coordinateSpace: 'rendered-page-normalized-v1' }, rotation)).toEqual(rendered);
    expect(originalPointToRendered(rendered, undefined, rotation)).toEqual(rendered);
  });
});
