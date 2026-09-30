/** Narrow independent merged-checkpoint wiring check; final C/D gates stay open. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startService } from '../../../../packages/hub/src/main';
import { SqlitePaperStore } from '../../../../packages/hub/src/store/sqlite';
import { extractPdf } from '../../../../packages/hub/src/pdf/index';
import { ProviderRegistry } from '../../../../packages/hub/src/ai/registry';
import { translationPromptVersion } from '../../../../packages/hub/src/translation';
import { TOKEN_HEADER } from '../../../../packages/hub/src/api';
const root = resolve('.'), owned = join(root, 'docs/implementation/qa/integrated');
const output = join(owned, 'accepted-c-evidence');
await mkdir(join(owned, 'runtime'), { recursive: true });
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(owned, 'runtime/desktop-'));
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
process.env.NODE_ENV = 'test';
const selection = { provider: 'codex' as const, model: 'qa-current-model' };
let release: (() => void) | undefined;
const provider = {
  id: 'codex' as const,
  async status() { return { id: 'codex' as const, installed: true, loggedIn: true, version: 'Independent QA boundary' }; },
  async listModels() { return [{ id: selection.model, label: 'Independent QA model with a deliberately long scholarly descriptive name' }]; },
  async usage() { return null; },
  async *complete(input: any) {
    yield { type: 'text' as const, text: 'Independent accepted-checkpoint prefix ' };
    await new Promise<void>(done => { release = done; input.signal?.addEventListener('abort', done, { once: true }); });
    if (!input.signal?.aborted) yield { type: 'text' as const, text: 'Independent completed answer retained. [p.1]' };
  },
};
const old = { select: ProviderRegistry.prototype.select, complete: ProviderRegistry.prototype.complete,
  providersInfo: ProviderRegistry.prototype.providersInfo, getSettings: ProviderRegistry.prototype.getSettings };
ProviderRegistry.prototype.select = async () => ({ provider, selection }) as any;
ProviderRegistry.prototype.complete = async function* (_feature, input) { yield* provider.complete(input); };
ProviderRegistry.prototype.providersInfo = async () => [{ status: await provider.status(), models: await provider.listModels() }];
ProviderRegistry.prototype.getSettings = async () => ({ default: selection, overrides: {} });
const scholarlyTitle = 'Reading evidence across scientific publications: preserving scholarly context, original passages and durable annotations through interrupted research workflows';
const abstract = 'Readers compare evidence across multiple publications, saved notes and source passages. This controlled provider record includes an abstract, several authors and an explicit venue so the actual discovery layout can be reviewed with useful information density. Cached publication metadata must remain distinct from a downloaded PDF and from a reading event.';
function inverted(text: string) {
  const index: Record<string, number[]> = {};
  text.split(' ').forEach((word, position) => (index[word] ??= []).push(position)); return index;
}
const works = [
  { id: 'https://openalex.org/W901', display_name: scholarlyTitle, type: 'article', doi: 'https://doi.org/10.1234/independent901', publication_year: 2026,
    publication_date: '2026-09-29', primary_location: { source: { type: 'journal', display_name: 'Journal of Scholarly Reading and Evidence' }, landing_page_url: 'https://example.org/e901' },
    authorships: ['Ada Lovelace', 'Grace Hopper', 'Independent Research Group'].map(display_name => ({ author: { display_name } })), abstract_inverted_index: inverted(abstract), open_access: { is_oa: false } },
  { id: 'https://openalex.org/W902', display_name: '다중 출판물의 원문 문맥과 연구 기록을 보존하며 읽기 중단과 재연결을 검증하는 학술 연구', type: 'conference-paper', doi: 'https://doi.org/10.1234/independent902', publication_year: 2026,
    publication_date: '2026-09-29', primary_location: { source: { type: 'conference', display_name: 'Research Systems Conference' }, landing_page_url: 'https://example.org/e902' },
    authorships: [{ author: { display_name: '김연구' } }], abstract_inverted_index: inverted('이 검증 자료는 긴 학술 제목과 저자 및 출판 정보를 실제 탐색 화면에 표시합니다. 원문과 연구 기록의 보존 여부를 검토하며 출처가 확인되지 않은 정보는 추측하지 않습니다.'), open_access: { is_oa: true } },
  { id: 'https://openalex.org/W903', display_name: 'Independent publication with genuinely unspecified venue, year and access metadata', doi: 'https://doi.org/10.1234/independent903',
    primary_location: null, authorships: [], abstract_inverted_index: inverted('The provider did not supply publication kind, year or access status. These missing values must remain visibly unknown.') },
];
const scholarlyFetch: typeof fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.hostname, 'api.openalex.org', 'Unconfigured external boundary'); return Response.json({ results: works });
};
const service = await startService({ dataDirectory: directory, port: 0, indexHtml: join(root, 'packages/ui/dist/index.html'), allowRealCli: false, startBackground: false, fetcher: scholarlyFetch, log() {} });
const store = service.store as SqlitePaperStore;
store.putPreferences({ uiLanguage: 'en', translationLanguage: 'en', answerLanguage: 'auto', onboardingCompleted: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('**/*', route => route.request().url().startsWith(service.url) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const results: any = { sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), finalCertification: false,
  isolation: 'Independent fresh SQLite/browser; D shared QA Hub and fixture untouched', hubUrl: service.url,
  provider: 'Deterministic boundary only; actual accepted HTTP/SSE/SQLite/PDF.js/built UI', assertions: [], screenshots: [] };
