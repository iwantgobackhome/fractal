/** Actual built UI + real isolated hub and SQLite. Only provider generation is a controlled test double. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium, _electron, type Page } from 'playwright-core';
import { startService } from '../../../packages/hub/src/main';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import { extractPdf } from '../../../packages/hub/src/pdf/index';
import { translationPromptVersion } from '../../../packages/hub/src/translation/index';
import { ProviderRegistry } from '../../../packages/hub/src/ai/registry';
import type { AiProvider, CompleteInput } from '../../../packages/hub/src/ai/provider';
import type { Paper, ModelSelection } from '@fractal/shared';

const root = resolve(import.meta.dirname, '../../..'),
  output = join(root, 'docs/implementation/desktop/stage2');
const directory = await mkdtemp(join(tmpdir(), 'fractal-desktop-stage2-'));
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
process.env.NODE_ENV = 'test';
await mkdir(output, { recursive: true });
const choice: ModelSelection = { provider: 'codex', model: 'verification-model' };
let release: (() => void) | null = null;
const provider: AiProvider = {
  id: 'codex',
  async status() {
    return { id: 'codex', installed: true, loggedIn: true, version: 'fixture' };
  },
  async listModels() {
    return [{ id: choice.model, label: 'Verification model - isolated provider' }];
  },
  async usage() {
    return null;
  },
  async *complete(input: CompleteInput) {
    const question = input.messages[0]?.content ?? '';
    if (question.includes('Unavailable fixture')) throw Object.assign(new Error('Controlled unavailable model'), { code: 'MODEL_UNAVAILABLE' });
    yield { type: 'text', text: 'Controlled provider evidence: retained partial answer. ' };
    if (question.includes('Pending fixture'))
      await new Promise<void>((done) => {
        release = done;
        input.signal?.addEventListener('abort', done, { once: true });
      });
    else await new Promise((done) => setTimeout(done, 150));
    if (!input.signal?.aborted) yield { type: 'text', text: 'The final answer remains available after closing the panel. [p.1]' };
  },
};
const original = {
  select: ProviderRegistry.prototype.select,
  complete: ProviderRegistry.prototype.complete,
  info: ProviderRegistry.prototype.providersInfo,
  settings: ProviderRegistry.prototype.getSettings,
};
ProviderRegistry.prototype.select = async () => ({ provider, selection: choice });
ProviderRegistry.prototype.complete = async function* (_feature, input) {
  for await (const event of provider.complete({ ...input, model: choice.model })) yield event;
};
ProviderRegistry.prototype.providersInfo = async () => [{ status: await provider.status(), models: await provider.listModels() }];
ProviderRegistry.prototype.getSettings = async () => ({ default: choice, overrides: {} });
let running = true;
let service = await startService({
  dataDirectory: directory,
  port: 0,
  indexHtml: join(root, 'packages/ui/dist/index.html'),
  allowRealCli: false,
  startBackground: false,
  log: () => {},
});
let store = service.store as SqlitePaperStore;
store.putPreferences({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: service.url });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const results: Record<string, unknown> = {
  isolation: 'Fresh temp database and browser profile; no user data touched',
  provider: 'Only AiProvider boundary is controlled; actual history HTTP/SSE/SQLite and PDF.js rendering',
  screenshots: [],
  geometry: [],
};
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
async function paper(pdf: Buffer, title: string, status: Paper['status'] = 'ready') {
  const sourceUrl = 'https://example.org/verification/' + hash(pdf) + '.pdf',
    key = `pdf-${hash(sourceUrl)}-${hash(pdf)}`;
  const extraction = await extractPdf(pdf, key);
  const record: Paper = {
    paperKey: key,
    sourceKind: 'publication',
    arxivId: null,
    version: null,
    title,
    authors: ['Verification author'],
    sourceUrl,
    pdfSha256: hash(pdf),
    pageCount: extraction.coverage.totalPages,
    extractionVersion: extraction.extractionVersion,
    status,
    coverage: extraction.coverage,
    createdAt: new Date().toISOString(),
  };
  store.savePaper(record, pdf);
  store.saveBlocks(key, extraction.blocks);
  for (const block of extraction.blocks.filter((b) => b.translatable))
    store.saveTranslation(key, {
      blockId: block.blockId,
      sourceHash: block.sourceHash,
      modelId: 'verification-model',
      promptVersion: translationPromptVersion('ko'),
      status: 'completed',
      text: '실제 저장된 번역 검증 문장: 원본의 비례 문자 폭과 두 열의 읽기 순서를 확인합니다. 이 번역문을 선택하고 복사하거나 질문에 인용할 수 있습니다.',
      error: null,
      completedAt: new Date().toISOString(),
    });
  return key;
}
async function open(key: string, target: Page = page) {
  const url = service.url + '/#/paper/' + encodeURIComponent(key);
  if (target.url() === url) await target.reload();
  else await target.goto(url);
  await target.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await target.waitForTimeout(400);
}
async function wait(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((d) => setTimeout(d, 100));
  }
  throw new Error('Persistent state did not settle');
}
async function closeSelection() {
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}
async function capture(name: string, target: Page = page) {
  await target.evaluate(() => document.fonts.ready);
  await target.screenshot({ path: join(output, name + '.png') });
}
async function charPoint(pageNumber: number, text: string, offset: number, target: Page = page) {
  return target.evaluate(
    ({ pageNumber, text, offset }) => {
      const span = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="text-layer-${pageNumber}"] span`)).find((s) => s.textContent === text);
      if (!span?.firstChild) throw new Error('Rendered span missing ' + text);
      const range = document.createRange();
      range.setStart(span.firstChild, offset);
      range.setEnd(span.firstChild, Math.min(offset + 1, text.length));
      const box = range.getBoundingClientRect();
      return { x: box.left + 0.8, y: box.top + box.height * 0.5, width: box.width, height: box.height };
    },
    { pageNumber, text, offset },
  );
}
async function dragText(pageNumber: number, text: string, start: number, end: number) {
  await closeSelection();
  const a = await charPoint(pageNumber, text, start),
    b = await charPoint(pageNumber, text, end);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  return page.evaluate(() => ({
    selected: window.getSelection()?.toString(),
    rects: Array.from(document.querySelectorAll<HTMLElement>('.selection-pending')).map((n) => ({
      page: n.closest<HTMLElement>('[data-page]')?.dataset.page,
      x: n.style.left,
      y: n.style.top,
      width: n.style.width,
      height: n.style.height,
    })),
  }));
}
async function zoomTo(zoom: number) {
  for (let i = 0; i < 14; i++) {
    const current = Number((await page.locator('[data-testid="zoom"]').textContent())?.replace('%', ''));
    if (current === zoom) break;
    await page.getByRole('button', { name: current < zoom ? 'Zoom in' : 'Zoom out', exact: true }).click();
  }
  await page.waitForTimeout(250);
}
async function pageTo(number: number) {
  await closeSelection();
  for (let i = 0; i < 8; i++) {
    const current = Number((await page.locator('[data-testid="page"]').textContent())?.split('/')[0]);
    if (current === number) break;
    await page.getByRole('button', { name: current < number ? 'Next page' : 'Previous page', exact: true }).click();
  }
  await page.locator(`[data-testid="text-layer-${number}"]`).waitFor();
  await page.waitForTimeout(350);
}
try {
  const pdf = await readFile(join(root, 'packages/hub/test/fixtures/text-layout.pdf'));
  const key = await paper(pdf, 'Character-level evidence for proportional text, Unicode and two-column scholarly reading');
  store.upsertAnnotation({
    id: randomUUID(),
    kind: 'ink',
    paperKey: key,
    page: 1,
    tool: 'pen',
    color: '#1C1B19',
    width: 0.0022,
    points: [
      [0.1, 0.4, 0.5, 0],
      [0.2, 0.41, 0.5, 20],
    ],
    updatedAt: new Date().toISOString(),
    deleted: false,
    rev: 0,
    deviceId: 'isolated-verification',
  });
  const scanPath = join(directory, 'image-only.pdf');
  const extracted = spawnSync(
    'python',
    [
      '-c',
      'from pypdf import PdfReader,PdfWriter; import sys; r=PdfReader(sys.argv[1]);w=PdfWriter();w.add_page(r.pages[3]);w.write(sys.argv[2])',
      join(root, 'packages/hub/test/fixtures/text-layout.pdf'),
      scanPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  const scan = await paper(await readFile(scanPath), 'Image-only original PDF: extraction honestly unavailable', 'unsupported');
  await open(key);
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  results.initial = { canvases: await page.locator('[data-testid="pdf-body"] canvas').count(), title: await page.locator('.reader-heading h1').textContent() };
  // Isolate source mode, then exercise real pointer drags at two zoom levels.
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  for (const zoom of [100, 150]) {
    for (let i = 0; i < 10; i++) {
      const current = Number((await page.locator('[data-testid="zoom"]').textContent())?.replace('%', ''));
      if (current === zoom) break;
      await page.getByRole('button', { name: current < zoom ? 'Zoom in' : 'Zoom out', exact: true }).click();
    }
    await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
    const geometry = await dragText(1, 'WWW iii wide thin', 1, 7);
    assert.equal(geometry.selected, 'WW iii');
    const first = geometry.rects[0];
    assert.ok(Number.parseFloat(first.width) < 30);
    (results.geometry as unknown[]).push({ zoom, ...geometry });
    await capture(`partial-range-${zoom}`);
    const backward = await dragText(1, 'WWW iii wide thin', 7, 1);
    assert.equal(backward.selected, 'WW iii');
  }
  await page.locator('.selection-menu').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.research-context').waitFor();
  assert.match((await page.locator('.research-context').textContent()) ?? '', /WW iii/);
  await page.locator('.research-panel textarea').fill('Pending fixture question with source quote');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await wait(() => store.listHistory(key).some((e) => e.status === 'running' && e.context.selectedText === 'WW iii'));
  const pending = store.listHistory(key)[0]!;
  assert.ok(pending.requestId);
  await page.getByRole('button', { name: 'Close research panel' }).click();
  assert.equal(store.getHistory(pending.id)?.status, 'running');
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator(`[data-history-id="${pending.id}"]`).waitFor();
  release?.();
  await wait(() => store.getHistory(pending.id)?.status === 'completed');
  const admitted = store.listHistory(key).length;
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(store.listHistory(key).length, admitted);
  results.idempotentReplay = true;
  await page.getByRole('button', { name: '+ New question', exact: true }).click();
  assert.equal(await page.locator('.research-panel textarea').inputValue(), '');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  assert.ok(await page.locator(`[data-history-id="${pending.id}"]`).isVisible());
  results.retainedQuestion = {
    id: pending.id,
    requestId: pending.requestId,
    page: pending.context.page,
    quote: pending.context.selectedText,
    status: store.getHistory(pending.id)?.status,
  };
  await capture('history-question');
  await open(scan);
  assert.equal(await page.locator('[data-testid="pdf-body"] canvas').count(), 1);
  assert.equal(await page.locator('.textLayer span').count(), 0);
  assert.equal(store.getPaper(scan)?.status, 'unsupported');
  await page.evaluate(() => {
    const text = document.querySelector('.reader-heading h1')!.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 0, text, 10);
  });
  await page.keyboard.press('Control+C');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Image-only');
  results.documentChangeClipboard = true;
  await page.getByRole('button', { name: 'Region', exact: true }).click();
  const box = await page.locator('.pdf-page').boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 100, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 280, { steps: 12 });
  await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.locator('.sticky-note textarea').fill('Complete image-only note body.\nSecond paragraph retained through collapse, movement and restart.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await wait(() => store.listAnnotations(scan).some((a) => a.kind === 'memo' && a.text.includes('Second paragraph')));
  const memo = store.listAnnotations(scan).find((a) => a.kind === 'memo')!;
  assert.equal(memo.kind, 'memo');
  const move = page.getByRole('button', { name: 'Move note; arrows move, Shift + arrows resize' });
  await move.focus();
  await page.keyboard.press('ArrowRight');
  await wait(() => store.listAnnotations(scan).some((a) => a.kind === 'memo' && a.rect?.x !== memo.rect?.x));
  await page.getByRole('button', { name: 'Collapse note', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen note', exact: true }).click();
  assert.match(await page.locator('.sticky-note textarea').inputValue(), /Second paragraph/);
  const color = page.getByRole('combobox', { name: 'Note color', exact: true });
  await color.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await wait(() => store.listAnnotations(scan).some((a) => a.kind === 'memo' && a.color === 'pink'));
  await move.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await wait(() => store.listAnnotations(scan).some((a) => a.kind === 'memo' && a.rect!.width > 0.32));
  const heading = await move.boundingBox();
  assert.ok(heading);
  await page.mouse.move(heading.x + 20, heading.y + 8);
  await page.mouse.down();
  await page.mouse.move(heading.x + 65, heading.y + 40, { steps: 10 });
  await page.mouse.up();
  await wait(() => store.listAnnotations(scan).some((a) => a.kind === 'memo' && a.rect!.x > memo.rect!.x + 0.025));
  const resized = store.listAnnotations(scan).find((a) => a.kind === 'memo');
  assert.ok(resized?.kind === 'memo' && resized.rect && resized.rect.x + resized.rect.width <= 1 && resized.rect.y + resized.rect.height <= 1);
  results.stickyMoveResizeColor = true;
  await page
    .locator('.sticky-note textarea')
    .fill('Complete image-only note body.\nSecond paragraph retained through collapse, movement and restart.\nAutosaved without an explicit Save click.');
  await wait(() => store.listAnnotations(scan).some((a) => a.kind === 'memo' && a.text.includes('Autosaved')));
  results.memoAutosave = true;
  await capture('image-only-sticky');
  results.scanned = {
    status: store.getPaper(scan)?.status,
    canvases: await page.locator('[data-testid="pdf-body"] canvas').count(),
    nativeTextSpans: await page.locator('.textLayer span').count(),
    memo: store.listAnnotations(scan).find((a) => a.kind === 'memo'),
  };
  // Complete memo persists after a full UI reload and paper change.
  await open(key);
  await open(scan);
  assert.match(await page.locator('.sticky-note textarea').inputValue(), /Second paragraph/);
  await page.getByRole('button', { name: 'Translation', exact: true }).click();
  await page.locator('.translation-unavailable').waitFor();
  assert.equal(await page.locator('.kr-text').count(), 0);
  await page.getByRole('button', { name: 'Original', exact: true }).first().click();
  // The normal product upload path must also retain a valid image-only original.
  await page.goto(service.url + '/#/library');
  await page.locator('.research-index').waitFor();
  await page.locator('input[type="file"]').last().setInputFiles(scanPath);
  await page.locator('[data-testid="pdf-body"] canvas').waitFor();
  await page.waitForTimeout(300);
  const uploadedKey = await page.evaluate(() => decodeURIComponent(location.hash.replace('#/paper/', '')));
  assert.equal(store.getPaper(uploadedKey)?.status, 'unsupported');
  assert.equal(await page.locator('.textLayer span').count(), 0);
  assert.ok(store.getPdf(uploadedKey));
  assert.equal(store.getLibrary(uploadedKey)?.saved, false);
  await page.getByRole('button', { name: 'Region', exact: true }).click();
  const uploadedBox = await page.locator('.pdf-page').boundingBox();
  assert.ok(uploadedBox);
  await page.mouse.move(uploadedBox.x + 500, uploadedBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(uploadedBox.x + 650, uploadedBox.y + 210, { steps: 10 });
  await page.mouse.up();
  await page.locator('.selection-menu').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.research-panel textarea').fill('Question about an image-only original region');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await wait(() => store.listHistory(uploadedKey).some((e) => e.status === 'completed'));
  results.uploadedScan = {
    status: store.getPaper(uploadedKey)?.status,
    saved: store.getLibrary(uploadedKey)?.saved,
    textSpans: 0,
    context: store.listHistory(uploadedKey)[0]?.context,
  };
  await capture('image-only-upload-question');
  // Two-column order uses real printed text, then a saved highlight must not intercept a drag.
  await open(key);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await page.getByRole('button', { name: 'T', exact: true }).click();
  assert.equal(await page.locator('[data-testid="pdf-body"] .ink-layer path').count(), 1);
  results.inkVisibleDuringTextSelection = true;
  await zoomTo(100);
  await closeSelection();
  let a = await charPoint(1, 'Left 1 alpha prose words', 5),
    b = await charPoint(1, 'Left 3 alpha prose words', 6);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  const leftSelection = await page.evaluate(() => window.getSelection()?.toString());
  results.columnDiagnostic = { leftSelection, spans: await page.locator('[data-testid="text-layer-1"] span').allTextContents() };
  assert.ok(leftSelection?.includes('Left 2'));
  assert.ok(!leftSelection?.includes('Right'));
  results.columnSelection = leftSelection;
  await capture('column-range');
  await closeSelection();
  a = await charPoint(1, 'Left 2 alpha prose words', 5);
  b = await charPoint(1, 'Right 2 beta prose words', 8);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  const columnOrder = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  assert.ok(columnOrder.indexOf('Left 3') < columnOrder.indexOf('Right 1'));
  results.columnOrder = columnOrder;
  await dragText(1, 'WWW iii wide thin', 1, 7);
  await page.getByRole('button', { name: 'Yellow highlight', exact: true }).click();
  await wait(() => store.listHighlights(key).length > 0);
  await page.locator('.highlight-marker').first().waitFor();
  const throughHighlight = await dragText(1, 'WWW iii wide thin', 2, 6);
  assert.equal(throughHighlight.selected, 'W ii');
  results.dragOverHighlight = throughHighlight;
  const adjacent = await dragText(1, 'WWW iii wide thin', 8, 12);
  assert.equal(adjacent.selected, 'wide');
  results.dragAdjacentToHighlight = adjacent;
  const clipboardCases: unknown[] = [];
  const checkClipboard = async (name: string) => {
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    assert.ok(selected.trim(), name + ' must select actual text');
    await page.keyboard.press('Control+C');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    if (name === 'Control+A') {
      // Browser document-copy also includes input placeholder text, unlike Selection.toString().
      assert.match(copied, /Fractal/);
      assert.match(copied, /Character-level evidence/);
      assert.match(copied, /Left 3 alpha prose words/);
      assert.match(copied, /Right 3 beta prose words/);
    } else assert.equal(copied.replace(/\s/g, ''), selected.replace(/\s/g, ''), name + ' must copy the current native range');
    clipboardCases.push({ name, selected, copied });
  };
  // Immediate copy after browser keyboard defaults must never reuse the previous drag.
  await page.keyboard.press('Shift+ArrowLeft');
  await checkClipboard('Shift+ArrowLeft');
  await page.keyboard.press('Shift+Home');
  await checkClipboard('Shift+Home');
  await page.keyboard.press('Shift+End');
  await checkClipboard('Shift+End');
  await closeSelection();
  const word = await charPoint(1, 'WWW iii wide thin', 14);
  await page.mouse.click(word.x, word.y, { clickCount: 2 });
  await checkClipboard('double click');
  await page.mouse.click(word.x, word.y, { clickCount: 3 });
  await checkClipboard('triple click');
  await page.keyboard.press('Control+A');
  await checkClipboard('Control+A');
  // A new DOM range without pointerup/keyup must also bypass an outdated cache.
  await page.evaluate(() => {
    const node = Array.from(document.querySelectorAll('[data-testid="text-layer-1"] span')).find((n) => n.textContent === 'WWW iii wide thin')!.firstChild!;
    window.getSelection()!.setBaseAndExtent(node, 0, node, 3);
  });
  await checkClipboard('range replacement');
  results.nativeClipboardSynchronization = clipboardCases;
  await closeSelection();
  await page.locator('.highlight-marker').first().click();
  await page.locator('.highlight-popover').waitFor();
  await page.keyboard.press('Escape');
  // Intrinsic rotation is applied exactly once to native TextLayer, without migrating old rectangles.
  await pageTo(2);
  const rotated = await dragText(2, 'Rotated crop WWW iii', 2, 10);
  assert.ok((rotated.selected?.length ?? 0) < 20);
  (results.geometry as unknown[]).push({ page: 2, rotation: 90, crop: [60, 80, 560, 720], ...rotated });
  await capture('rotated-crop-range');
  await pageTo(3);
  const angled = await dragText(3, 'Angled WWW iii', 2, 8);
  assert.ok((angled.selected?.length ?? 0) < 13);
  (results.geometry as unknown[]).push({ page: 3, angle: 30, crop: [30, 40, 550, 730], ...angled });
  await capture('angled-range');
  // Unicode runs are linked to authoritative grapheme/ligature boundaries.
  await pageTo(5);
  await page.locator('[data-testid="text-layer-5"] span[data-boundaries]').first().waitFor();
  results.unicode = await page
    .locator('[data-testid="text-layer-5"] span[data-boundaries]')
    .evaluateAll((nodes) => nodes.map((n) => ({ text: n.textContent, boundaries: (n as HTMLElement).dataset.boundaries })));
  assert.ok(JSON.stringify(results.unicode).includes('😀'));
  await capture('unicode-source');
  // Cross-page drag with the start page retained and only a bounded canvas window.
  await pageTo(1);
  await closeSelection();
  a = await charPoint(1, 'Left 3 alpha prose words', 5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const scrollStart = await page.locator('[data-testid="pdf-body"]').evaluate((node) => node.scrollTop);
  const scrollBox = await page.locator('[data-testid="pdf-body"]').boundingBox();
  assert.ok(scrollBox);
  await page.mouse.move(a.x, scrollBox.y + scrollBox.height - 4, { steps: 5 });
  await page.waitForFunction((start) => document.querySelector('[data-testid="pdf-body"]')!.scrollTop > start + 100, scrollStart);
  results.dragAutoScroll = { before: scrollStart, after: await page.locator('[data-testid="pdf-body"]').evaluate((node) => node.scrollTop) };
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="pdf-body"]')!,
      target = root.querySelector<HTMLElement>('[data-page="2"]')!;
    root.scrollTop = target.offsetTop;
  });
  await page.waitForTimeout(250);
  b = await charPoint(2, 'Rotated crop WWW iii', 7);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  results.crossDiagnostic = await page.evaluate(() => {
    const s = window.getSelection();
    return {
      text: s?.toString(),
      start: s?.anchorNode?.parentElement?.outerHTML,
      focus: s?.focusNode?.parentElement?.outerHTML,
      offsets: [s?.anchorOffset, s?.focusOffset],
    };
  });
  await page.locator('.selection-menu').waitFor();
  const pages = await page
    .locator('.selection-pending')
    .evaluateAll((nodes) => [...new Set(nodes.map((n) => n.closest<HTMLElement>('[data-page]')?.dataset.page))]);
  assert.deepEqual(pages, ['1', '2']);
  results.crossPage = { pages, canvases: await page.locator('[data-testid="pdf-body"] canvas').count() };
  assert.ok(Number((results.crossPage as { canvases: number }).canvases) <= 4);
  await capture('cross-page-range');
  await page.keyboard.press('Control+C');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /\[p\.1\]/);
  assert.match(copied, /\[p\.2\]/);
  results.crossPageCopy = copied;
  await closeSelection();
  // A real five-page range crosses unmounted intermediate text pages and an image-only page.
  await pageTo(1);
  a = await charPoint(1, 'Left 3 alpha prose words', 5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="pdf-body"]')!;
    root.scrollTop = root.querySelector<HTMLElement>('[data-page="5"]')!.offsetTop;
  });
  await page.locator('[data-testid="text-layer-5"] span[data-boundaries]').first().waitFor();
  await page.waitForTimeout(250);
  const finalRun = await page.locator('[data-testid="text-layer-5"] span[data-boundaries]').first().textContent();
  assert.ok(finalRun);
  b = await charPoint(5, finalRun, Math.min(4, finalRun.length - 1));
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.locator('.selection-menu').waitFor();
  await page.keyboard.press('Control+C');
  const gapCopy = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(gapCopy, /\[p\.1\]/);
  assert.match(gapCopy, /\[p\.2\] Rotated crop/);
  assert.match(gapCopy, /\[p\.3\] Angled/);
  assert.match(gapCopy, /\[p\.5\]/);
  assert.ok(!gapCopy.includes('Page 4'));
  const gapCanvases = await page.locator('[data-testid="pdf-body"] canvas').count();
  assert.ok(gapCanvases <= 4);
  results.virtualGapSelection = { physicalPages: [1, 2, 3, 4, 5], canvases: gapCanvases, copied: gapCopy };
  await capture('cross-virtual-gap');
  await closeSelection();
  // Actual translated text remains ordinarily selectable and has no original position anchor.
  await pageTo(1);
  await page.getByRole('button', { name: 'Translation', exact: true }).click();
  await page.locator('.kr-text').first().waitFor();
  const translated = page.locator('.kr-text').first();
  const translatedPoints = await translated.evaluate((node) => {
    const text = node.firstChild!;
    const points = [0, 12].map((offset: number) => {
      const r = document.createRange();
      r.setStart(text, offset);
      r.setEnd(text, offset + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + 0.8, y: b.top + b.height / 2 };
    });
    return { start: points[0], end: points[1], expected: text.textContent!.slice(0, 12) };
  });
  await page.mouse.move(translatedPoints.start.x, translatedPoints.start.y);
  await page.mouse.down();
  await page.mouse.move(translatedPoints.end.x, translatedPoints.end.y, { steps: 12 });
  await page.mouse.up();
  const selectedTranslation = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  assert.ok(selectedTranslation.startsWith(translatedPoints.expected));
  assert.ok((await translated.textContent())?.startsWith(selectedTranslation));
  await page.keyboard.press('Control+C');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selectedTranslation);
  results.translatedDragCopy = { selected: selectedTranslation, copied: true };
  await page.locator('.quote-button').waitFor();
  await page.locator('.quote-button').click();
  await page.locator('.research-context').waitFor();
  assert.match((await page.locator('.research-context').textContent()) ?? '', /Translated passage/);
  await page.locator('.research-panel textarea').fill('Question with translated context');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await wait(() => store.listHistory(key).some((e) => e.question === 'Question with translated context' && e.status === 'completed'));
  const translatedHistory = store.listHistory(key).find((e) => e.question === 'Question with translated context')!;
  assert.ok(translatedHistory.context.selectedText?.startsWith('[Translated text'));
  assert.equal(translatedHistory.context.rect, undefined);
  results.translatedQuote = translatedHistory.context;
  // Selected text explanations persist in the same archive, with physical page and region.
  await page.getByRole('button', { name: 'Close research panel' }).click();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await zoomTo(100);
  await dragText(1, 'WWW iii wide thin', 1, 7);
  await page.locator('.selection-menu').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('button', { name: 'Explain selection', exact: true }).click();
  await wait(() => store.listHistory(key).some((e) => e.kind === 'explanation' && e.status === 'completed'));
  results.textExplanation = store.listHistory(key).find((e) => e.kind === 'explanation')?.context;
  // Real structure detector on the rendered original figure fixture.
  const figure = await paper(await readFile(join(root, 'packages/hub/test/fixtures/structure.pdf')), 'Rendered figure and equation context');
  await open(figure);
  await page.getByRole('button', { name: 'Explain Figure 1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Explain Figure 1', exact: true }).click();
  await page.getByRole('button', { name: 'Explain selection', exact: true }).click();
  await wait(() => store.listHistory(figure).some((e) => e.context.explanationKind === 'figure' && e.status === 'completed'));
  results.figureExplanation = store.listHistory(figure).find((e) => e.kind === 'explanation')?.context;
  results.translatedHeading = await page
    .locator('.kr-heading')
    .first()
    .evaluate((heading) => {
      const page = heading.closest<HTMLElement>('.kr-page')!,
        pane = heading.closest<HTMLElement>('.pane-body')!;
      const range = document.createRange();
      range.selectNodeContents(heading);
      const lines = [...range.getClientRects()],
        box = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      return {
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        lineCount: lines.length,
        contentFitsPage: lines.every((line) => line.right <= box.right + 1 && line.left >= box.left - 1),
        pageWidth: page.getBoundingClientRect().width,
        paneWidth: pane.clientWidth,
        paneOverflow: getComputedStyle(pane).overflowX,
      };
    });
  const headingResult = results.translatedHeading as {
    whiteSpace: string;
    textOverflow: string;
    lineCount: number;
    contentFitsPage: boolean;
    paneOverflow: string;
  };
  assert.equal(headingResult.whiteSpace, 'pre-wrap');
  assert.notEqual(headingResult.textOverflow, 'ellipsis');
  assert.ok(headingResult.lineCount > 1 && headingResult.contentFitsPage);
  assert.equal(headingResult.paneOverflow, 'auto');
  await page
    .locator('.kr-heading')
    .first()
    .evaluate((heading) => {
      const pane = heading.closest<HTMLElement>('.pane-body')!;
      pane.scrollLeft = pane.scrollWidth - pane.clientWidth;
    });
  await page.waitForTimeout(100);
  const finalCharacterVisible = await page
    .locator('.kr-heading')
    .first()
    .evaluate((heading) => {
      const node = heading.firstChild!,
        range = document.createRange();
      range.setStart(node, node.textContent!.length - 1);
      range.setEnd(node, node.textContent!.length);
      const text = range.getBoundingClientRect(),
        pane = heading.closest('.pane-body')!.getBoundingClientRect();
      return text.left >= pane.left && text.right <= pane.right;
    });
  assert.ok(finalCharacterVisible, 'Horizontal page scrolling must recover the translated heading end');
  results.translatedHeadingEndRecovered = true;
  await capture('figure-heading-end');
  // Fit both physical pages inside their narrowed split panes for the explanatory screenshot.
  for (let i = 0; i < 10; i++) {
    if (
      await page
        .locator('.kr-page')
        .first()
        .evaluate((node) => node.getBoundingClientRect().width + 24 <= node.closest<HTMLElement>('.pane-body')!.clientWidth)
    )
      break;
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page
    .locator('.kr-heading')
    .first()
    .evaluate((node) => {
      node.closest<HTMLElement>('.pane-body')!.scrollLeft = 0;
    });
  await capture('figure-explanation');
  // Archived filters and keyboard selectors preserve every record.
  await open(key);
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  const before = store.listHistory(key).length;
  const filter = page.getByRole('combobox', { name: 'History kind', exact: true });
  await filter.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  assert.equal(await filter.getAttribute('aria-expanded'), 'false');
  assert.equal(await filter.evaluate((n) => n === document.activeElement), true);
  assert.equal(store.listHistory(key).length, before);
  assert.equal(await page.locator('.history-entry').count(), 1);
  results.filterCount = { before, after: store.listHistory(key).length };
  await filter.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await filter.click();
  await page.keyboard.press('Escape');
  assert.equal(await filter.evaluate((n) => n === document.activeElement), true);
  // Preserve failed drafts, and explicit cancellation differs from closure.
  await page.getByRole('tab', { name: 'Ask', exact: true }).click();
  await page.getByRole('button', { name: '+ New question', exact: true }).click();
  await page.locator('.research-panel textarea').fill('Unavailable fixture: retain this draft');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await wait(() => store.listHistory(key).some((e) => e.error?.code === 'MODEL_UNAVAILABLE'));
  await open(key);
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  assert.equal(await page.locator('.research-panel textarea').inputValue(), 'Unavailable fixture: retain this draft');
  results.failedDraft = true;
  await page.getByRole('button', { name: '+ New question', exact: true }).click();
  await page.locator('.research-panel textarea').fill('Pending fixture: explicit cancel');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await wait(() => store.listHistory(key).some((e) => e.question === 'Pending fixture: explicit cancel' && e.status === 'canceled'));
  results.explicitCancel = true;
  release?.();
  // Paper switch keeps pending work; restart marks unfinished generation as interruption, retaining context.
  await page.getByRole('button', { name: '+ New question', exact: true }).click();
  await page.locator('.research-panel textarea').fill('Pending fixture: restart with retained partial answer');
  await page.locator('.research-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  await wait(() => store.listHistory(key).some((e) => e.question.includes('restart with') && e.status === 'running'));
  const restartEntry = store.listHistory(key).find((e) => e.question.includes('restart with'))!;
  await open(scan);
  assert.equal(store.getHistory(restartEntry.id)?.status, 'running');
  await open(key);
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator(`[data-history-id="${restartEntry.id}"]`).waitFor();
  const port = Number(new URL(service.url).port);
  await service.stop();
  running = false;
  service = await startService({
    dataDirectory: directory,
    port,
    indexHtml: join(root, 'packages/ui/dist/index.html'),
    allowRealCli: false,
    startBackground: false,
    log: () => {},
  });
  running = true;
  store = service.store as SqlitePaperStore;
  await open(key);
  await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator(`[data-history-id="${restartEntry.id}"]`).waitFor();
  assert.equal(store.getHistory(restartEntry.id)?.status, 'failed');
  assert.match(store.getHistory(restartEntry.id)?.text ?? '', /retained partial/);
  results.restart = store.getHistory(restartEntry.id);
  await open(scan);
  assert.match(await page.locator('.sticky-note textarea').inputValue(), /Second paragraph/);
  results.memoRestart = true;
  // Actual product screenshot matrix, using stored long titles and translated paragraphs.
  for (const language of ['en', 'ko'] as const) {
    const title =
      language === 'ko'
        ? '원본 논문의 비례 문자 폭과 여러 페이지에 걸친 선택 범위, 연구 질문의 근거 및 오래 보존되는 메모를 검증하는 긴 한국어 연구 제목'
        : 'A deliberately long scholarly research title examining proportional character selection across physical PDF pages, retained question provenance, and persistent original-page notes';
    store.savePaper({ ...store.getPaper(key)!, title }, pdf);
    store.putPreferences({ uiLanguage: language, translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true });
    for (const theme of ['light', 'dark', 'sepia'])
      for (const [width, height] of [
        [1280, 800],
        [1440, 900],
        [1920, 1080],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(service.url + '/#/library');
        await page.evaluate((theme) => localStorage.setItem('fractal.theme', theme), theme);
        await page.reload();
        await open(key);
        await page
          .locator('.reader-bar')
          .getByRole('button', { name: language === 'ko' ? '질문' : 'Ask', exact: true })
          .click();
        await page.getByRole('tab', { name: language === 'ko' ? '기록' : 'History', exact: true }).click();
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => document.documentElement.lang), language);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
        const name = `reader-${language}-${theme}-${width}x${height}`;
        await capture(name);
        (results.screenshots as unknown[]).push({
          name,
          width,
          height,
          language,
          theme,
          overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        });
      }
  }
  // Native Electron restart reads the same isolated persistent annotations/history.
  await service.stop();
  running = false;
  const electron = await _electron.launch({
    args: [root],
    env: { ...process.env, FRACTAL_DESKTOP_PROFILE: join(directory, 'electron-profile') },
    timeout: 60000,
  });
  try {
    const native = await electron.firstWindow();
    await native.waitForLoadState('domcontentloaded');
    await native.goto(native.url().split('#')[0] + '#/paper/' + encodeURIComponent(scan));
    await native.locator('[data-testid="pdf-body"] canvas').waitFor();
    await native.locator('.sticky-note textarea').waitFor();
    assert.match(await native.locator('.sticky-note textarea').inputValue(), /Second paragraph/);
    await capture('electron-scan-note', native);
    await native.goto(native.url().split('#')[0] + '#/paper/' + encodeURIComponent(key));
    await native.locator('.reader-bar__action[aria-controls="paper-chat"]').last().click();
    await native.getByRole('tab', { name: '기록', exact: true }).click();
    await native.locator(`[data-history-id="${pending.id}"]`).waitFor();
    assert.match((await native.locator(`[data-history-id="${pending.id}"]`).textContent()) ?? '', /final answer/);
    results.electron = { originalCanvas: true, completeMemo: true, retainedHistory: true, profile: 'isolated temporary profile' };
    await native.getByRole('button', { name: '연구 패널 닫기' }).click();
    await native.locator('.reader-bar__views button').first().click();
    await native.getByRole('button', { name: 'T', exact: true }).click();
    await native.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
    await native.evaluate(() => document.fonts.ready);
    await native.waitForTimeout(400);
    const start = await charPoint(1, 'WWW iii wide thin', 1, native),
      end = await charPoint(1, 'WWW iii wide thin', 7, native);
    await native.mouse.move(start.x, start.y);
    await native.mouse.down();
    await native.mouse.move(end.x, end.y, { steps: 12 });
    await native.mouse.up();
    await native.locator('.selection-menu').waitFor();
    assert.equal(await native.evaluate(() => window.getSelection()?.toString()), 'WW iii');
    await native.keyboard.press('Control+C');
    assert.equal(await electron.evaluate(({ clipboard }) => clipboard.readText()), 'WW iii');
    await native.keyboard.press('Shift+ArrowLeft');
    const changed = await native.evaluate(() => window.getSelection()?.toString());
    assert.notEqual(changed, 'WW iii');
    await native.keyboard.press('Control+C');
    assert.equal(await electron.evaluate(({ clipboard }) => clipboard.readText()), changed);
    results.electronNativeDragAndKeyboardCopy = true;
    await native.goto(native.url().split('#')[0] + '#/paper/' + encodeURIComponent(scan));
    await native.locator('.sticky-note textarea').waitFor();
    await native.locator('.reader-bar').getByRole('button', { name: '노트', exact: true }).click();
    await native.getByRole('button', { name: '원본 페이지에 메모 추가', exact: true }).click();
    await native.waitForFunction(() => document.querySelectorAll('.sticky-note').length === 2);
    native.once('dialog', (dialog) => void dialog.accept());
    await native.locator('.sticky-note').last().getByRole('button', { name: '메모 삭제', exact: true }).click();
    await native.waitForFunction(() => document.querySelectorAll('.sticky-note').length === 1);
    await native.waitForTimeout(250);
    await native.reload();
    await native.locator('.sticky-note textarea').waitFor();
    assert.equal(await native.locator('.sticky-note').count(), 1);
    assert.match(await native.locator('.sticky-note textarea').inputValue(), /Autosaved/);
    results.explicitMemoDelete = true;
  } finally {
    await electron.close();
  }
  results.errors = errors;
  assert.deepEqual(errors, []);
  results.status = 'passed';
  await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2));
} catch (error) {
  results.failure = String(error);
  results.errors = errors;
  await capture('failure').catch(() => {});
  await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2));
  throw error;
} finally {
  release?.();
  await browser.close();
  if (running) await service.stop();
  Object.assign(ProviderRegistry.prototype, {
    select: original.select,
    complete: original.complete,
    providersInfo: original.info,
    getSettings: original.settings,
  });
  const safe = resolve(directory);
  assert.ok(safe.startsWith(resolve(tmpdir()) + sep) && safe.split(sep).at(-1)?.startsWith('fractal-desktop-stage2-'));
  await rm(safe, { recursive: true, force: true });
}
