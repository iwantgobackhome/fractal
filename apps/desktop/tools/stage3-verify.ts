/** Built product + actual isolated Hub/SQLite. Only outbound scholarly/news/AI provider boundaries are controlled. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { chromium, type Page } from 'playwright-core';
import { startService } from '../../../packages/hub/src/main';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import { ProviderRegistry } from '../../../packages/hub/src/ai/registry';
import type { AiProvider } from '../../../packages/hub/src/ai/provider';
import type { FeedResponse, HistoryEntry, Memo, ModelSelection } from '@fractal/shared';
const root = resolve(import.meta.dirname, '../../..'),
  output = join(root, 'docs/implementation/desktop/stage3');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'fractal-desktop-stage3-'));
process.env.NODE_ENV = 'test';
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
const pdf = await readFile(join(root, 'packages/hub/test/fixtures/text-layout.pdf'));
const sha = createHash('sha256').update(pdf).digest('hex');
const title = 'Character-accurate research reading across proportional typography, multiple columns, physical pages and durable publication identities';
const korean = '학술 연구 자료의 실제 출판 정보와 원본 PDF를 보존하며 여러 열과 페이지를 정확히 읽고 질문과 메모를 이어 가는 긴 한국어 제목';
const work = (id: number, name: string, type = 'article') => ({
  id: `https://openalex.org/W${id}`,
  display_name: name,
  type,
  doi: `https://doi.org/10.1234/stage${id}`,
  publication_year: 2026,
  publication_date: '2026-09-25',
  primary_location: {
    source: {
      type: type === 'article' ? 'journal' : 'conference',
      display_name: type === 'article' ? 'Journal of Reading Studies' : 'Research Systems Conference',
    },
    landing_page_url: `https://example.org/stage3/${id}`,
  },
  open_access: { is_oa: false },
  authorships: [{ author: { display_name: 'Ada Lovelace' } }],
});
const works = [
  work(1, title),
  work(2, korean, 'conference-paper'),
  {
    ...work(3, 'Open preprint on the provenance of selected research passages', 'preprint'),
    primary_location: null,
    open_access: { is_oa: true },
    best_oa_location: { pdf_url: 'https://example.org/preprint.pdf', landing_page_url: 'https://example.org/preprint' },
  },
  {
    ...work(4, 'Publication with unknown kind, venue and availability', 'unclassified'),
    type: undefined,
    publication_year: null,
    publication_date: null,
    primary_location: null,
    open_access: undefined,
    authorships: [],
  },
];
const nativeFetch = globalThis.fetch,
  counts: Record<string, number> = {};
let relatedFailure = false;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
  const kind =
    url.hostname === 'api.semanticscholar.org'
      ? 'semantic'
      : url.hostname === 'api.openalex.org' && url.searchParams.has('select')
        ? 'relatedAlex'
        : url.hostname;
  counts[kind] = (counts[kind] ?? 0) + 1;
  if (kind === 'semantic') {
    if (relatedFailure) return new Response('', { status: 429, headers: { 'retry-after': '60' } });
    const item = {
      title: 'Provider-reported shared reference and similar work',
      authors: [{ name: 'Grace Hopper' }],
      year: 2025,
      venue: 'Actual reported venue',
      url: 'https://example.org/related',
      externalIds: { DOI: '10.1234/related' },
      citationCount: 18,
    };
    return Response.json(
      url.pathname.includes('recommendations')
        ? { recommendedPapers: [item] }
        : {
            paperId: 'a'.repeat(40),
            references: [item],
            citations: [{ ...item, title: 'Paper citing this publication', externalIds: { DOI: '10.1234/citing' }, url: 'https://example.org/citing' }],
          },
    );
  }
  if (kind === 'relatedAlex') {
    if (relatedFailure)
      return await new Promise<Response>((_done, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        else init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
    return Response.json(url.pathname.includes('/works/') ? { ...works[0], related_works: [], referenced_works: [] } : { results: [works[0]] });
  }
  if (url.hostname === 'api.openalex.org') return Response.json({ results: works });
  if (url.hostname === 'api.crossref.org')
    return Response.json({
      message: {
        items: [
          {
            title: [title],
            DOI: '10.1234/stage1',
            type: 'journal-article',
            'container-title': ['Journal of Reading Studies'],
            issued: { 'date-parts': [[2026, 9, 25]] },
            author: [{ given: 'Ada', family: 'Lovelace' }],
          },
        ],
      },
    });
  if (url.hostname === 'news.google.com')
    return new Response(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Controlled science feed</title><item><title>Researchers examine durable reading evidence</title><link>https://example.org/stage3-news</link><guid>https://example.org/stage3-news</guid><pubDate>Wed, 30 Sep 2026 08:00:00 GMT</pubDate><source>Research reporting</source><description>A reported reading study.</description></item></channel></rss>',
      { headers: { 'content-type': 'application/rss+xml' } },
    );
  if (url.hostname === 'translate.googleapis.com')
    return Response.json([[[`검증 번역: ${url.searchParams.get('q')}`, url.searchParams.get('q'), null, null]], null, 'en']);
  if (url.hostname === 'example.org' && url.pathname === '/stage3-news')
    return new Response(
      '<html lang="en"><head><title>Researchers examine durable reading evidence</title></head><body><main><article><h1>Researchers examine durable reading evidence</h1><p>Researchers studied how readers preserve context across publications, notes and questions. The original source remains independently readable when metadata is saved before a local PDF is associated. This fixture article tests actual extraction and rendering through the isolated Hub.</p><p>A second paragraph explains the experiment and keeps the publication evidence separate from machine translation.</p></article></main></body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
  if (url.hostname === 'example.org' && url.pathname.endsWith('.pdf')) return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
  throw new Error('Unconfigured external fixture endpoint ' + url.hostname);
};
const choice: ModelSelection = { provider: 'codex', model: 'stage3-fixture' };
const provider: AiProvider = {
  id: 'codex',
  async status() {
    return { id: 'codex', installed: true, loggedIn: true };
  },
  async listModels() {
    return [{ id: choice.model, label: 'Controlled verification model' }];
  },
  async usage() {
    return null;
  },
  async *complete() {
    yield { type: 'text', text: 'Controlled answer with retained source evidence. [p.1]' };
  },
};
const originals = {
  select: ProviderRegistry.prototype.select,
  complete: ProviderRegistry.prototype.complete,
  providersInfo: ProviderRegistry.prototype.providersInfo,
  getSettings: ProviderRegistry.prototype.getSettings,
};
ProviderRegistry.prototype.select = async () => ({ provider, selection: choice });
ProviderRegistry.prototype.complete = async function* (_feature, input) {
  for await (const event of provider.complete({ ...input, model: choice.model })) yield event;
};
ProviderRegistry.prototype.providersInfo = async () => [{ status: await provider.status(), models: await provider.listModels() }];
ProviderRegistry.prototype.getSettings = async () => ({ default: choice, overrides: {} });
let service = await startService({
  dataDirectory: directory,
  port: 0,
  indexHtml: join(root, 'packages/ui/dist/index.html'),
  startBackground: false,
  allowRealCli: false,
  fetcher: globalThis.fetch,
  log: () => {},
});
let store = service.store as SqlitePaperStore;
store.putPreferences({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const results: Record<string, unknown> = {
  isolation: 'Fresh temporary Hub database/profile; actual HTTP, SQLite, PDF.js; only provider endpoint responses controlled',
  screenshots: [],
  pdfSha256: sha,
};
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await nativeFetch(service.url + path, {
    method,
    headers: { origin: service.url, 'x-paperread-token': service.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value.data;
}
async function settle(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await page.waitForTimeout(100);
  }
  assert.ok(check(), 'Persistent state did not settle');
}
async function capture(name: string, target: Page = page) {
  await target.evaluate(() => document.fonts.ready);
  await target.screenshot({ path: join(output, name + '.png') });
  (results.screenshots as string[]).push(name + '.png');
}
async function discovery() {
  const url = service.url + '/#/home';
  if (page.url() === url) await page.reload();
  else await page.goto(url);
  await page.locator('.discovery-desk').waitFor();
  await page.getByRole('combobox', { name: 'Publication type', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.discovery-desk [aria-busy="true"]'));
}
async function choose(label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: false }).click();
}
async function charPoint(text: string, offset: number) {
  return page.evaluate(
    ({ text, offset }) => {
      const span = Array.from(document.querySelectorAll('[data-testid="text-layer-1"] span')).find((s) => s.textContent === text);
      if (!span?.firstChild) throw new Error('Actual rendered text missing');
      const range = document.createRange();
      range.setStart(span.firstChild, offset);
      range.setEnd(span.firstChild, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + 0.8, y: rect.y + rect.height / 2 };
    },
    { text, offset },
  );
}
async function select() {
  await page.getByRole('button', { name: 'T', exact: true }).click();
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  await page.waitForTimeout(350);
  const a = await charPoint('WWW iii wide thin', 1),
    b = await charPoint('WWW iii wide thin', 7);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), 'WW iii');
}
try {
  await api(
    '/api/feed/interests',
    { categories: ['cs.CL'], topics: [], authors: [], custom: [{ id: 'long-custom', label: korean, query: 'durable research reading' }] },
    'PUT',
  );
  const settings = await api('/api/feed/settings');
  await api(
    '/api/feed/settings',
    {
      ...settings,
      sources: { arxiv: false, huggingFace: false, news: true, recommendations: false, openAlex: true, crossref: true },
      translateNewsTitles: false,
    },
    'PUT',
  );
  const topic = await api('/api/feed/topics', { field: 'cs.CL', label: 'Durable reading evidence', query: 'durable research reading' });
  const feed = (await api('/api/feed/refresh', undefined, 'POST')) as FeedResponse;
  assert.equal(new Set(feed.sections.top.map((p) => p.doi)).size, 4);
  assert.equal(feed.sections.top.length, 4);
  assert.deepEqual(new Set(feed.sections.top.map((p) => p.publication?.publicationKind)), new Set(['journal', 'conference', 'preprint', 'unknown']));
  assert.ok(feed.sections.top.every((p) => p.topicIds?.includes(topic.id)));
  await discovery();
  assert.equal(await page.locator('.research-entry').count(), 4);
  await choose('Publication type', 'Journal');
  assert.equal(await page.locator('.research-entry').count(), 1);
  await choose('Publication source', 'Crossref');
  assert.equal(await page.locator('.research-entry').count(), 1);
  await choose('Publication type', 'Preprint');
  assert.equal(await page.locator('.research-entry').count(), 0);
  await capture('discovery-filter-empty');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  const first = page.locator('.research-entry').filter({ has: page.getByRole('link', { name: title, exact: true }) });
  await first.getByRole('button', { name: 'Save metadata: ' + title, exact: true }).click();
  await settle(() => store.listLibrary().some((r) => r.doi === '10.1234/stage1'));
  const saved = store.listLibrary().find((r) => r.doi === '10.1234/stage1')!;
  const key = saved.paperKey;
  assert.equal(saved.saved, true);
  assert.equal(saved.lastReadAt, null);
  assert.equal(store.getPaper(key), null);
  assert.equal(store.getPdf(key), null);
  await first.getByRole('button', { name: 'Remove saved: ' + title, exact: true }).waitFor();
  await first.getByRole('button', { name: 'Remove saved: ' + title, exact: true }).click();
  await settle(() => !store.getLibrary(key)!.saved);
  await first.getByRole('button', { name: 'Save metadata: ' + title, exact: true }).click();
  await settle(() => store.getLibrary(key)!.saved);
  const folder = await api('/api/library/folders', { id: randomUUID(), name: 'Stage3 research', parentId: null });
  const child = await api('/api/library/folders', { id: randomUUID(), name: 'Nested evidence', parentId: folder.id });
  await api('/api/library/' + key, { collections: [folder.id, child.id], tags: ['durable'] }, 'PATCH');
  // Actual local file chooser associates bytes with the metadata-only catalog identity.
  await first.locator('input[type="file"]').setInputFiles({ name: 'actual-layout.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash.split('/').at(-1)!), key);
  await settle(() => !!store.getLibrary(key)!.lastReadAt);
  assert.equal(store.getPaper(key)?.pdfSha256, sha);
  assert.deepEqual(store.getLibrary(key)!.collections, [folder.id, child.id]);
  assert.deepEqual(store.getLibrary(key)!.tags, ['durable']);
  results.metadataIdentity = {
    paperKey: key,
    metadataSaveWithoutPdf: true,
    repeatedSaveSameIdentity: true,
    pdfLinkedByActualChooser: true,
    foldersTagsRetained: true,
    recentOnlyAfterReading: true,
  };
  // New original range, highlight and per-question language against accepted actual history routes.
  await page.locator('.reader-bar__views button').first().click();
  await select();
  await page.getByRole('button', { name: 'Yellow highlight', exact: true }).click();
  await settle(() => store.listHighlights(key).length === 1);
  const highlight = store.listHighlights(key)[0];
  assert.equal(highlight.provenance?.pdfSha256, sha);
  assert.equal(highlight.provenance?.coordinateSpace, 'rendered-page-normalized-v1');
  assert.equal(highlight.provenance?.layoutRange?.page, 1);
  assert.equal(highlight.provenance?.layoutRange?.start, 1);
  assert.equal(highlight.provenance?.layoutRange?.end, 7);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await select();
  await page.locator('.selection-menu').getByRole('button', { name: 'Ask', exact: true }).click();
  await choose('Answer language', 'English');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('What does the selected passage establish?');
  await page.locator('.research-panel form').getByRole('button', { name: 'Ask', exact: true }).click();
  await settle(() => store.listHistory(key).some((h) => h.status === 'completed'));
  const history = store.listHistory(key).find((h) => h.status === 'completed')!;
  assert.equal(history.context.answerLanguage, 'en');
  assert.equal(history.answer?.contextSourceStatus, 'current');
  assert.equal(history.answer?.citations?.[0]?.page, 1);
  assert.ok(history.answer?.citations?.[0]?.region);
  assert.equal(store.getPreferences().answerLanguage, 'auto');
  await page.getByText('Custom language tag', { exact: true }).click();
  await page.getByLabel('BCP47 language tag', { exact: true }).fill('zh-Hant');
  await page.getByRole('button', { name: 'Use language', exact: true }).click();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Retain this custom language choice.');
  await page.locator('.research-panel form').getByRole('button', { name: 'Ask', exact: true }).click();
  await settle(() => store.listHistory(key).some((h) => h.context.answerLanguage === 'zh-Hant' && h.status === 'completed'));
  await capture('reader-original-provenance-language');
  await page.getByRole('button', { name: 'Close research panel', exact: true }).click();
  await page.locator('.reader-bar').getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Add note to original page', exact: true }).click();
  await page.locator('.sticky-note textarea').waitFor();
  await page.locator('.sticky-note textarea').fill('Full durable body\nSecond paragraph retained with original provenance.');
  await settle(() => store.listAnnotations(key).some((a) => a.kind === 'memo' && a.text.includes('Second paragraph')));
  const memo = store.listAnnotations(key).find((a) => a.kind === 'memo') as Memo;
  assert.equal(memo.provenance?.pdfSha256, sha);
  assert.equal(memo.provenance?.coordinateSpace, 'rendered-page-normalized-v1');
  // Legacy untagged and declared unrotated records retain their raw frames through edits.
  const legacy = {
    ...memo,
    id: randomUUID(),
    page: 2,
    text: 'Legacy untagged body',
    rect: { x: 0.14, y: 0.22, width: 0.32, height: 0.25 },
    provenance: undefined,
  };
  await api('/api/papers/' + key + '/annotations', legacy);
  const rotated = {
    ...memo,
    id: randomUUID(),
    page: 2,
    text: 'Declared unrotated body',
    rect: { x: 0.12, y: 0.18, width: 0.3, height: 0.25 },
    provenance: { coordinateSpace: 'unrotated-crop-normalized-v1', textSource: 'original', pdfSha256: sha },
  };
  await api('/api/papers/' + key + '/annotations', rotated);
  const stale = {
    ...history,
    id: randomUUID(),
    requestId: randomUUID(),
    question: 'Retained stale quote and draft',
    context: { ...history.context, provenance: { ...history.context.provenance, pdfSha256: 'b'.repeat(64) } },
    createdAt: new Date().toISOString(),
  } as HistoryEntry;
  store.putHistory(stale);
  await api('/api/papers/' + key + '/annotations', { ...rotated, id: randomUUID(), page: 999, text: 'Invalid synchronized page must not block valid notes' });
  await page.route('**/api/papers/*/text-layout?*', (route) => route.abort('failed'));
  await page.reload();
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await page.locator('.reader-bar').getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByText('Original verification unavailable', { exact: false }).first().waitFor();
  assert.equal(await page.locator('.highlight-marker').count(), 0);
  await page.unroute('**/api/papers/*/text-layout?*');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('.highlight-marker').first().waitFor();
  await page.getByText('Invalid synchronized page must not block valid notes', { exact: true }).waitFor();
  assert.ok((await page.locator('.sticky-note').count()) >= 1);
  results.offlineSourceRecoveryAndInvalidPageIsolation = true;
  await page.locator('.notes').getByRole('button').filter({ hasText: 'Declared unrotated body' }).click();
  const unrotated = page.locator('.sticky-note[data-memo-id="' + rotated.id + '"]');
  await unrotated.locator('textarea').fill('Edited in the retained declared frame');
  await settle(() => store.getAnnotation(rotated.id)?.kind === 'memo' && store.getAnnotation(rotated.id)?.text === 'Edited in the retained declared frame');
  assert.deepEqual(store.getAnnotation(rotated.id)?.rect, rotated.rect);
  await unrotated.locator('.sticky-note__move').focus();
  await unrotated.locator('.sticky-note__move').press('ArrowRight');
  await settle(() => Math.abs((store.getAnnotation(rotated.id)?.rect?.y ?? 0) - 0.17) < 0.00001);
  assert.equal(store.getAnnotation(rotated.id)?.provenance?.coordinateSpace, 'unrotated-crop-normalized-v1');
  results.declaredUnrotatedBodyAndMovementRoundTrip = true;
  await page
    .getByRole('button', { name: 'Close research panel', exact: true })
    .count()
    .then(async (count) => {
      if (count) await page.getByRole('button', { name: 'Close research panel', exact: true }).click();
      else await page.locator('.reader-bar').getByRole('button', { name: 'Notes', exact: true }).click();
    });
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.locator(`[data-history-id="${history.id}"] .research-citations`).waitFor();
  const staleEntry = page.locator(`[data-history-id="${stale.id}"]`);
  await staleEntry.locator('.reader-context-status[data-stale="true"]').waitFor();
  assert.match((await staleEntry.textContent()) ?? '', /WW iii/);
  await staleEntry.getByRole('button', { name: 'Open', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Question', exact: true }).inputValue(), stale.question);
  await capture('reader-reopened-stale-history');
  const histories = store.listHistory(key).map((h) => h.id),
    annotations = store.listAnnotations(key).map((a) => a.id);
  const repeat = await nativeFetch(service.url + `/api/library/${key}/pdf`, {
    method: 'POST',
    headers: { origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/pdf' },
    body: pdf,
  });
  assert.ok(repeat.ok);
  assert.equal((await repeat.json()).data.paperKey, key);
  const replacement = await nativeFetch(service.url + `/api/library/${key}/pdf`, {
    method: 'POST',
    headers: { origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/pdf' },
    body: Buffer.concat([pdf, Buffer.from('\n%different-original')]),
  });
  assert.equal(replacement.status, 409);
  assert.deepEqual(
    store.listHistory(key).map((h) => h.id),
    histories,
  );
  assert.deepEqual(
    store.listAnnotations(key).map((a) => a.id),
    annotations,
  );
  assert.deepEqual(store.getAnnotation(legacy.id)?.rect, legacy.rect);
  assert.equal(store.getAnnotation(legacy.id)?.provenance, undefined);
  results.provenance = {
    newNativeExactRange: highlight.provenance,
    perQuestionLanguage: true,
    customBcp47: true,
    globalLanguageUnchanged: true,
    durablePassageCitation: true,
    legacyRawFrameUnchanged: true,
    staleQuoteDraftRetained: true,
    idempotentPdfAssociation: true,
    replacement409RetainsContext: true,
  };
  // Real related response/cache/provider status; retained rows stay visible throughout retry.
  await page.getByRole('tab', { name: 'Related', exact: true }).click();
  await page.locator('.related__title').first().waitFor();
  const useful = await page.locator('.related__title').count();
  assert.ok(useful >= 3);
  const old = new Date(Date.now() - 8 * 86400000).toISOString();
  for (const row of store.db.prepare('SELECT provider,identity,data FROM related_provider_cache').all() as {
    provider: string;
    identity: string;
    data: string;
  }[]) {
    store.db
      .prepare('UPDATE related_provider_cache SET fetched_at=?,data=? WHERE provider=? AND identity=?')
      .run(old, JSON.stringify({ ...JSON.parse(row.data), fetchedAt: old }), row.provider, row.identity);
  }
  relatedFailure = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.related__toolbar').getByText('Refreshing…', { exact: true }).waitFor();
  assert.equal(await page.locator('.related__title').count(), useful);
  await capture('related-refresh-retained');
  await page.locator('.source-status [data-state="rate_limited"]').waitFor();
  await page.locator('.source-status [data-state="timeout"]').waitFor();
  assert.equal(await page.locator('.related__title').count(), useful);
  await capture('related-stale-429-timeout');
  const after = JSON.stringify(counts);
  await page.waitForTimeout(2500);
  assert.equal(JSON.stringify(counts), after);
  assert.equal(await page.locator('.related__toolbar button').isDisabled(), true);
  const related = page
    .locator('.related__item')
    .filter({ has: page.getByRole('link', { name: 'Provider-reported shared reference and similar work', exact: true }) })
    .first();
  await related.getByRole('button', { name: 'Save metadata: Provider-reported shared reference and similar work', exact: true }).click();
  await settle(() => store.listLibrary().some((r) => r.doi === '10.1234/related' && r.saved));
  results.related = {
    actualProviderCache: true,
    mergedReferenceSimilarRelations: true,
    retainedDuringRefresh: true,
    stale429AndTimeoutDistinguished: true,
    cooldownRetryDisabled: true,
    noAutomaticRequestStorm: true,
    staleMetadataSave: true,
  };
  // Shared saved state, topic/news/source controls, actual article and headline translation routes.
  await discovery();
  await first.getByRole('button', { name: 'Remove saved: ' + title, exact: true }).waitFor();
  await first.getByRole('button', { name: 'Remove saved: ' + title, exact: true }).click();
  await settle(() => !store.getLibrary(key)!.saved);
  assert.ok(store.getPdf(key));
  assert.ok(store.getLibrary(key)!.lastReadAt);
  assert.equal(store.listHistory(key).length, histories.length);
  await first.getByRole('button', { name: 'Save metadata: ' + title, exact: true }).click();
  await settle(() => store.getLibrary(key)!.saved);
  await page.getByRole('tab', { name: 'Topics', exact: true }).click();
  await choose('Field', 'Computation and language');
  await choose('Topic', 'Durable reading evidence');
  assert.equal(await page.locator('.research-entry').count(), 4);
  await capture('discovery-topics');
  await page.getByRole('tab', { name: 'News', exact: true }).click();
  await choose('Headline language', '한국어');
  await page.getByRole('button', { name: 'Translate headlines', exact: true }).click();
  await page
    .locator('.news-card__title')
    .getByText(/검증 번역/)
    .first()
    .waitFor();
  await capture('discovery-news-translated');
  await page.locator('.news-card__link').first().click();
  await page.locator('.article p').filter({ hasText: 'A second paragraph' }).waitFor();
  await capture('discovery-article-source');
  await page.getByRole('button', { name: /Close/ }).click();
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Crossref', exact: true }).uncheck();
  await settle(
    () => JSON.parse((store.db.prepare("SELECT data FROM feed_meta WHERE key='settings'").get() as { data: string }).data).sources.crossref === false,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  results.discovery = {
    actualOpenAlexCrossrefParsing: true,
    allFourPublicationKinds: true,
    repeatedProviderResultsDeduplicated: true,
    actualSourceTypeFilters: true,
    customFieldAndTopicAssociation: true,
    titleTranslationRoute: true,
    articleExtractionRoute: true,
    persistedSourceSelection: true,
    savedConsistentAcrossScreens: true,
    unsaveRetainsPdfHistoryRecent: true,
  };
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ])
    for (const theme of ['light', 'dark', 'sepia'])
      for (const language of ['en', 'ko']) {
        await api('/api/preferences', { uiLanguage: language, translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }, 'PUT');
        await page.setViewportSize({ width, height });
        await page.goto(service.url + '/#/home');
        await page.reload();
        await page.locator('.research-entry').first().waitFor();
        await page.evaluate((theme) => {
          localStorage.setItem('fractal.theme', theme);
          document.documentElement.setAttribute('data-theme', theme);
        }, theme);
        await capture(`discovery-${width}-${theme}-${language}`);
        const clipping = await page
          .locator('.research-title')
          .evaluateAll((nodes) => nodes.some((n) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1));
        assert.equal(clipping, false, 'Long titles clipped');
      }
  await api('/api/preferences', { uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }, 'PUT');
  const statePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  statePage.on('pageerror', (error) => errors.push(error.message));
  await statePage.route('**/api/feed', async (route) => {
    await new Promise((d) => setTimeout(d, 1300));
    await route.continue();
  });
  await statePage.goto(service.url + '/#/home');
  await statePage.getByText('Loading your research desk…', { exact: true }).waitFor();
  await capture('discovery-loading', statePage);
  await statePage.locator('.research-entry').first().waitFor();
  await statePage.unrouteAll({ behavior: 'wait' });
  await statePage.route('**/api/feed', (route) => route.abort('failed'));
  await statePage.reload();
  await statePage.getByRole('button', { name: 'Retry loading', exact: true }).waitFor();
  await capture('discovery-error', statePage);
  await statePage.unrouteAll({ behavior: 'wait' });
  await statePage.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await statePage.locator('.research-entry').first().waitFor();
  await statePage.close();
  await discovery();
  const sort = page.getByRole('combobox', { name: 'Sort discovered papers', exact: true });
  await sort.focus();
  await sort.press('End');
  await page.getByRole('option', { name: 'Reported popularity', exact: true }).waitFor();
  await sort.press('Home');
  await sort.press('ArrowDown');
  await sort.press('Enter');
  assert.equal(await sort.getAttribute('aria-expanded'), 'false');
  await sort.press('ArrowDown');
  await sort.press('Escape');
  assert.equal(await sort.evaluate((el) => document.activeElement === el), true);
  results.selectorKeyboard = true;
  // Restart the real Hub over the same isolated database; reopened context comes
  // from durable history rather than an active stream or the current browser draft.
  await service.stop();
  service = await startService({
    dataDirectory: directory,
    port: 0,
    indexHtml: join(root, 'packages/ui/dist/index.html'),
    startBackground: false,
    allowRealCli: false,
    fetcher: globalThis.fetch,
    log: () => {},
  });
  store = service.store as SqlitePaperStore;
  await page.goto(service.url + '/#/paper/' + key);
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.locator(`[data-history-id="${history.id}"] .research-citations`).waitFor();
  assert.equal(store.getHistory(history.id)?.context.answerLanguage, 'en');
  assert.equal(store.getHistory(history.id)?.answer?.contextSourceStatus, 'current');
  assert.ok(store.listHistory(key).some((h) => h.context.answerLanguage === 'zh-Hant'));
  assert.equal(store.getAnnotation(legacy.id)?.provenance, undefined);
  assert.deepEqual(store.getAnnotation(legacy.id)?.rect, legacy.rect);
  await page.locator(`[data-history-id="${stale.id}"] .reader-context-status[data-stale="true"]`).waitFor();
  await capture('reader-hub-restart-history');
  results.hubRestartLanguageProvenanceLegacyAndStaleHistory = true;
  results.endpointRequests = counts;
  results.errors = errors;
  assert.deepEqual(errors, []);
  results.status = 'passed';
  await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2));
} catch (error) {
  results.failure = String(error);
  results.errors = errors;
  results.endpointRequests = counts;
  await capture('failure').catch(() => {});
  await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2));
  throw error;
} finally {
  await browser.close();
  await service.stop();
  globalThis.fetch = nativeFetch;
  Object.assign(ProviderRegistry.prototype, originals);
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'fractal-desktop-stage3-'));
  await rm(directory, { recursive: true, force: true });
}