async function record(name: string, actual: unknown) { results.assertions.push({ name, actual }); }
async function api(path: string, value?: unknown, method = 'GET') {
  const response = await fetch(service.url + path, { method, headers: { origin: service.url, [TOKEN_HEADER]: service.token, 'content-type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.ok(response.ok, `QA API ${path}: ${response.status}`); return (await response.json()).data;
}
async function wait(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(done => setTimeout(done, 50)); }
  throw Error('Native persisted state did not settle');
}
async function capture(name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // Capture the settled drawer, not its entry transition.
  const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
    titleFont: document.querySelector('.reader-heading h1') ? getComputedStyle(document.querySelector('.reader-heading h1')!).fontFamily : null,
    theme: document.documentElement.dataset.theme, title: document.querySelector('.reader-heading h1')?.textContent }));
  assert.equal(metrics.overflow, false);
  await page.screenshot({ path: join(output, name + '.png') });
  results.screenshots.push({ name, viewport: page.viewportSize(), ...metrics });
}
try {
  await page.goto(service.url + '/#/library');
  await page.locator('#library-title').waitFor();
  await page.waitForFunction(() => document.querySelector('#library-title')?.textContent === 'Saved papers');
  assert.equal(await page.locator('#library-title').textContent(), 'Saved papers');
  await capture('current-empty-index-en-light-1440x900');
  assert.equal(store.listLibrary().length, 0); await record('empty actual library', true);
  const settings = await api('/api/feed/settings');
  await api('/api/feed/interests', { categories: ['cs.CL'], topics: [], authors: [], custom: [] }, 'PUT');
  await api('/api/feed/settings', { ...settings, sources: { arxiv: false, huggingFace: false, news: false, recommendations: false, openAlex: true, crossref: false } }, 'PUT');
  const feed = await api('/api/feed/refresh', undefined, 'POST');
  assert.equal(feed.sections.top.length, 3);
  await page.goto(service.url + '/#/home'); await page.locator('.research-entry').first().waitFor();
  assert.equal(await page.locator('.research-entry').count(), 3);
  assert.ok(await page.getByText('Venue unknown', { exact: true }).count());
  assert.ok(await page.getByText('Access unknown', { exact: true }).count());
  assert.ok(await page.locator('.research-summary').filter({ hasText: 'several authors' }).isVisible());
  await capture('metadata-rich-discovery-en-light-1440x900');
  const row = page.locator('.research-entry').filter({ hasText: scholarlyTitle });
  await row.getByRole('button', { name: 'Save metadata: ' + scholarlyTitle, exact: true }).click();
  await wait(() => store.listLibrary().some(record => record.title === scholarlyTitle && record.saved));
  const metadata = store.listLibrary().find(record => record.title === scholarlyTitle)!;
  assert.equal(metadata.lastReadAt, null); assert.equal(store.getPdf(metadata.paperKey), null);
  await row.getByRole('button', { name: 'Remove saved: ' + scholarlyTitle, exact: true }).click();
  await wait(() => store.getLibrary(metadata.paperKey)?.saved === false);
  await record('actual metadata save/unsave preserves record without PDF/read event', { paperKey: metadata.paperKey, lastReadAt: metadata.lastReadAt, hasPdf: false });
  const pdf = await readFile(join(root, 'packages/hub/test/fixtures/text-layout.pdf'));
  const hash = createHash('sha256').update(pdf).digest('hex');
  const sourceUrl = 'https://example.org/isolated-qa.pdf';
  const key = `pdf-${createHash('sha256').update(sourceUrl).digest('hex')}-${hash}`;
  const extracted = await extractPdf(pdf, key);
  const title = 'A long scholarly investigation of retained research history, selected original PDF passages and immutable source identity across reader lifecycles';
  store.savePaper({ paperKey: key, sourceKind: 'publication', arxivId: null, version: null, title,
    authors: ['Independent QA'], sourceUrl, pdfSha256: hash, pageCount: 5,
    extractionVersion: extracted.extractionVersion, status: 'ready', coverage: extracted.coverage, createdAt: new Date().toISOString() }, pdf);
  store.saveBlocks(key, extracted.blocks);
  for (const block of extracted.blocks.filter(b => b.translatable)) store.saveTranslation(key, { blockId: block.blockId, sourceHash: block.sourceHash,
    modelId: selection.model, promptVersion: translationPromptVersion('en'), status: 'completed', text: 'Stored ordinary translated passage for copying and quoting.',
    error: null, completedAt: new Date().toISOString() });
  await page.goto(service.url + '/#/paper/' + key);
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  await page.waitForTimeout(400); // PDF mode relayout must settle before pointer coordinates are sampled.
  const points = await page.evaluate(() => {
    const span = [...document.querySelectorAll('[data-testid="text-layer-1"] span')].find(s => s.textContent === 'WWW iii wide thin')!;
    return [1, 7].map(offset => { const range = document.createRange(); range.setStart(span.firstChild!, offset); range.setEnd(span.firstChild!, offset + 1);
      const box = range.getBoundingClientRect(); return { x: box.left + .8, y: box.top + box.height / 2 }; });
  });
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 12 }); await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  assert.equal(await page.evaluate(() => getSelection()?.toString()), 'WW iii');
  await record('actual partial original pointer selection', 'WW iii');
  await page.locator('.selection-menu').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByText('Custom language tag', { exact: true }).click();
  await page.getByLabel('BCP47 language tag', { exact: true }).fill('zh-Hant');
  await page.getByRole('button', { name: 'Use language', exact: true }).click();
  await page.getByText('Custom language tag', { exact: true }).click();
  await page.locator('.research-panel textarea').fill('E current merged-checkpoint retained question');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await wait(() => store.listHistory(key).some(h => h.status === 'running'));
  const entry = store.listHistory(key)[0]; assert.equal(entry.context.selectedText, 'WW iii'); assert.equal(entry.context.page, 1);
  const layout = await api(`/api/papers/${key}/text-layout?page=1`);
  assert.equal(entry.context.provenance?.pdfSha256, hash);
  assert.equal(entry.context.provenance?.coordinateSpace, 'rendered-page-normalized-v1');
  assert.deepEqual(entry.context.provenance?.layoutRange, { page: 1, extractionVersion: layout.extractionVersion, start: 1, end: 7 });
  assert.equal(entry.context.answerLanguage, 'zh-Hant'); assert.equal(store.getPreferences().answerLanguage, 'auto');
  await page.getByRole('button', { name: 'Close research panel' }).click();
  assert.equal(store.getHistory(entry.id)?.status, 'running');
  release!(); await wait(() => store.getHistory(entry.id)?.status === 'completed');
  assert.equal(store.getHistory(entry.id)?.answer?.contextSourceStatus, 'current');
  assert.ok(store.getHistory(entry.id)?.answer?.citations?.[0]?.region);
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator(`[data-history-id="${entry.id}"]`).waitFor();
  const answer = page.locator(`[data-history-id="${entry.id}"] .md`).filter({ hasText: 'Independent completed answer retained.' });
  await answer.waitFor(); await answer.scrollIntoViewIfNeeded();
  assert.ok(await page.locator(`[data-history-id="${entry.id}"] .research-citations`).textContent());
  await record('actual reopened answer and durable citation rendered', await answer.textContent());
  await record('close detaches; same actual entry reopens complete', { id: entry.id, page: entry.context.page, quote: entry.context.selectedText, sourceStatus: store.getHistory(entry.id)?.answer?.contextSourceStatus });
  await capture('current-reader-history-en-light-1440x900');
  results.history = store.getHistory(entry.id);
  await page.getByRole('button', { name: 'Close research panel' }).focus();
  await page.keyboard.press('Escape'); await page.locator('.research-panel').waitFor({ state: 'hidden' });
  await record('research Escape dismissal', true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => localStorage.setItem('fractal.theme', 'sepia')); await page.reload();
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await capture('current-reader-en-sepia-1280x800');
  assert.deepEqual(errors, []); results.errors = errors; results.status = 'passed';
} catch (error) { results.status = 'failed'; results.failure = String(error); results.errors = errors; await capture('current-check-failure').catch(() => {}); throw error; }
finally {
  release?.(); await browser.close(); await service.stop(); Object.assign(ProviderRegistry.prototype, old);
  results.resourcesClosed = true; await writeFile(join(output, 'current-desktop.json'), JSON.stringify(results, null, 2));
}
console.log('Narrow accepted-checkpoint desktop check passed; final C/D certification remains open');
