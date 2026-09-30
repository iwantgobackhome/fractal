/** Real loopback hub + built React UI; all bibliography/PDF data live in a fresh temp directory. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { chromium, _electron, type Page } from 'playwright-core';
import { startService } from '../../../packages/hub/src/main';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import { extractPdf } from '../../../packages/hub/src/pdf/index';
import type { LibraryRecord, Paper } from '@fractal/shared';

const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, 'docs/implementation/desktop/stage1');
const directory = await mkdtemp(join(tmpdir(), 'fractal-desktop-stage1-'));
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
process.env.NODE_ENV = 'test';
await mkdir(output, { recursive: true });
const service = await startService({
  dataDirectory: directory,
  port: 0,
  indexHtml: join(root, 'packages/ui/dist/index.html'),
  allowRealCli: false,
  startBackground: false,
  log: () => {},
});
const store = service.store as SqlitePaperStore;
store.putPreferences({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true });
const browser = await chromium.launch({
  executablePath: process.env.FRACTAL_REVIEW_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const exceptions: string[] = [];
page.on('pageerror', (error) => exceptions.push(error.message));
const results: Record<string, unknown> = { isolation: 'fresh temp FRACTAL_DATA and empty PAPERREAD_DATA; no user library reset', screenshots: [] };
const captures = results.screenshots as Record<string, unknown>[];
function verificationPdf(suffix = ''): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let page = 1; page <= 3; page++) {
    const pageId = 4 + (page - 1) * 2;
    const stream = `BT /F1 22 Tf 50 735 Td (Desktop verification document${suffix}) Tj ET\nBT /F1 15 Tf 50 680 Td (Page ${page}: source evidence retained during library edits.) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let text = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(service.url + path, {
    method,
    headers: { origin: service.url, 'x-paperread-token': service.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload.data;
}
async function screenshot(name: string, target: Page = page) {
  await target.evaluate(() => document.fonts.ready);
  await target.screenshot({ path: join(output, name + '.png') });
}
async function index() {
  const url = service.url + '/#/library';
  if (page.url() === url) await page.reload();
  else await page.goto(url);
  await page.locator('.research-index').waitFor();
  await page.waitForFunction(() => !document.querySelector('.research-list[aria-busy="true"]'));
}
async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await page.waitForTimeout(100);
  }
  assert.ok(check(), 'Persisted state did not converge');
}
async function createFolder(name: string, parent?: string) {
  if (parent) {
    await page.getByRole('button', { name: `Folder actions: ${parent}`, exact: true }).click();
    await page.getByRole('button', { name: 'New child folder', exact: true }).click();
  } else await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Folder name').fill(name);
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  return store.listFolders().find((folder) => folder.name === name)!;
}
try {
  await index();
  await page.getByText('Your saved research starts here.').waitFor();
  await screenshot('empty-saved-en-1440x900');
  const pdf = verificationPdf();
  const extraction = await extractPdf(pdf, 'stage1-reference-01');
  const titles = [
    'Tracing a Research Argument Across Sources, Evidence and Revisions: An Extended English Title Used Only for Desktop Layout Verification',
    '긴 문맥에서 연구 근거와 인용을 함께 읽고 서로 다른 출처의 결과를 비교하는 방법: 한글 제목의 줄바꿈과 원문 연결을 확인하기 위한 검증용 연구 기록',
    'Reading Geometry and the Boundaries of Evidence',
    'Notes on Source Quality and Local Research Libraries',
    'Methods for Comparing Incomplete Publication Metadata',
  ];
  store.putFolder({ id: 'verification-methods', name: 'Research methods / 연구 방법', parentId: null });
  store.putFolder({ id: 'verification-sources', name: 'Sources and evidence', parentId: 'verification-methods' });
  store.putFolder({ id: 'verification-seminar', name: 'A long seminar folder name for keyboard and wrapping checks', parentId: null });
  const keys: string[] = [];
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  for (const [index, title] of titles.entries()) {
    const sourceUrl = `https://example.org/verification/stage1-reference-${index + 1}`;
    const key = `pdf-${hash(sourceUrl)}-${hash(pdf)}`;
    keys.push(key);
    const paper: Paper = {
      paperKey: key,
      sourceKind: 'publication',
      arxivId: null,
      version: null,
      title,
      authors: index === 4 ? [] : ['Mina Park', 'Alex Rivera'],
      sourceUrl,
      pdfSha256: hash(pdf),
      pageCount: extraction.coverage.totalPages,
      extractionVersion: extraction.extractionVersion,
      status: 'ready',
      coverage: extraction.coverage,
      createdAt: `2026-09-${String(25 + index).padStart(2, '0')}T09:00:00.000Z`,
    };
    store.savePaper(paper, pdf);
    store.saveBlocks(
      key,
      extraction.blocks.map((block) => ({ ...block, blockId: key + '-' + block.order, paperKey: key })),
    );
    store.patchLibrary(key, {
      saved: true,
      authors:
        index === 4
          ? []
          : [
              { given: 'Mina', family: 'Park' },
              { given: 'Alex', family: 'Rivera' },
            ],
      year: index === 4 ? null : 2026,
      venue: index === 4 ? null : 'Verification research note',
      abstract:
        index === 4
          ? null
          : 'Isolated verification data, shown through the real bibliography API. This record checks readable research summaries, source details, and persistent folder membership; it is never bundled with the product.',
      tags: ['verification', index % 2 ? '근거 추적' : 'source quality'],
      collections: index === 0 ? ['verification-methods', 'verification-sources', 'verification-seminar'] : ['verification-sources'],
      ...(index === 0 ? { lastReadAt: '2026-09-30T08:30:00.000Z', readProgress: { page: 2, scrollOffset: 0.25, fraction: 0.45 }, status: 'reading' } : {}),
    });
    // Simulate a legacy orphan, which later membership edits must retain unchanged.
    if (index === 0) {
      const record = store.getLibrary(key)!;
      store.db
        .prepare('UPDATE bibliography SET data=? WHERE paper_key=?')
        .run(JSON.stringify({ ...record, collections: [...record.collections, 'preserved-orphan'] }), key);
    }
  }
  await index();
  await page.locator('.research-entry').first().waitFor();
  // The imported paper is unread and unsaved, then becomes recent only when its PDF renders.
  const uploadBytes = verificationPdf(' uploaded');
  const upload = await fetch(service.url + '/api/papers/upload', {
    method: 'POST',
    headers: { origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/pdf' },
    body: uploadBytes,
  });
  const uploadResult = await upload.json();
  assert.equal(upload.ok, true, JSON.stringify(uploadResult));
  const unsavedKey = uploadResult.data.paper.paperKey;
  assert.equal(store.getLibrary(unsavedKey)?.saved, false);
  assert.equal(store.getLibrary(unsavedKey)?.lastReadAt, null);
  assert.equal(store.getLibrary(unsavedKey)?.readProgress, null);
  await index();
  await page.getByRole('button', { name: /^On this device/ }).click();
  const unsavedRow = page.locator(`[data-paper-key="${unsavedKey}"]`);
  await unsavedRow.locator('.research-title').click();
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await waitFor(() => !!store.getLibrary(unsavedKey)?.lastReadAt);
  assert.equal(store.getLibrary(unsavedKey)?.saved, false);
  await page.locator('[data-testid="pdf-body"]').evaluate((element) => {
    const second = element.querySelector('[data-page="2"]')!;
    element.scrollTop += second.getBoundingClientRect().top - element.getBoundingClientRect().top + 100;
  });
  await waitFor(() => (store.getLibrary(unsavedKey)?.readProgress?.page ?? 1) > 1);
  const originalProgress = store.getLibrary(unsavedKey)!.readProgress;
  const history = store.putHistory({
    id: randomUUID(),
    paperKey: unsavedKey,
    kind: 'question',
    question: 'Verification history retention',
    text: 'Retained answer fixture',
    status: 'completed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    requestId: null,
    context: {},
    answer: null,
    error: null,
    deleted: false,
    rev: 0,
    deviceId: 'verification',
  });
  const memo = {
    id: randomUUID(),
    paperKey: unsavedKey,
    kind: 'memo' as const,
    page: 1,
    text: 'Retained verification memo',
    rect: null,
    quote: null,
    updatedAt: new Date().toISOString(),
    deleted: false,
    rev: 0,
    deviceId: 'verification',
  };
  store.upsertAnnotation(memo);
  await page.getByRole('button', { name: 'Library', exact: true }).first().click();
  await page.getByRole('button', { name: /^Recently read/ }).click();
  await unsavedRow.locator('.entry-save').click();
  await waitFor(() => store.getLibrary(unsavedKey)?.saved === true);
  await unsavedRow.locator('.entry-save').click();
  await waitFor(() => store.getLibrary(unsavedKey)?.saved === false);
  assert.ok(store.getPdf(unsavedKey)?.equals(uploadBytes));
  assert.ok(store.listHistory(unsavedKey).some((entry) => entry.id === history.id));
  assert.ok(store.listAnnotations(unsavedKey).some((entry) => entry.id === memo.id));
  assert.deepEqual(store.getLibrary(unsavedKey)?.readProgress, originalProgress);
  const readBeforeResume = store.getLibrary(unsavedKey)!.lastReadAt!;
  await unsavedRow.locator('.entry-read').click();
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await waitFor(() => store.getLibrary(unsavedKey)!.lastReadAt! > readBeforeResume);
  assert.equal(store.getLibrary(unsavedKey)?.readProgress?.page, originalProgress?.page);
  assert.ok(Math.abs((store.getLibrary(unsavedKey)?.readProgress?.scrollOffset ?? 0) - (originalProgress?.scrollOffset ?? 0)) < 0.03);
  const actualResume = await page.locator('[data-testid="pdf-body"]').evaluate((body, page) => {
    const node = body.querySelector(`[data-page="${page}"]`)!;
    return (body.getBoundingClientRect().top - node.getBoundingClientRect().top) / node.getBoundingClientRect().height;
  }, originalProgress!.page);
  assert.ok(Math.abs(actualResume - (originalProgress?.scrollOffset ?? 0)) < 0.03, 'Actual PDF viewport resumes its saved page offset');
  await page.getByRole('button', { name: 'Library', exact: true }).first().click();
  results.readSaveUnsave = { passed: true, importedUnsaved: true, readCreatesRecent: true, pdfHistoryMemoProgressRetained: true, positionResumed: true };

  const parent = await createFolder('Stage1 parent');
  const child = await createFolder('Stage1 child', parent.name);
  const grandchild = await createFolder('Stage1 grandchild', child.name);
  await page.getByRole('button', { name: /^Saved papers/ }).click();
  const first = page.locator(`[data-paper-key="${keys[0]}"]`);
  await first.locator('.entry-organize').click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stage1 parent', { exact: true }).check();
  await dialog.getByLabel('Stage1 parent / Stage1 child', { exact: true }).check();
  await dialog.getByLabel('Tags', { exact: true }).fill('verification, retained, 한글 태그');
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(store.getLibrary(keys[0])?.collections.includes('preserved-orphan'));
  assert.ok(store.getLibrary(keys[0])?.collections.includes(parent.id));
  assert.ok(store.getLibrary(keys[0])?.collections.includes(child.id));
  await page.getByRole('button', { name: `Folder actions: ${child.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Rename or move folder', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Folder name').fill('Stage1 child renamed');
  await dialog.getByRole('combobox', { name: 'Parent folder' }).click();
  assert.equal(await page.getByRole('option', { name: /Stage1 child|Stage1 grandchild/ }).count(), 0, 'Self/descendant move forbidden');
  await page.getByRole('option', { name: 'Top level', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(store.getFolder(child.id)?.parentId, null);
  await page.getByRole('button', { name: 'Folder actions: Stage1 child renamed', exact: true }).click();
  await page.getByRole('button', { name: 'Remove folder', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove folder', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(store.getFolder(grandchild.id)?.parentId, null);
  assert.ok(store.getLibrary(keys[0])?.collections.includes(parent.id));
  assert.equal(store.getLibrary(keys[0])?.collections.includes(child.id), false);
  assert.ok(store.getPdf(keys[0]));
  const beforeFilter = JSON.stringify(store.listLibrary());
  await page.locator('.index-search input').fill('no matching paper');
  await page.getByText('No papers match these filters.').waitFor();
  await screenshot('filtered-empty-en-1440x900');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  assert.equal(JSON.stringify(store.listLibrary()), beforeFilter);
  results.folders = {
    passed: true,
    createNested: true,
    renameMove: true,
    excludesSelfAndDescendants: true,
    childPromotion: true,
    paperRetention: true,
    multipleMembership: true,
    orphanPreserved: true,
    filterDoesNotMutate: true,
  };

  // Keyboard focus and active-descendant semantics in the actual index.
  const sort = page.getByRole('combobox', { name: 'Sort papers', exact: true });
  await sort.focus();
  await sort.press('ArrowDown');
  await sort.press('End');
  assert.equal(await page.getByRole('option', { name: 'First added', exact: true }).getAttribute('data-active'), 'true');
  await sort.press('Home');
  await sort.press('ArrowDown');
  await sort.press('Enter');
  assert.equal(await sort.getAttribute('aria-expanded'), 'false');
  assert.equal(await sort.evaluate((element) => document.activeElement === element), true);
  await sort.press('ArrowUp');
  await sort.press('Escape');
  assert.equal(await sort.evaluate((element) => document.activeElement === element), true);
  await sort.click();
  await page.locator('#library-title').click();
  assert.equal(await sort.getAttribute('aria-expanded'), 'false');
  results.indexSelector = { passed: true, arrowsHomeEndEnter: true, escapeRestoresFocus: true, outsideClick: true };

  for (const language of ['ko', 'en'] as const) {
    await api('/api/preferences', { uiLanguage: language, translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }, 'PUT');
    for (const theme of ['light', 'dark', 'sepia']) {
      for (const [width, height] of [
        [1280, 800],
        [1440, 900],
        [1920, 1080],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate((theme) => localStorage.setItem('fractal.theme', theme), theme);
        await index();
        await page.locator('.research-entry').first().waitFor();
        await page.getByRole('combobox', { name: language === 'ko' ? '논문 정렬' : 'Sort papers', exact: true }).click();
        await page.getByRole('option', { name: language === 'ko' ? '추가한 순서' : 'First added', exact: true }).click();
        const measured = await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          theme: document.documentElement.dataset.theme,
          language: document.documentElement.lang,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          clippedTitles: [...document.querySelectorAll<HTMLElement>('.research-title')]
            .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
            .map((element) => element.textContent),
          titleLineHeights: [...document.querySelectorAll<HTMLElement>('.research-title')]
            .slice(0, 2)
            .map((element) => ({ height: element.clientHeight, lineHeight: parseFloat(getComputedStyle(element).lineHeight) })),
          reviewToolbar: !!document.querySelector('.review-bar'),
        }));
        assert.equal(measured.horizontalOverflow, false);
        assert.deepEqual(measured.clippedTitles, []);
        assert.equal(measured.reviewToolbar, false);
        const name = `index-${language}-${theme}-${width}x${height}`;
        await screenshot(name);
        captures.push({ file: name + '.png', ...measured });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('/api/preferences', { uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }, 'PUT');
  await index();
  await page.route('**/api/library', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Verification: hub temporarily unavailable' } }) }),
  );
  await page.reload();
  await page.getByText('Verification: hub temporarily unavailable').waitFor();
  await screenshot('error-retry-en-1440x900');
  await page.unroute('**/api/library');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.research-entry').first().waitFor();
  let release!: () => void;
  const delayed = new Promise<void>((done) => (release = done));
  await page.route('**/api/library', async (route) => {
    await delayed;
    await route.continue().catch(() => undefined);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Loading the research index…').waitFor();
  await screenshot('loading-en-1440x900');
  release();
  await page.locator('.research-entry').first().waitFor();
  await page.unroute('**/api/library');
  await page.getByRole('button', { name: 'Appearance & connections', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
  await screenshot('settings-selector-en-1440x900');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).press('Escape');
  results.states = { actualEmptySaved: true, filteredEmpty: true, loadingDelayedRealRequest: true, injected503RetryRecovered: true };
  assert.deepEqual(exceptions, []);
  results.browserExceptions = exceptions;

  // Real Electron renderer and native image creation; separate profile avoids the user's launcher/session lock.
  const electron = await _electron.launch({
    args: [root],
    env: { ...process.env, FRACTAL_DESKTOP_PROFILE: join(directory, 'electron-profile') },
    timeout: 60_000,
  });
  try {
    const window = await electron.firstWindow();
    await window.goto((await window.evaluate(() => location.origin)) + '/#/library');
    await window.locator('.research-entry').first().waitFor();
    const identity = await electron.evaluate(({ app, nativeImage, BrowserWindow }) => {
      const assets = app.getAppPath() + '/apps/desktop/assets';
      return {
        name: app.getName(),
        windows: BrowserWindow.getAllWindows().length,
        windowIcon: nativeImage.createFromPath(assets + '/icon-256.png').getSize(),
        trayIcon: nativeImage.createFromPath(assets + '/icon-32.png').getSize(),
      };
    });
    assert.equal(identity.name, 'Fractal');
    assert.deepEqual(identity.windowIcon, { width: 256, height: 256 });
    assert.deepEqual(identity.trayIcon, { width: 32, height: 32 });
    await screenshot('electron-index-en', window);
    await window.getByRole('button', { name: /^On this device/ }).click();
    const electronRow = window.locator(`[data-paper-key="${unsavedKey}"]`);
    await electronRow.locator('.entry-save').click();
    await waitFor(() => store.getLibrary(unsavedKey)?.saved === true);
    await electronRow.locator('.entry-save').click();
    await waitFor(() => store.getLibrary(unsavedKey)?.saved === false);
    const electronSort = window.getByRole('combobox', { name: 'Sort papers', exact: true });
    await electronSort.focus();
    await electronSort.press('ArrowDown');
    await electronSort.press('End');
    await electronSort.press('Escape');
    assert.equal(await electronSort.evaluate((element) => document.activeElement === element), true);
    await electronRow.locator('.entry-read').click();
    await window.locator('[data-testid="pdf-body"] canvas').first().waitFor();
    assert.equal(store.getLibrary(unsavedKey)?.saved, false);
    results.electron = {
      passed: true,
      ...identity,
      screenshot: 'electron-index-en.png',
      saveUnsave: true,
      readerRoute: true,
      selectorFocusKeyboard: true,
      nativeLauncherVisual: 'not inspected by this renderer capture',
    };
  } finally {
    await electron.close();
  }
  results.passed = true;
} catch (error) {
  results.passed = false;
  results.error = String(error);
  results.browserExceptions = exceptions;
  await screenshot('failure').catch(() => undefined);
  throw error;
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2));
  await browser.close();
  await service.stop();
  assert.ok(directory.startsWith(resolve(tmpdir()) + sep + 'fractal-desktop-stage1-'));
  await rm(directory, { recursive: true, force: true });
}
console.log('Stage1 isolated hub/browser/Electron verification passed; report: docs/implementation/desktop/stage1/verification.json');
