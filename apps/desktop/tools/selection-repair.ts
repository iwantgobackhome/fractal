/** Real pointer input in the actual original reader; ranges below only measure glyphs. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, _electron, type Page } from 'playwright-core';
import { startService } from '../../../packages/hub/src/main';
import { extractPdf } from '../../../packages/hub/src/pdf/index';
import { extractTextPage } from '../../../packages/hub/src/pdf/text-layout';
import { translationPromptVersion } from '../../../packages/hub/src/translation/index';
import type { Paper } from '@fractal/shared';

const root = resolve(import.meta.dirname, '../../..');
const output = join(root, 'docs/implementation/desktop/selection-repair');
await mkdir(output, { recursive: true });
const mode = process.env.SELECTION_REPAIR_MODE ?? 'before';
const directory = await mkdtemp(join(tmpdir(), `fractal-selection-${mode}-`));
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
process.env.NODE_ENV = 'test';
const service = await startService({
  dataDirectory: directory,
  port: 0,
  indexHtml: join(root, 'packages/ui/dist/index.html'),
  allowRealCli: false,
  startBackground: false,
  log: () => {},
});
service.store.putPreferences({ uiLanguage: 'en', onboardingCompleted: true, translationLanguage: 'ko', answerLanguage: 'auto' });
const bytes = await readFile(join(root, 'dist/qa-word-selection-input/attention-1706.03762.pdf'));
const hash = createHash('sha256').update(bytes).digest('hex');
const key = `pdf-${createHash('sha256').update('https://arxiv.org/pdf/1706.03762').digest('hex')}-${hash}`;
const extraction = await extractPdf(bytes, key);
const record: Paper = {
  paperKey: key,
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani et al.'],
  sourceKind: 'publication',
  arxivId: null,
  version: null,
  sourceUrl: 'https://arxiv.org/pdf/1706.03762',
  pdfSha256: hash,
  pageCount: extraction.coverage.totalPages,
  extractionVersion: extraction.extractionVersion,
  coverage: extraction.coverage,
  status: 'ready',
  createdAt: new Date().toISOString(),
};
service.store.savePaper(record, bytes);
service.store.saveBlocks(key, extraction.blocks);
const layout = await extractTextPage(bytes, 1);
assert.ok('page' in layout);
const fallback = layout.page.runs
  .filter((r) => r.granularity === 'run' && r.end - r.start > 40)
  .find((r) => /models|attention|sequence/.test(layout.page.text.slice(r.start, r.end)));
assert.ok(fallback, 'actual academic PDF has long coarse geometry run');
const text = layout.page.text.slice(fallback.start, fallback.end);
const word = /\b[a-z]{6,}\b/i.exec(text)!;
const start = word.index,
  end = start + word[0].length;
const evidence: Record<string, any> = {
  mode,
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  directory,
  pdfSha256: hash,
  academic: record.sourceUrl,
  text,
  run: fallback,
  boundaries: layout.page.boundaries.filter((n) => n >= fallback.start && n <= fallback.end),
  issues: layout.page.issues,
  cases: [],
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let riskKey = '';
if (mode === 'after') {
  const riskBytes = await readFile(join(root, 'packages/hub/test/fixtures/text-layout.pdf'));
  const riskHash = createHash('sha256').update(riskBytes).digest('hex');
  riskKey = `pdf-${createHash('sha256').update('https://example.org/selection-risk').digest('hex')}-${riskHash}`;
  const extracted = await extractPdf(riskBytes, riskKey);
  service.store.savePaper(
    {
      ...record,
      paperKey: riskKey,
      title: 'Focused original selection risks',
      sourceUrl: 'https://example.org/selection-risk',
      pdfSha256: riskHash,
      pageCount: extracted.coverage.totalPages,
      extractionVersion: extracted.extractionVersion,
      coverage: extracted.coverage,
    },
    riskBytes,
  );
  service.store.saveBlocks(riskKey, extracted.blocks);
  for (const block of extracted.blocks.filter((b) => b.translatable))
    service.store.saveTranslation(riskKey, {
      blockId: block.blockId,
      sourceHash: block.sourceHash,
      modelId: 'selection-verification',
      promptVersion: translationPromptVersion('ko'),
      status: 'completed',
      text: 'Translated character quotation remains independent.',
      error: null,
      completedAt: new Date().toISOString(),
    });
}
let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined;
let ownedProcess: ReturnType<NonNullable<typeof electron>['process']> | undefined;
let serviceRunning = true;
async function open(page: Page, origin: string) {
  await page.addInitScript('window.__name = (value) => value');
  await page.goto(origin + '/#/paper/' + encodeURIComponent(key));
  await page.evaluate('window.__name = (value) => value');
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await page.locator('.reader-bar__views button').first().click();
  await page.getByRole('button', { name: 'T', exact: true }).click();
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}
async function drag(
  page: Page,
  start: number,
  end: number,
  label: string,
  clipboard: () => Promise<string>,
  keepMenu = false,
  options: { text?: string; page?: number; expected?: string; releaseDrift?: boolean } = {},
) {
  const runText = options.text ?? text;
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  // Reader panel/zoom changes can trigger its measured fit before the next drag.
  await page.waitForTimeout(300);
  const points = await page.evaluate(
    ({ text, start, end, number }) => {
      const span = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="text-layer-${number}"] span`)).find((s) => s.textContent === text)!;
      if (!span?.firstChild) throw new Error('academic run missing');
      span.scrollIntoView({ block: 'center' });
      const point = (offset: number) => {
        const range = document.createRange();
        range.setStart(span.firstChild!, offset);
        range.setEnd(span.firstChild!, Math.min(text.length, offset + 1));
        const rect = range.getBoundingClientRect();
        const candidates = [
          [0.1, 0.5],
          [0.1, 0.1],
          [0.5, 0.1],
          [0.9, 0.1],
          [0.9, 0.5],
          [0.5, 0.9],
        ].map(([x, y]) => ({ x: rect.left + rect.width * x, y: rect.top + rect.height * y }));
        return (
          candidates.find((p) => {
            const caret = document.caretRangeFromPoint(p.x, p.y);
            return caret?.startContainer === span.firstChild && caret.startOffset === offset;
          }) ?? candidates[0]
        );
      };
      return { a: point(start), b: point(end), metadata: { ...span.dataset }, transform: getComputedStyle(span).transform };
    },
    { text: runText, start, end, number: options.page ?? 1 },
  );
  await page.mouse.move(points.a.x, points.a.y);
  await page.mouse.down();
  await page.mouse.move(points.b.x, points.b.y, { steps: 15 });
  await page.waitForTimeout(80);
  const snapshot = () =>
    page.evaluate(() => {
      const s = window.getSelection()!,
        r = s.getRangeAt(0);
      return { text: s.toString(), start: r.startOffset, end: r.endOffset, backwards: s.anchorNode === r.endContainer && s.anchorOffset === r.endOffset };
    });
  const beforeUp = await snapshot();
  await page.mouse.up();
  if (options.releaseDrift) await page.mouse.move(points.b.x + 90, points.b.y);
  await page.locator('.selection-menu').waitFor();
  const afterUp = await snapshot();
  await page.keyboard.press('Control+C');
  const copied = await clipboard();
  if (!keepMenu) await page.locator('.selection-menu').getByRole('button', { name: 'Copy', exact: true }).click();
  const menuCopy = keepMenu ? undefined : await clipboard();
  const result = {
    label,
    expected: options.expected ?? runText.slice(Math.min(start, end), Math.max(start, end)),
    beforeUp,
    afterUp,
    copied,
    menuCopy,
    ...points,
    regions: await page.locator('.selection-pending').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).getAttribute('style'))),
  };
  evidence.cases.push(result);
  await page.screenshot({ path: join(output, `${mode}-${label}.png`) });
  assert.equal(beforeUp.text, runText.slice(Math.min(start, end), Math.max(start, end)), 'actual drag before pointer up');
  if (mode === 'before') assert.notEqual(afterUp.text, result.expected, 'preserve actual pre-fix expansion');
  else {
    assert.equal(afterUp.text, result.expected);
    assert.equal(copied, result.expected);
    if (!keepMenu) assert.equal(menuCopy, result.expected);
  }
  if (!keepMenu) await page.locator('.selection-menu').waitFor({ state: 'hidden' });
  return result;
}
async function saveAndQuote(page: Page, label: string, clipboard: () => Promise<string>) {
  const selected = await drag(page, start, end, label + '-highlight', clipboard, true);
  await page.getByRole('button', { name: 'Yellow highlight', exact: true }).click();
  await page.locator('.highlight-marker').first().waitFor();
  const highlights = await page.evaluate(async (key) => (await (await fetch(`/api/papers/${encodeURIComponent(key)}/highlights`)).json()).data, key);
  const saved = highlights.at(-1);
  assert.equal(saved.text, mode === 'before' ? selected.afterUp.text : selected.expected);
  if (mode !== 'before') {
    assert.equal(saved.provenance.layoutRange, undefined, 'coarse backend range cannot honestly represent these character endpoints');
    assert.equal(saved.provenance.pdfSha256, hash);
    assert.equal(saved.provenance.coordinateSpace, 'rendered-page-normalized-v1');
    assert.ok(saved.rects[0].width < (fallback!.quad![2][0] - fallback!.quad![0][0]) / 3);
  }
  await page.reload();
  await page.locator('.highlight-marker').first().waitFor();
  evidence[label + '-reopened'] = { saved, painted: await page.locator('.highlight-box').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('style'))) };
  await page.locator('.highlight-marker').last().click();
  await page.locator('.highlight-excerpt').waitFor();
  assert.equal(await page.locator('.highlight-excerpt').textContent(), saved.text);
  await page.keyboard.press('Escape');
  await drag(page, start, end, label + '-question', clipboard, true);
  await page.locator('.selection-menu').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.research-context').waitFor();
  const quote = await page.locator('.research-context').textContent();
  assert.ok(quote?.includes(mode === 'before' ? text : selected.expected));
  evidence[label + '-quote'] = quote;
  const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(`fractal.research.${key}`)!), key);
  assert.equal(draft.context.text, mode === 'before' ? text : selected.expected);
  if (mode !== 'before') assert.equal(draft.context.provenance.layoutRange, undefined);
  evidence[label + '-quote-draft'] = draft.context;
  await page.screenshot({ path: join(output, `${mode}-${label}-quote.png`) });
  await page.getByRole('button', { name: 'Close research panel' }).click();
}
async function risks(page: Page, origin: string, clipboard: () => Promise<string>) {
  await drag(page, start + 1, end - 1, 'browser-release-drift', clipboard, false, { releaseDrift: true });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  await drag(page, start, end, 'browser-zoom', clipboard);
  await page.goto(origin + '/#/paper/' + encodeURIComponent(riskKey));
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  await drag(page, 1, 7, 'risk-glyph-forward', clipboard, false, { text: 'WWW iii wide thin' });
  await drag(page, 7, 1, 'risk-glyph-backward', clipboard, false, { text: 'WWW iii wide thin' });
  await drag(page, 5, 11, 'risk-neighbor-column', clipboard, false, { text: 'Left 2 alpha prose words' });
  const toPage = async (number: number) => {
    for (let i = 0; i < 6; i++) {
      const current = Number((await page.locator('[data-testid="page"]').textContent())?.split('/')[0]);
      if (current === number) break;
      await page.getByRole('button', { name: current < number ? 'Next page' : 'Previous page', exact: true }).click();
    }
    await page.locator(`[data-testid="text-layer-${number}"] span[data-boundaries]`).first().waitFor();
    await page.waitForTimeout(250);
  };
  await toPage(2);
  await drag(page, 2, 10, 'risk-rotated-crop', clipboard, false, { text: 'Rotated crop WWW iii', page: 2 });
  await toPage(3);
  await drag(page, 2, 8, 'risk-angled-transform', clipboard, false, { text: 'Angled WWW iii', page: 3 });
  await toPage(5);
  await drag(page, 13, 15, 'risk-combining-grapheme', clipboard, false, { text: 'Unicode café e\u0301 fi ﬂ', page: 5 });
  await drag(page, 16, 17, 'risk-real-fi-ligature', clipboard, false, { text: 'Unicode café e\u0301 fi ﬂ', page: 5, expected: 'fi' });
  await drag(page, 9, 10, 'risk-ordinary-fi-character', clipboard, false, { text: 'ordinary fi', page: 5 });
  await drag(page, 0, 2, 'risk-surrogate', clipboard, false, { text: '😀', page: 5 });
  await toPage(1);
  const point = async (number: number, text: string, offset: number) =>
    page.evaluate(
      ({ number, text, offset }) => {
        const span = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="text-layer-${number}"] span`)).find((s) => s.textContent === text)!;
        const r = document.createRange();
        r.setStart(span.firstChild!, offset);
        r.setEnd(span.firstChild!, offset + 1);
        const box = r.getBoundingClientRect();
        return { x: box.left + 0.7, y: box.top + box.height / 2 };
      },
      { number, text, offset },
    );
  const a = await point(1, 'Left 3 alpha prose words', 5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.locator('[data-testid="pdf-body"]').evaluate((node) => {
    node.scrollTop = node.querySelector<HTMLElement>('[data-page="2"]')!.offsetTop;
  });
  await page.locator('[data-testid="text-layer-2"] span').first().waitFor();
  await page.waitForTimeout(300);
  const b = await point(2, 'Rotated crop WWW iii', 7);
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  await page.keyboard.press('Control+C');
  const copied = await clipboard();
  assert.match(copied, /\[p\.1\]/);
  assert.match(copied, /\[p\.2\]/);
  assert.match(copied, /\[p\.1\] 3 alpha prose words/);
  evidence.crossPage = {
    copied,
    pages: await page.locator('.selection-pending').evaluateAll((nodes) => [...new Set(nodes.map((n) => n.closest<HTMLElement>('[data-page]')?.dataset.page))]),
  };
  assert.deepEqual(evidence.crossPage.pages, ['1', '2']);
  await page.keyboard.press('Escape');
  await toPage(1);
  await page.getByRole('button', { name: 'Translation', exact: true }).click();
  await page.locator('.kr-text').first().waitFor();
  await page.waitForTimeout(300);
  const translated = await page
    .locator('.kr-text')
    .first()
    .evaluate((node) => {
      const child = node.firstChild!;
      const expected = child.textContent!.slice(0, 10);
      const points = [0, 10].map((offset) => {
        const r = document.createRange();
        r.setStart(child, offset);
        r.setEnd(child, offset + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left + 0.7, y: b.top + b.height / 2 };
      });
      return { points, expected };
    });
  await page.mouse.move(translated.points[0].x, translated.points[0].y);
  await page.mouse.down();
  await page.mouse.move(translated.points[1].x, translated.points[1].y, { steps: 12 });
  await page.mouse.up();
  const native = await page.evaluate(() => window.getSelection()?.toString());
  assert.equal(native, translated.expected);
  await page.keyboard.press('Control+C');
  assert.equal(await clipboard(), native);
  await page.locator('.quote-button').click();
  await page.locator('.research-context').waitFor();
  const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(`fractal.research.${key}`)!), riskKey);
  assert.equal(draft.context.text, native);
  assert.equal(draft.context.from, 'translation');
  assert.equal(draft.context.rect, undefined);
  assert.deepEqual(draft.context.provenance, { textSource: 'translated' });
  evidence.translated = { native, copied: native, quote: draft.context };
}
try {
  if (mode !== 'packaged') {
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: service.url });
    await open(page, service.url);
    await drag(page, start, end, 'browser-word', () => page.evaluate(() => navigator.clipboard.readText()));
    await drag(page, end - 1, start + 1, 'browser-partial-backward', () => page.evaluate(() => navigator.clipboard.readText()));
    await saveAndQuote(page, 'browser', () => page.evaluate(() => navigator.clipboard.readText()));
    if (mode !== 'before') await risks(page, service.url, () => page.evaluate(() => navigator.clipboard.readText()));
    await browser.close();
    browser = undefined;
  }
  await service.stop();
  serviceRunning = false;
  const executablePath =
    mode === 'packaged' ? join(root, 'dist/installer-selection-repair/win-unpacked/Fractal.exe') : join(root, 'node_modules/electron/dist/electron.exe');
  electron = await _electron.launch({
    executablePath,
    args: mode === 'packaged' ? [] : [root],
    env: { ...process.env, FRACTAL_DESKTOP_PROFILE: join(directory, 'electron-profile') },
    timeout: 60000,
  });
  ownedProcess = electron.process();
  evidence.ownedProcess = { pid: electron.process().pid, executablePath, args: electron.process().spawnargs, profile: join(directory, 'electron-profile') };
  const native = await electron.firstWindow();
  await native.waitForLoadState('domcontentloaded');
  evidence.runtimeIdentity = await electron.evaluate(({ app }) => ({
    pid: process.pid,
    executablePath: process.execPath,
    profile: app.getPath('userData'),
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    name: app.getName(),
  }));
  assert.equal(resolve(evidence.runtimeIdentity.executablePath).toLowerCase(), resolve(executablePath).toLowerCase());
  assert.equal(resolve(evidence.runtimeIdentity.profile), resolve(join(directory, 'electron-profile')));
  evidence.processIdentity = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${evidence.runtimeIdentity.pid}" | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8' },
    ),
  );
  evidence.listener = new URL(native.url()).origin;
  if (mode === 'packaged') {
    const assets = await electron.evaluate(({ app, nativeImage }) => ({
      windowIcon: nativeImage.createFromPath(app.getAppPath() + '/apps/desktop/assets/icon-256.png').getSize(),
      trayIcon: nativeImage.createFromPath(app.getAppPath() + '/apps/desktop/assets/icon-32.png').getSize(),
    }));
    assert.deepEqual(assets.windowIcon, { width: 256, height: 256 });
    assert.deepEqual(assets.trayIcon, { width: 32, height: 32 });
    assert.equal(evidence.runtimeIdentity.packaged, true);
    assert.ok(evidence.runtimeIdentity.appPath.endsWith('app.asar'));
    evidence.assets = assets;
    evidence.artifacts = [];
    for (const path of [
      'dist/installer-selection-repair/win-unpacked/Fractal.exe',
      'dist/installer-selection-repair/Fractal Setup 0.1.0.exe',
      'dist/installer-selection-repair/win-unpacked/resources/app.asar',
      'apps/desktop/assets/fractal.ico',
      'docs/implementation/design/assets/branch-master.svg',
    ]) {
      const bytes = await readFile(join(root, path));
      evidence.artifacts.push({ path: join(root, path), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await open(native, new URL(native.url()).origin);
  await drag(native, start, end, 'electron-word', () => electron!.evaluate(({ clipboard }) => clipboard.readText()));
  await drag(native, end - 1, start + 1, 'electron-partial-backward', () => electron!.evaluate(({ clipboard }) => clipboard.readText()));
  await saveAndQuote(native, 'electron', () => electron!.evaluate(({ clipboard }) => clipboard.readText()));
  evidence.status = 'passed';
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  if (browser) await browser.close();
  if (electron) {
    await electron.close();
    evidence.ownedProcessExited = ownedProcess?.exitCode !== null;
  }
  if (serviceRunning) await service.stop();
  evidence.resourceDisposition =
    'Owned browser/Electron closed, listener and SQLite stopped; isolated profile and evidence retained for independent QA; no user profiles or other processes touched';
  await writeFile(join(output, `${mode}.json`), JSON.stringify(evidence, null, 2));
}
console.log(`${mode}: academic coarse-run pointer and clipboard cases passed`);
