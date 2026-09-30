import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Paper, PdfTextPage } from '@fractal/shared';
import { pdfTextLayoutSchema } from '@fractal/shared';
import { extractTextPage, positionTextPage, TEXT_LAYOUT_VERSION, unavailable } from './text-layout';
import { PdfTextLayoutService } from './text-layout-service';
import { sha256 } from './index';
import { SqlitePaperStore } from '../store/sqlite';
import { handlePdfText } from '../api/routes/pdf-text';
import { createApiServer, type ApiServerOptions } from '../api/index';
import { JobManager } from '../jobs/state';
import { TranslationPipeline } from '../translation/index';

const pdf = readFileSync(new URL('../../test/fixtures/text-layout.pdf', import.meta.url));
const roots: string[] = [],
  stores: SqlitePaperStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.db.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function open(root?: string) {
  if (!root) {
    root = mkdtempSync(join(tmpdir(), 'fractal-text-'));
    roots.push(root);
  }
  const s = new SqlitePaperStore(root);
  stores.push(s);
  return s;
}
function paper(key = '2401.00001v1'): Paper {
  return {
    paperKey: key,
    sourceKind: 'arxiv',
    arxivId: '2401.00001',
    version: 1,
    title: 'Geometry',
    authors: [],
    sourceUrl: 'https://arxiv.org/abs/2401.00001v1',
    pdfSha256: sha256(pdf),
    pageCount: 5,
    extractionVersion: 'old',
    status: 'ready',
    coverage: { totalPages: 5, textPages: 4, unsupportedPages: [4] },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
async function page(n: number): Promise<PdfTextPage> {
  const r = await extractTextPage(pdf, n);
  expect(r).not.toHaveProperty('status');
  if ('status' in r) throw new Error(r.message);
  return r.page;
}

describe('original PDF text-position extraction', () => {
  it('uses proportional operator advances, exposes real word boundaries and orders columns', async () => {
    const p = await page(1),
      run = p.runs[0];
    expect(p.text.indexOf('Left 3')).toBeLessThan(p.text.indexOf('Right 1'));
    expect(run.granularity).toBe('glyph-advance');
    const width = (i: number) => run.units[i].quad![2][0] - run.units[i].quad![1][0];
    expect(width(0) / width(4)).toBeCloseTo(944 / 222, 3); // Helvetica W versus i, not equal splitting
    expect(run.words.map((w) => p.text.slice(w.start, w.end))).toEqual(['WWW', 'iii', 'wide', 'thin']);
    expect(run.confidence).toBe('approximate');
    expect(run.words.every((w) => p.boundaries.includes(w.start) && p.boundaries.includes(w.end))).toBe(true);
  });
  it('retains ligature Unicode and protects multi-character glyphs, graphemes and surrogate pairs', async () => {
    const p = await page(5);
    expect(p.text).toContain('café e\u0301 fi \ufb02');
    expect(p.text).toContain('😀');
    for (const [text, unsafe] of [
      ['e\u0301', 1],
      ['fi', 1],
      ['😀', 1],
    ] as const) {
      const offset = p.text.indexOf(text);
      expect(p.boundaries).toContain(offset);
      expect(p.boundaries).toContain(offset + text.length);
      expect(p.boundaries).not.toContain(offset + unsafe);
      expect(p.runs.flatMap((r) => r.units).some((u) => u.start === offset && u.end === offset + text.length)).toBe(true);
    }
    const rtl = p.runs.find((r) => r.direction === 'rtl')!;
    const ordinary = p.text.indexOf('ordinary fi') + 'ordinary '.length;
    expect(p.boundaries).toContain(ordinary + 1); // same font emitted f+i, not a ligature
    expect(p.runs.flatMap((r) => r.units).some((u) => u.start === ordinary && u.end === ordinary + 1)).toBe(true);
    expect(rtl.granularity).toBe('run');
    expect(rtl.units).toHaveLength(1);
    expect(p.coverage).toBe('partial');
    expect(p.issues).toContain('run_boundary_fallback');
  });
  it('preserves crop origins, intrinsic rotation and arbitrarily rotated run polygons', async () => {
    const p = await page(2);
    expect(p.cropBox).toEqual([60, 80, 560, 720]);
    expect(p.width).toBe(500);
    expect(p.height).toBe(640);
    expect(p.rotation).toBe(90);
    expect(p.runs[0].quad![0][0]).toBeCloseTo((85 - 60) / 500, 8);
    expect(p.runs[0].quad![1][1]).toBeCloseTo((720 - 650 - 20 * 0.718) / 640, 6);
    const angled = await page(3),
      q = angled.runs[0].quad!;
    expect(angled.cropBox).toEqual([30, 40, 550, 730]);
    expect(Math.abs(q[2][1] - q[1][1])).toBeGreaterThan(0.05);
    expect(angled.runs[0].words.map((w) => angled.text.slice(w.start, w.end))).toEqual(['Angled', 'WWW', 'iii']);
  });
  it('reports raster/no-text honestly and actionable decode/page/size/time limits', async () => {
    const p = await page(4);
    expect(p.coverage).toBe('no_text');
    expect(p.text).toBe('');
    expect(p.runs).toEqual([]);
    expect(p.boundaries).toEqual([0]);
    expect(p.issues).toContain('no_text_no_ocr');
    expect(await extractTextPage(pdf, 6)).toMatchObject({ status: 'unavailable', reason: 'page_out_of_range', pageCount: 5 });
    expect(await extractTextPage(Buffer.from('not a PDF'), 1)).toMatchObject({ status: 'unavailable', reason: 'invalid_pdf' });
    expect(await extractTextPage(new Uint8Array(), 1)).toMatchObject({ reason: 'invalid_pdf' });
    expect(await extractTextPage(new Uint8Array(50 * 1024 * 1024 + 1), 1)).toMatchObject({ reason: 'too_large' });
    expect(await extractTextPage(pdf, 1, 0)).toMatchObject({ reason: 'timeout', retryable: true });
  });
  it('retains original text and readable neighbours when one run lacks its style or transform', () => {
    const good = { str: 'Readable', dir: 'ltr', width: 40, height: 12, transform: [12, 0, 0, 12, 30, 100], fontName: 'font' };
    const p = positionTextPage(
      [good, { ...good, str: 'Missing style', fontName: 'missing' }, { ...good, str: 'Broken transform', transform: undefined as unknown as number[] }],
      { font: { ascent: 0.8, descent: -0.2 } },
      [0, 0, 200, 200],
      1,
      0,
      1,
    );
    expect(p.text).toContain('Readable');
    expect(p.text).toContain('Broken transform');
    expect(p.coverage).toBe('partial');
    expect(p.issues).toEqual(expect.arrayContaining(['missing_font_style', 'unsupported_geometry', 'run_boundary_fallback']));
    expect(p.runs.find((r) => p.text.slice(r.start, r.end) === 'Readable')?.quad).not.toBeNull();
    expect(p.runs.find((r) => p.text.slice(r.start, r.end) === 'Broken transform')).toMatchObject({
      quad: null,
      confidence: 'unsupported',
      granularity: 'run',
    });
    expect(
      pdfTextLayoutSchema.safeParse({
        status: 'ready',
        paperKey: 'fixture',
        pdfSha256: sha256(pdf),
        extractionVersion: TEXT_LAYOUT_VERSION,
        pageCount: 1,
        page: p,
      }).success,
    ).toBe(true);
  });
});

describe('persistent text-position page cache and route', () => {
  it('purges source-text cache only after the last PDF alias is deleted and prevents in-flight orphan reinsertion', async () => {
    const s = open(),
      first = paper(),
      alias = { ...paper('2401.00002v1'), arxivId: '2401.00002' };
    s.savePaper(first, pdf);
    s.savePaper(alias, pdf);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const service = new PdfTextLayoutService(s, async (bytes, n) => {
      if (n === 2) await gate;
      return extractTextPage(bytes, n);
    });
    await service.read(first.paperKey, 1);
    const count = () => s.db.prepare('SELECT count(*) n FROM pdf_text_pages').get();
    expect(count()).toMatchObject({ n: 1 });
    s.putFolder({ id: 'folder', name: 'Folder', parentId: null });
    s.patchLibrary(first.paperKey, { saved: true, collections: ['folder'] });
    s.patchLibrary(first.paperKey, { saved: false });
    s.deleteFolder('folder');
    expect(count()).toMatchObject({ n: 1 });
    s.deletePaper(first.paperKey);
    expect(count()).toMatchObject({ n: 1 });
    expect(s.getPdf(alias.paperKey)).toEqual(pdf);
    const inFlight = service.read(alias.paperKey, 2);
    s.deletePaper(alias.paperKey);
    expect(count()).toMatchObject({ n: 0 });
    expect(s.getPdf(alias.paperKey)).toBeNull();
    release();
    await inFlight;
    expect(count()).toMatchObject({ n: 0 });
    await service.close();
  });
  it('shares identical PDF work across paper keys while isolating an in-flight PDF replacement', async () => {
    const s = open(),
      first = paper(),
      alias = { ...paper('2401.00002v1'), arxivId: '2401.00002' };
    s.savePaper(first, pdf);
    s.savePaper(alias, pdf);
    const base = await extractTextPage(pdf, 1),
      releases: (() => void)[] = [];
    const extract = vi.fn(async () => {
      await new Promise<void>((r) => releases.push(r));
      return base;
    });
    const service = new PdfTextLayoutService(s, extract);
    const old = service.read(first.paperKey, 1),
      same = service.read(alias.paperKey, 1);
    const changed = Buffer.concat([pdf, Buffer.from('\n% replacement\n')]);
    s.savePdf(first.paperKey, changed);
    const fresh = service.read(first.paperKey, 1);
    expect(extract).toHaveBeenCalledTimes(2);
    releases.splice(0).forEach((r) => r());
    const [a, b, c] = await Promise.all([old, same, fresh]);
    expect(a).toMatchObject({ paperKey: first.paperKey, pdfSha256: sha256(pdf) });
    expect(b).toMatchObject({ paperKey: alias.paperKey, pdfSha256: sha256(pdf) });
    expect(c).toMatchObject({ paperKey: first.paperKey, pdfSha256: sha256(changed) });
    expect(await service.read(first.paperKey, 1)).toEqual(c);
    expect(await service.read(alias.paperKey, 1)).toEqual(b);
    expect(extract).toHaveBeenCalledTimes(2);
    await service.close();
  });
  it('serves the concrete HTTP data envelope and original Unicode without changing the old snapshot', async () => {
    const store = open();
    store.savePaper(paper(), pdf);
    const jobs = new JobManager(store),
      translator = {
        connection: async () => ({ status: 'signed_out', modelIds: [], defaultModelId: null, limits: null }),
        disconnect: async () => {},
      } as unknown as ApiServerOptions['translator'];
    const server = createApiServer({
      store,
      jobs,
      translator,
      pipeline: new TranslationPipeline({ store, jobs, translator }),
      paperChat: {
        ask: async () => {
          throw new Error('unused');
        },
        forget: async () => {},
      },
      acquirer: {} as ApiServerOptions['acquirer'],
    });
    const address = await server.listen(0),
      url = `http://127.0.0.1:${address.port}/api/papers/${paper().paperKey}`;
    try {
      const before = await (await fetch(url)).json();
      const response = await fetch(`${url}/text-layout?page=5`);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(Object.keys(result)).toEqual(['data']);
      expect(pdfTextLayoutSchema.safeParse(result.data).success).toBe(true);
      expect(result.data.page.text).toContain('café e\u0301 fi \ufb02');
      expect(result.data.page.text).toContain('😀');
      const again = await fetch(`${url}/text-layout?page=5`);
      expect(await again.json()).toEqual(result);
      expect(await (await fetch(url)).json()).toEqual(before);
      const bad = await fetch(`${url}/text-layout?page=0`);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    } finally {
      await server.close();
    }
  });
  it('deduplicates simultaneous requests, persists restart/offline results, validates hash/version and corrupt cache', async () => {
    const s = open();
    s.savePaper(paper(), pdf);
    const root = s.root;
    const extract = vi.fn(extractTextPage),
      service = new PdfTextLayoutService(s, extract);
    const [a, b] = await Promise.all([service.read(paper().paperKey, 1), service.read(paper().paperKey, 1)]);
    expect(a).toEqual(b);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(pdfTextLayoutSchema.safeParse(a).success).toBe(true);
    await service.close();
    s.db.close();
    stores.splice(stores.indexOf(s), 1);
    const reopened = open(root),
      offline = vi.fn(extractTextPage),
      next = new PdfTextLayoutService(reopened, offline);
    expect(await next.read(paper().paperKey, 1)).toEqual(a);
    expect(offline).not.toHaveBeenCalled();
    reopened.db.prepare('UPDATE pdf_text_pages SET version=?').run('old-version');
    await next.read(paper().paperKey, 1);
    expect(offline).toHaveBeenCalledTimes(1);
    const different = Buffer.concat([pdf, Buffer.from('\n% changed immutable bytes\n')]);
    reopened.savePdf(paper().paperKey, different);
    const changed = await next.read(paper().paperKey, 1);
    expect(changed).toMatchObject({ pdfSha256: sha256(different) });
    expect(offline).toHaveBeenCalledTimes(2);
    reopened.db.prepare('UPDATE pdf_text_pages SET data=? WHERE pdf_hash=? AND version=?').run('bad JSON', sha256(different), TEXT_LAYOUT_VERSION);
    await next.read(paper().paperKey, 1);
    expect(offline).toHaveBeenCalledTimes(3);
    await next.close();
  });
  it('never acquires a metadata-only PDF and retries transient extraction failures', async () => {
    const s = open();
    s.savePaper({ ...paper(), status: 'fetching', pdfSha256: null });
    const metadata = s.publishMetadata({
      ...s.getLibrary(paper().paperKey)!,
      id: '8bfc1cec-ed41-4ffe-a247-3261462bbccc',
      paperKey: 'metadata-only',
      doi: null,
      arxivId: null,
      bibtexKey: 'metadata-only',
    });
    const extract = vi.fn(extractTextPage),
      service = new PdfTextLayoutService(s, extract);
    expect(await service.read(paper().paperKey, 1)).toMatchObject({ status: 'unavailable', reason: 'no_pdf', retryable: false });
    expect(extract).not.toHaveBeenCalled();
    expect(await service.read(metadata.paperKey, 1)).toMatchObject({ status: 'unavailable', reason: 'no_pdf' });
    s.savePdf(paper().paperKey, pdf);
    const fail = vi.fn(async () => unavailable('', 'timeout', 'Retry') as Extract<Awaited<ReturnType<typeof extractTextPage>>, { status: 'unavailable' }>);
    const retry = new PdfTextLayoutService(s, fail);
    await retry.read(paper().paperKey, 1);
    await retry.read(paper().paperKey, 1);
    expect(fail).toHaveBeenCalledTimes(2);
    expect(s.db.prepare('SELECT count(*) n FROM pdf_text_pages').get()).toMatchObject({ n: 0 });
  });
  it('bounds concurrent extraction, queues four pages, deduplicates while full and drains shutdown', async () => {
    const s = open();
    s.savePaper(paper(), pdf);
    const base = await extractTextPage(pdf, 1);
    let active = 0,
      max = 0;
    const releases: (() => void)[] = [];
    const extract = vi.fn(async (_bytes: Uint8Array, n: number) => {
      active++;
      max = Math.max(max, active);
      await new Promise<void>((r) => releases.push(r));
      active--;
      if ('status' in base) return base;
      return { ...base, page: { ...base.page, page: n } };
    });
    const service = new PdfTextLayoutService(s, extract),
      requests = Array.from({ length: 6 }, (_, i) => service.read(paper().paperKey, i + 1));
    const duplicate = service.read(paper().paperKey, 1);
    await expect(service.read(paper().paperKey, 7)).rejects.toMatchObject({ error: { code: 'BUSY', retryable: true } });
    expect(extract).toHaveBeenCalledTimes(2);
    const closed = service.close();
    for (let i = 0; i < 6; i++) {
      releases.shift()!();
      await new Promise((r) => setImmediate(r));
    }
    await Promise.all([...requests, duplicate, closed]);
    expect(max).toBe(2);
    expect(extract).toHaveBeenCalledTimes(6);
    await expect(service.read(paper().paperKey, 1)).rejects.toMatchObject({ error: { code: 'BUSY' } });
  });
  it('requires one physical-page query parameter and preserves existing API routes', async () => {
    const s = open();
    s.savePaper(paper(), pdf);
    const service = new PdfTextLayoutService(s);
    const route = (url: string, key = paper().paperKey) => handlePdfText('GET', ['api', 'papers', key, 'text-layout'], { url } as IncomingMessage, service);
    for (const suffix of ['', '?page=0', '?page=1.5', '?page=1&page=2', '?page=9007199254740992'])
      await expect(route('/?' + suffix.replace(/^\?/, ''))).rejects.toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(await route('/?page=1')).toMatchObject({ kind: 'json', status: 200, data: { status: 'ready', page: { page: 1 } } });
    expect(await route('/?page=6')).toMatchObject({ status: 200, data: { status: 'unavailable', reason: 'page_out_of_range' } });
    await expect(route('/?page=1', 'missing')).rejects.toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await handlePdfText('GET', ['api', 'papers', paper().paperKey, 'structure'], { url: '/?page=1' } as IncomingMessage, service)).toBeUndefined();
    await service.close();
  });
});
