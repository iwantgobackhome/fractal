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
const root = resolve('.'), owned = join(root, 'docs/implementation/qa/integrated');
await mkdir(join(owned, 'runtime'), { recursive: true });
await mkdir(join(owned, 'checkpoint-evidence'), { recursive: true });
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
const service = await startService({ dataDirectory: directory, port: 0, indexHtml: join(root, 'packages/ui/dist/index.html'), allowRealCli: false, startBackground: false, log() {} });
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
  await page.screenshot({ path: join(owned, 'checkpoint-evidence', name + '.png') });
  results.screenshots.push({ name, viewport: page.viewportSize(), ...metrics });
}
try {
  await page.goto(service.url + '/#/library');
  await page.locator('#library-title').waitFor();
  await page.waitForFunction(() => document.querySelector('#library-title')?.textContent === 'Saved papers');
  assert.equal(await page.locator('#library-title').textContent(), 'Saved papers');
  await capture('current-empty-index-en-light-1440x900');
  assert.equal(store.listLibrary().length, 0); await record('empty actual library', true);
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
  await page.locator('.research-panel textarea').fill('E current merged-checkpoint retained question');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await wait(() => store.listHistory(key).some(h => h.status === 'running'));
  const entry = store.listHistory(key)[0]; assert.equal(entry.context.selectedText, 'WW iii'); assert.equal(entry.context.page, 1);
  await page.getByRole('button', { name: 'Close research panel' }).click();
  assert.equal(store.getHistory(entry.id)?.status, 'running');
  release!(); await wait(() => store.getHistory(entry.id)?.status === 'completed');
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator(`[data-history-id="${entry.id}"]`).waitFor();
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
  results.resourcesClosed = true; await writeFile(join(owned, 'checkpoint-evidence/current-desktop.json'), JSON.stringify(results, null, 2));
}
console.log('Narrow accepted-checkpoint desktop check passed; final C/D certification remains open');
