/** Own isolated application/cache gates using downloaded public PDF bytes. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, _electron, type Page } from 'playwright-core';
import { startService } from '../../../packages/hub/src/main';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import { isoWeek } from '../../../packages/hub/src/feed/index';

const root = resolve(import.meta.dirname, '../../..');
const mode = process.env.PDF_READER_FAILURE_MODE ?? 'browser';
const output = join(root, 'dist/pdf-reader-failure-evidence', mode);
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), `fractal-reader-failure-${mode}-`));
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
process.env.NODE_ENV = 'test';
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const pdfUrl = 'https://papers.nips.cc/paper_files/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf';
const input = {
  title: 'Attention is All you Need', authors: ['Ashish Vaswani'],
  url: 'https://papers.nips.cc/paper_files/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html',
  publication: { year: 2017, venue: 'NeurIPS', publicationKind: 'conference', publicationDate: null, oaAvailability: 'open', oaPdfUrl: pdfUrl, sources: ['user'] },
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const compact = (state: any) => ({ ...state, paper: { paper: state.paper.paper, blocks: { count: state.paper.blocks.length, sha256: sha(Buffer.from(JSON.stringify(state.paper.blocks))) }, translations: state.paper.translations, job: state.paper.job }, fullStateSha256: sha(Buffer.from(JSON.stringify(state))) });
const identity = (pid: number) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`], { encoding: 'utf8' }).trim() || 'null');
const listeners = (port: string) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)`], { encoding: 'utf8' }).trim());
const evidence: any = { mode, source, directory, output, seededPdfBytes: false, externalNavigation: [], cases: [] };
let service = await startService({ dataDirectory: directory, port: 0, indexHtml: join(root, 'packages/ui/dist/index.html'), startBackground: false, allowRealCli: false, log: () => {} });
let running = true, origin = service.url, token = service.token;
const store = service.store as SqlitePaperStore;
store.putPreferences({ ...store.getPreferences(), uiLanguage: 'en', onboardingCompleted: true });
const now = new Date().toISOString(), week = isoWeek(new Date());
const row = { ...input, id: 'cached-read-attention', kind: 'paper', categories: ['cs.CL'], source: 'openAlex', publishedAt: now, dateBasis: 'observed', popularity: 0, image: null, abstract: 'Original public paper; cached Read integrity check.' };
store.db.prepare('INSERT INTO feed_items VALUES(?,?,?)').run(week, row.id, JSON.stringify(row));
for (const [key, value] of Object.entries({ interests: { categories: ['cs.CL'], topics: [], authors: [], custom: [] }, settings: { sources: { arxiv: false, huggingFace: false, news: false, recommendations: false, openAlex: false, crossref: false }, customRssFeeds: [], digestEnabled: false, refreshIntervalHours: 6, translateNewsTitles: false }, [`generated:${week}`]: now, sourceStatus: [] }))
  store.db.prepare('INSERT OR REPLACE INTO feed_meta VALUES(?,?)').run(key, JSON.stringify(value));
async function request(path: string, body?: any, method = body === undefined ? 'GET' : 'POST', headers: Record<string, string> = {}) {
  return fetch(origin + path, { method, headers: { origin, 'x-paperread-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) });
}
async function api(path: string, body?: any, method?: string) {
  const response = await request(path, body, method); const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result.data;
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
let page: Page, runtimePid: number | undefined, browserPid: number | undefined;
const paths: string[] = [], errors: string[] = [];
try {
  const reference = await fetch(pdfUrl, { signal: AbortSignal.timeout(60_000) });
  assert.ok(reference.ok); const bytes = Buffer.from(await reference.arrayBuffer());
  assert.ok(bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')));
  await writeFile(join(output, 'public-reference.pdf'), bytes);
  const opened = await api(mode === 'browser' ? '/api/publications/open' : '/api/library/bookmarks', input), key = opened.paperKey;
  if (mode === 'browser') assert.equal(opened.paper.pdfSha256, sha(bytes));
  evidence.reference = { url: reference.url, bytes: bytes.length, sha256: sha(bytes), paperKey: key };
  store.putFolder({ id: 'parent', name: 'Preserved parent', parentId: null });
  store.putFolder({ id: 'child', name: 'Preserved child', parentId: 'parent' });
  store.patchLibrary(key, { saved: true, tags: ['cache-integrity'], collections: ['child'], lastReadAt: null, readProgress: { page: 1, fraction: 0.1 } });
  store.putHistory({ id: 'preserved-history', paperKey: key, kind: 'question', question: 'Preserved question', text: 'Preserved answer', status: 'completed', createdAt: now, updatedAt: now, completedAt: now, requestId: null, context: {}, answer: null, error: null, rev: 1, deviceId: 'hub', deleted: false });
  const pdfPath = join(directory, 'pdfs', `${sha(bytes)}.pdf`);
  const altered = Buffer.concat([bytes, Buffer.from('\n% own altered cache integrity proof\n')]);
  if (mode !== 'browser') {
    await service.stop(); running = false;
    const executablePath = mode === 'packaged' ? join(root, 'dist/installer-pdf-reader-failure/win-unpacked/Fractal.exe') : join(root, 'node_modules/electron/dist/electron.exe');
    app = await _electron.launch({ executablePath, args: mode === 'packaged' ? [] : [root], env: { ...process.env, FRACTAL_DESKTOP_PROFILE: join(directory, 'profile') }, timeout: 60_000 });
    evidence.wrapperIdentity = identity(app.process().pid!); runtimePid = await app.evaluate(() => process.pid); evidence.runtimeIdentity = identity(runtimePid);
    assert.equal(evidence.runtimeIdentity.ExecutablePath.toLowerCase(), (await realpath(executablePath)).toLowerCase());
    evidence.isPackaged = await app.evaluate(({ app }) => app.isPackaged); assert.equal(evidence.isPackaged, mode === 'packaged');
    page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); origin = await page.evaluate(() => location.origin); token = (await page.locator('meta[name="paperread-token"]').getAttribute('content'))!;
  } else {
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const cdp = await browser.newBrowserCDPSession(); browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser')!.id; await cdp.detach(); evidence.browserIdentity = identity(browserPid);
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  }
  evidence.origin = origin;
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const url = new URL(r.url()); if (r.method() !== 'GET') paths.push(url.pathname); if (url.origin !== origin) evidence.externalNavigation.push(r.url()); });
  page.on('popup', p => evidence.externalNavigation.push(p.url()));
  await page.addInitScript('window.__name = (value) => value');
  async function snapshot() { return { library: await api('/api/library'), paper: await api(`/api/papers/${key}`), folders: await api('/api/library/folders'), history: await api(`/api/papers/${key}/history`) }; }
  async function primaryRead() {
    await page.goto(origin + '/#/home');
    await page.reload(); // Preference changes must be read by a fresh application load.
    await page.locator('[data-feed-id="cached-read-attention"]').getByRole('button', { name: /Read PDF|PDF 읽기/, exact: true }).click();
  }
  if (mode !== 'browser') {
    const acquired = page.waitForResponse(r => r.url().endsWith('/api/publications/open'), { timeout: 120_000 });
    await primaryRead(); const response = await acquired; assert.ok(response.ok());
    const acquiredData = (await response.json()).data; assert.equal(acquiredData.paper.pdfSha256, sha(bytes));
    await page.locator('[data-testid="pdf-body"] canvas').first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1600);
    evidence.cases.push({ name: 'actual-runtime-public-acquisition-Read', runtime: mode, canonicalHash: sha(bytes), mountedPdf: true });
    await page.screenshot({ path: join(output, 'public-original-read.png') });
    await page.goto(origin + '/#/home');
    await api(`/api/library/${key}`, { lastReadAt: null, readProgress: { page: 1, fraction: 0.1 } }, 'PATCH');
    evidence.baselineMetadataSetup = 'Cleared own first-read Recent/progress before corruption comparison; public bytes unchanged.';
  }
  const before = await snapshot(); evidence.before = compact(before);
  await writeFile(pdfPath, altered);
  for (const language of ['en', 'ko'] as const) {
    const preferences = await api('/api/preferences');
    await api('/api/preferences', { ...preferences, uiLanguage: language }, 'PUT');
    const start = paths.length;
    await primaryRead(); await page.getByRole('alert').first().waitFor(); await page.waitForTimeout(1300);
    const status = page.locator('.reader-status');
    const expectedHeading = language === 'ko' ? '원본 PDF를 열지 못했습니다' : 'Could not open the original PDF';
    assert.equal(await status.getByRole('heading').textContent(), expectedHeading);
    const context = await status.locator('.eyebrow').textContent();
    assert.equal(context, language === 'ko' ? '원문' : 'Original');
    const display = await status.getByRole('alert').textContent();
    assert.match(display!, language === 'ko' ? /저장된 PDF.*기록된 해시/ : /stored PDF.*recorded hash/);
    assert.ok(!(await status.textContent())?.includes(key));
    assert.equal(await page.locator('[data-testid="pdf-body"] canvas').count(), 0);
    const retry = status.getByRole('button', { name: language === 'ko' ? '원본 다시 불러오기' : 'Retry original PDF', exact: true });
    assert.ok(await retry.isVisible());
    const refused = page.waitForResponse(r => r.url().endsWith(`/api/papers/${key}/pdf`) && r.status() === 409);
    await retry.click(); await refused;
    await status.getByRole('alert').waitFor(); await page.waitForTimeout(800);
    assert.equal(await status.getByRole('heading').textContent(), expectedHeading);
    assert.ok(!paths.slice(start).some(p => p.endsWith('/read') || p === '/api/publications/open'));
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await readFile(pdfPath), altered);
    await page.screenshot({ path: join(output, `corrupted-primary-read-${language}.png`) });
    evidence.cases.push({ name: 'localized-corrupted-primary-Read', language, heading: expectedHeading, context, display, rawKeyAbsent: true, retryWorked: true, mountedPdf: false, recordedRecent: false, acquisitionSkipped: true, metadataPreserved: true });
  }
  await writeFile(pdfPath, bytes);
  assert.deepEqual(await snapshot(), before);
  await primaryRead(); await page.locator('[data-testid="pdf-body"] canvas').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1600); const after = await snapshot();
  assert.ok(after.library[0].lastReadAt);
  for (const field of ['paperKey', 'saved', 'savedAt', 'tags', 'collections', 'title', 'url']) assert.deepEqual(after.library[0][field], before.library[0][field]);
  assert.deepEqual(after.history, before.history); assert.deepEqual(after.folders, before.folders); assert.deepEqual(after.paper, before.paper);
  evidence.after = compact(after); evidence.cases.push({ name: 'restored-primary-Read', exactOriginalHash: sha(bytes), mountedPdf: true, recentAfterActualRead: true, retainedMetadataPreserved: true });
  await page.screenshot({ path: join(output, 'restored-primary-read.png') });
  assert.deepEqual(evidence.externalNavigation, []); assert.deepEqual(errors, []); evidence.status = 'passed';
} catch (error) { evidence.status = 'failed'; evidence.error = error instanceof Error ? error.stack : String(error); console.error(evidence.error); process.exitCode = 1; }
finally {
  evidence.listenerOwnership = listeners(new URL(origin).port);
  if (app) { assert.deepEqual(identity(runtimePid!), evidence.runtimeIdentity); await app.close(); evidence.ownedProcessExited = identity(runtimePid!) === null; evidence.ownedWrapperExited = identity(evidence.wrapperIdentity.ProcessId) === null; assert.ok(evidence.ownedProcessExited && evidence.ownedWrapperExited); }
  if (browser) { assert.deepEqual(identity(browserPid!), evidence.browserIdentity); await browser.close(); evidence.ownedBrowserExited = identity(browserPid!) === null; assert.ok(evidence.ownedBrowserExited); }
  if (running) await service.stop();
  evidence.listenerReleased = listeners(new URL(origin).port).length === 0; assert.ok(evidence.listenerReleased);
  evidence.errors = errors;
  await writeFile(join(output, 'verification.json'), JSON.stringify(evidence, null, 2));
  console.log(`${mode}: ${evidence.status}; ${output}`);
}
