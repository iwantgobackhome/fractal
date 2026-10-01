/** Actual application/public HTTP gates; metadata fixtures only, never seeded PDF bytes. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, _electron, type Page } from 'playwright-core';
import { startService } from '../../../packages/hub/src/main';
import { isoWeek } from '../../../packages/hub/src/feed/index';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import type { PublicationBookmark, PublicationPdfLinkResult, HistoryEntry } from '@fractal/shared';

const root = resolve(import.meta.dirname, '../../..');
const mode = process.env.PDF_ACQUISITION_MODE ?? 'browser';
const output = join(root, 'dist/pdf-acquisition-evidence', mode);
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), `fractal-pdf-acquisition-${mode}-`));
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
process.env.NODE_ENV = 'test';
const attentionPdf = 'https://papers.nips.cc/paper_files/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf';
const attention: PublicationBookmark = {
  title: 'Attention is All you Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit', 'Llion Jones', 'Aidan N Gomez', 'Łukasz Kaiser', 'Illia Polosukhin'],
  url: 'https://papers.nips.cc/paper_files/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html',
  doi: null,
  arxivId: null,
  publication: {
    year: 2017,
    venue: 'Advances in Neural Information Processing Systems 30',
    publicationKind: 'conference',
    publicationDate: null,
    oaAvailability: 'open',
    oaPdfUrl: attentionPdf,
    sources: ['user'],
  },
};
const clipPdf = 'https://proceedings.mlr.press/v139/radford21a/radford21a.pdf';
const clip: PublicationBookmark = {
  title: 'Learning Transferable Visual Models From Natural Language Supervision',
  authors: ['Alec Radford', 'Jong Wook Kim', 'Chris Hallacy', 'Aditya Ramesh', 'Gabriel Goh'],
  url: 'https://proceedings.mlr.press/v139/radford21a.html',
  doi: null,
  arxivId: null,
  publication: {
    year: 2021,
    venue: 'Proceedings of the 38th International Conference on Machine Learning',
    publicationKind: 'conference',
    publicationDate: '2021-07-18',
    oaAvailability: 'unknown',
    oaPdfUrl: null,
    sources: ['user'],
  },
};
const rejected: PublicationBookmark = {
  title: 'Controlled acquisition failure boundary',
  authors: ['Boundary author'],
  url: mode === 'controlled' ? 'https://example.org/failure' : 'https://example.org',
  publication: {
    year: 2026,
    venue: 'Controlled boundary',
    publicationKind: 'unknown',
    publicationDate: null,
    oaAvailability: 'unknown',
    oaPdfUrl: mode === 'controlled' ? 'https://example.org/failure.pdf' : null,
  },
};
const exactPdf = 'https://arxiv.org/pdf/2609.40325v1';
let exactCase: PublicationBookmark | null = null;
if (mode !== 'controlled') {
  const response = await fetch('https://export.arxiv.org/api/query?id_list=2609.40325v1', { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok);
  const atom = await response.text();
  await writeFile(join(output, 'exact-user-source.atom'), atom);
  const entry = atom.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  assert.ok(entry?.includes('2609.40325v1'), 'exact versioned metadata must exist');
  const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  assert.ok(title);
  exactCase = {
    title,
    authors: Array.from(entry.matchAll(/<name>([\s\S]*?)<\/name>/g)).map((match) => match[1].trim()),
    url: 'https://arxiv.org/abs/2609.40325v1',
    arxivId: '2609.40325v1',
    doi: null,
    abstract: entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim(),
    publication: {
      year: 2026,
      venue: 'arXiv',
      publicationKind: 'preprint',
      publicationDate: '2026-09-30',
      oaAvailability: 'open',
      oaPdfUrl: exactPdf,
      sources: ['arxiv'],
    },
  };
}
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const evidence: Record<string, any> = {
  mode,
  source,
  directory,
  output,
  seededPdfBytes: false,
  externalNavigation: [],
  cases: [],
  isolation: 'Fresh Hub database and owned browser/Electron profile; no installation or user profile changes',
};
const service = await startService({
  dataDirectory: directory,
  port: 0,
  indexHtml: join(root, 'packages/ui/dist/index.html'),
  startBackground: false,
  allowRealCli: false,
  log: () => {},
});
const store = service.store as SqlitePaperStore;
store.putPreferences({ uiLanguage: 'en', onboardingCompleted: true, translationLanguage: 'ko', answerLanguage: 'auto' });
let origin = service.url,
  token = service.token,
  serviceRunning = true;
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + path, {
    method,
    headers: { origin, 'x-paperread-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(value)}`);
  return value.data;
}
const unsaved = await api('/api/library/bookmarks', clip);
await api(`/api/library/${unsaved.paperKey}`, { saved: false }, 'PATCH');
const beforeClip = await api(`/api/library/${unsaved.paperKey}`);
assert.equal(beforeClip.saved, false);
assert.equal(beforeClip.lastReadAt, null);
let beforeSaved: any = null,
  savedHistory: HistoryEntry | null = null;
if (mode === 'electron') {
  const bookmarked = await api('/api/library/bookmarks', attention);
  const folder = await api('/api/library/folders', { id: randomUUID(), name: 'Preserved research', parentId: null });
  await api(`/api/library/${bookmarked.paperKey}`, { tags: ['preserved-tag'], collections: [folder.id], readProgress: { page: 1, fraction: 0.1 } }, 'PATCH');
  beforeSaved = await api(`/api/library/${bookmarked.paperKey}`);
  const now = new Date().toISOString();
  savedHistory = {
    id: 'retained-pre-acquisition-history',
    paperKey: bookmarked.paperKey,
    kind: 'question',
    question: 'Existing retained question',
    text: 'Original history',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    requestId: null,
    context: {},
    answer: null,
    error: null,
    rev: 1,
    deviceId: 'hub',
    deleted: false,
  };
  savedHistory = store.putHistory(savedHistory);
}
const now = new Date().toISOString(),
  week = isoWeek(new Date());
for (const [index, item] of [attention, clip, rejected, ...(exactCase ? [exactCase] : [])].entries()) {
  const row = {
    ...item,
    id: `pdf-acquisition-${index}`,
    kind: 'paper',
    categories: ['cs.CL'],
    source: 'openAlex',
    publishedAt: now,
    dateBasis: 'observed',
    popularity: 0,
    image: null,
    abstract:
      item.abstract ??
      (index === 2
        ? 'Controlled failure checks are separate from public PDF acquisition.'
        : 'Original scholarly publication. Read the PDF inside the app; saving metadata is a separate action.'),
  };
  store.db.prepare('INSERT INTO feed_items VALUES(?,?,?)').run(week, row.id, JSON.stringify(row));
}
for (const [key, value] of Object.entries({
  interests: { categories: ['cs.CL'], topics: [], authors: [], custom: [] },
  settings: {
    sources: { arxiv: false, huggingFace: false, news: false, recommendations: false, openAlex: false, crossref: false },
    customRssFeeds: [],
    digestEnabled: false,
    refreshIntervalHours: 6,
    translateNewsTitles: false,
  },
  [`generated:${week}`]: now,
  sourceStatus: [],
}))
  store.db.prepare('INSERT OR REPLACE INTO feed_meta VALUES(?,?)').run(key, JSON.stringify(value));

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
let page: Page | undefined;
let ownedPid: number | undefined, listener: string | undefined;
let browserPid: number | undefined;
const requestPaths: string[] = [],
  errors: string[] = [];
const processIdentity = (pid: number) =>
  JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8' },
    ).trim() || 'null',
  );
async function reference(url: string, filename: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  assert.ok(response.ok, `${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')));
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(output, filename), bytes);
  return { url: response.url, bytes: bytes.length, sha256: hash, file: join(output, filename) };
}
async function openFromDiscovery(index: number, expected: any) {
  const p = page!;
  await p.goto(origin + '/#/home');
  await p.evaluate('window.__name = (value) => value');
  const row = p.locator(`[data-feed-id="pdf-acquisition-${index}"]`);
  await row.waitFor();
  await p.evaluate(() => document.fonts.ready);
  const before = await api('/api/library');
  if (index === 0 && mode !== 'electron') assert.ok(!before.some((r: any) => r.title === attention.title), 'Attention starts unbookmarked');
  const startRequests = requestPaths.length;
  const opened = p.waitForResponse((r) => r.url().endsWith('/api/publications/open'), { timeout: 120_000 });
  await row.getByRole('button', { name: 'Read PDF', exact: true }).focus();
  await p.keyboard.press('Enter');
  const response = await opened;
  const result = (await response.json()).data as PublicationPdfLinkResult;
  assert.ok(response.ok(), JSON.stringify(await response.json()));
  assert.equal(result.hasPdf, true);
  assert.equal(result.paper.pdfSha256, expected.sha256);
  const associated = result.record;
  if (index === 1) {
    assert.equal(result.paperKey, unsaved.paperKey);
    assert.equal(associated.saved, false);
    assert.equal(associated.lastReadAt, null);
  } else if (index === 0 && beforeSaved) {
    assert.equal(result.paperKey, beforeSaved.paperKey);
    for (const key of ['saved', 'savedAt', 'tags', 'collections', 'lastReadAt', 'readProgress'])
      assert.deepEqual(associated[key], beforeSaved[key], `preserved ${key}`);
  } else {
    assert.equal(associated.saved, false);
    assert.equal(associated.lastReadAt, null);
  }
  if (index === 3) {
    assert.equal(associated.url, exactCase!.url);
    assert.equal(result.paper.sourceUrl, exactCase!.url);
    assert.equal(associated.arxivId, '2609.40325');
  }
  await p.locator('[data-testid="pdf-body"] canvas').first().waitFor({ timeout: 60_000 });
  assert.equal(decodeURIComponent(new URL(p.url()).hash.split('/').at(-1)!), result.paperKey);
  await p.locator('.reader-bar__views button').first().click();
  await p.getByRole('button', { name: 'T', exact: true }).click();
  await p.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  await p.evaluate(() => document.fonts.ready);
  const stored = await fetch(origin + `/api/papers/${encodeURIComponent(result.paperKey)}/pdf`);
  assert.ok(stored.ok);
  const actualHash = createHash('sha256')
    .update(Buffer.from(await stored.arrayBuffer()))
    .digest('hex');
  assert.equal(actualHash, expected.sha256);
  await p.waitForTimeout(700);
  const readRecord = await api(`/api/library/${encodeURIComponent(result.paperKey)}`);
  assert.ok(readRecord.lastReadAt, 'only real reading records Recent');
  assert.equal(readRecord.saved, associated.saved);
  const newPaths = requestPaths.slice(startRequests);
  assert.ok(!newPaths.some((path) => /\/bookmarks$|\/save$/.test(path)), 'Read sends no Save request');
  await p.screenshot({ path: join(output, index === 0 ? 'attention-reader.png' : index === 3 ? 'exact-user-v1-reader.png' : 'passive-publisher-reader.png') });
  evidence.cases.push({
    name: index === 0 ? 'explicit-known-public-PDF' : index === 3 ? 'exact-user-2609.40325v1' : 'passive-publisher-without-PDF-hint',
    paperKey: result.paperKey,
    expected,
    actualHash,
    associated,
    readRecord,
    requestPaths: newPaths,
  });
  if (index === 0 && savedHistory)
    assert.deepEqual(
      (await api(`/api/papers/${result.paperKey}/history`)).history.find((h: any) => h.id === savedHistory!.id),
      savedHistory,
    );
  return result;
}
async function selection(expected: string, backwards: boolean) {
  const p = page!;
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.getSelection()?.removeAllRanges());
  await p.waitForTimeout(350);
  const points = await p.evaluate(
    ({ expected, backwards }) => {
      const spans = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="text-layer-1"] span[data-boundaries]'));
      const span = spans.find((s) => s.textContent?.includes('dominant'));
      if (!span?.firstChild) throw new Error('Original academic dominant text missing');
      span.scrollIntoView({ block: 'center' });
      const text = span.textContent!,
        start = text.indexOf(expected),
        end = start + expected.length;
      const point = (offset: number) => {
        const range = document.createRange();
        range.setStart(span.firstChild!, offset);
        range.setEnd(span.firstChild!, Math.min(text.length, offset + 1));
        const r = range.getBoundingClientRect();
        const candidates = [
          [0.1, 0.5],
          [0.1, 0.1],
          [0.5, 0.1],
          [0.9, 0.1],
          [0.9, 0.5],
        ].map(([x, y]) => ({ x: r.left + r.width * x, y: r.top + r.height * y }));
        return (
          candidates.find((p) => {
            const caret = document.caretRangeFromPoint(p.x, p.y);
            return caret?.startContainer === span.firstChild && caret.startOffset === offset;
          }) ?? candidates[0]
        );
      };
      return { a: point(backwards ? end : start), b: point(backwards ? start : end), originalText: text, start, end, dataset: { ...span.dataset } };
    },
    { expected, backwards },
  );
  await p.mouse.move(points.a.x, points.a.y);
  await p.mouse.down();
  await p.mouse.move(points.b.x, points.b.y, { steps: 14 });
  await p.waitForTimeout(80);
  const beforeUp = await p.evaluate(() => window.getSelection()?.toString());
  await p.mouse.up();
  await p.locator('.selection-menu').waitFor();
  const selected = await p.evaluate(() => window.getSelection()?.toString());
  assert.equal(beforeUp, expected);
  assert.equal(selected, expected);
  await p.keyboard.press('Control+C');
  const clipboard = app ? await app.evaluate(({ clipboard }) => clipboard.readText()) : await p.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard, expected);
  await p.screenshot({ path: join(output, `selection-${expected}.png`) });
  evidence.cases.push({ name: 'native-original-pointer-selection', expected, backwards, beforeUp, selected, clipboard, points });
}
try {
  if (mode === 'electron' || mode === 'packaged') {
    await service.stop();
    serviceRunning = false;
    const executablePath =
      mode === 'packaged' ? join(root, 'dist/installer-pdf-acquisition/win-unpacked/Fractal.exe') : join(root, 'node_modules/electron/dist/electron.exe');
    app = await _electron.launch({
      executablePath,
      args: mode === 'packaged' ? [] : [root],
      env: { ...process.env, FRACTAL_DESKTOP_PROFILE: join(directory, 'profile') },
      timeout: 60_000,
    });
    evidence.wrapperIdentity = processIdentity(app.process().pid!);
    ownedPid = await app.evaluate(() => process.pid);
    evidence.runtimeIdentity = processIdentity(ownedPid);
    assert.equal(evidence.runtimeIdentity.ProcessId, ownedPid);
    assert.equal(evidence.runtimeIdentity.ExecutablePath.toLowerCase(), (await realpath(executablePath)).toLowerCase());
    evidence.isPackaged = await app.evaluate(({ app }) => app.isPackaged);
    assert.equal(evidence.isPackaged, mode === 'packaged');
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    origin = await page.evaluate(() => location.origin);
    token = (await page.locator('meta[name="paperread-token"]').getAttribute('content'))!;
    listener = new URL(origin).port;
    evidence.listener = origin;
  } else {
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const processSession = await browser.newBrowserCDPSession();
    const processes = await processSession.send('SystemInfo.getProcessInfo');
    browserPid = processes.processInfo.find((item) => item.type === 'browser')!.id;
    evidence.browserRuntimeIdentity = processIdentity(browserPid!);
    await processSession.detach();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    page = await context.newPage();
  }
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (r.method() !== 'GET') requestPaths.push(url.pathname);
    if (url.origin !== origin) evidence.externalNavigation.push(r.url());
  });
  page.on('popup', (p) => evidence.externalNavigation.push(p.url()));
  await page.addInitScript('window.__name = (value) => value');
  await page.goto(origin + '/#/home');
  await page.evaluate('window.__name = (value) => value');
  await page.locator('[data-feed-id="pdf-acquisition-0"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(output, 'scholarly-discovery.png') });
  if (mode === 'controlled') {
    evidence.controlledBoundary =
      'Only /api/publications/open response is controlled; actual application and metadata HTTP routes served by isolated Hub. These are not public-download acceptance claims.';
    const row = page.locator('[data-feed-id="pdf-acquisition-2"]');
    let count = 0;
    const cases = [
      { status: 404, payload: null, expected: 'does not support in-app PDF acquisition' },
      { status: 404, payload: { error: { code: 'NOT_FOUND', message: 'No public PDF was found for this publication' } }, expected: 'No public PDF was found' },
      { status: 403, payload: { error: { code: 'AUTH_REQUIRED', message: 'Publisher requires sign-in' } }, expected: 'Publisher requires sign-in' },
      { status: 415, payload: { error: { code: 'UNSUPPORTED_PDF', message: 'The source returned HTML instead of a PDF' } }, expected: 'HTML instead of a PDF' },
      { status: 502, payload: { error: { code: 'NETWORK', message: 'Publisher rejected the download' } }, expected: 'rejected the download' },
      { status: 504, payload: { error: { code: 'NETWORK', message: 'Publisher request timed out' } }, expected: 'timed out' },
    ];
    for (const boundary of cases) {
      await page.route('**/api/publications/open', async (route) => {
        count++;
        await route.fulfill({ status: boundary.status, json: boundary.payload });
      });
      await row.getByRole('button', { name: 'Read PDF', exact: true }).focus();
      await page.keyboard.press('Enter');
      await row.getByRole('alert').filter({ hasText: boundary.expected }).waitFor();
      assert.equal(new URL(page.url()).hash, '#/home');
      assert.equal(await row.getByRole('alert').evaluate((el) => document.activeElement === el), true);
      assert.ok(await row.getByRole('button', { name: 'Retry Read PDF' }).isEnabled());
      assert.ok(await row.getByRole('link', { name: 'Publication source', exact: true }).isVisible());
      assert.ok(await row.getByRole('link', { name: 'PDF source', exact: true }).isVisible());
      await page.screenshot({ path: join(output, `error-${boundary.status}.png`) });
      evidence.cases.push({ name: 'controlled-error', ...boundary, focused: true });
      await page.unroute('**/api/publications/open');
    }
    let release!: () => void;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    const beforeCount = count;
    await page.route('**/api/publications/open', async (route) => {
      count++;
      await hold;
      await route.fulfill({ status: 502, json: { error: { code: 'NETWORK', message: 'Delayed controlled failure' } } });
    });
    await row.getByRole('button', { name: 'Read PDF', exact: true }).evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });
    await row.getByRole('button', { name: 'Opening PDF…', exact: true }).waitFor();
    assert.equal(await row.getAttribute('aria-busy'), null); // busy belongs to action group
    assert.equal(await row.locator('.publication-actions').getAttribute('aria-busy'), 'true');
    await row.getByRole('status').waitFor();
    await page.waitForTimeout(250);
    assert.equal(count, beforeCount + 1);
    release();
    await row.getByRole('alert').filter({ hasText: 'Delayed controlled failure' }).waitFor();
    await page.unroute('**/api/publications/open');
    assert.equal((await api('/api/library')).length, 1, 'failed unbookmarked Read did not Save');
    evidence.cases.push({ name: 'controlled-concurrent-double-click', singleRequest: true });
    const feed = await api('/api/feed');
    const nextFeed = JSON.parse(JSON.stringify(feed, (key, value) => (key === 'year' && value === 2026 ? 2025 : value)));
    let finishOld!: () => void;
    const oldReply = new Promise<void>((done) => {
      finishOld = done;
    });
    await page.route('**/api/publications/open', async (route) => {
      await oldReply;
      // Controlled stale reply only. No bytes/catalog record are seeded or opened.
      await route.fulfill({
        status: 200,
        json: {
          data: {
            paperKey: 'controlled-old-year',
            record: { paperKey: 'controlled-old-year', saved: false },
            hasPdf: true,
            paper: { paperKey: 'controlled-old-year', pdfSha256: 'controlled-stale-reply-only' },
          },
        },
      });
    });
    await page.route('**/api/feed/refresh', async (route) => {
      await route.fulfill({ status: 200, json: { data: nextFeed } });
    });
    await row.getByRole('button', { name: 'Read PDF', exact: true }).click();
    await row.getByRole('button', { name: 'Opening PDF…', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Gather now', exact: true }).click();
    await row.locator('.publication-meta').filter({ hasText: '2025' }).waitFor();
    assert.ok(await row.getByRole('button', { name: 'Read PDF', exact: true }).isEnabled(), 'changed publication year remounts owner');
    const beforeLate = requestPaths.length;
    finishOld();
    await page.waitForTimeout(500);
    assert.equal(new URL(page.url()).hash, '#/home');
    assert.ok(!requestPaths.slice(beforeLate).some((path) => path.includes('controlled-old-year')), 'stale success did not load a reader');
    evidence.cases.push({
      name: 'controlled-year-replacement-late-reply',
      sameTitleUrlAuthors: true,
      previousYear: 2026,
      newYear: 2025,
      oldReplyIgnored: true,
    });
    await page.unroute('**/api/publications/open');
    await page.unroute('**/api/feed/refresh');
    const preferences = await api('/api/preferences');
    await api('/api/preferences', { ...preferences, uiLanguage: 'ko' }, 'PUT');
    await page.reload();
    const koRow = page.locator('[data-feed-id="pdf-acquisition-2"]');
    await koRow.getByRole('button', { name: 'PDF 읽기', exact: true }).waitFor();
    await page.route('**/api/publications/open', async (route) => {
      await route.fulfill({ status: 404, json: null });
    });
    await koRow.getByRole('button', { name: 'PDF 읽기', exact: true }).focus();
    await page.keyboard.press('Enter');
    await koRow.getByRole('alert').filter({ hasText: '이 Hub는 앱 내 PDF 가져오기를 지원하지 않습니다' }).waitFor();
    assert.ok(await koRow.getByRole('button', { name: 'PDF 읽기 다시 시도', exact: true }).isVisible());
    await page.screenshot({ path: join(output, 'error-old-hub-ko.png') });
    evidence.cases.push({ name: 'controlled-korean-keyboard-fallback', localized: true });
    await page.unroute('**/api/publications/open');
  } else {
    const [a, c] = await Promise.all([reference(attentionPdf, 'attention-public-reference.pdf'), reference(clipPdf, 'clip-public-reference.pdf')]);
    evidence.references = { attention: a, clip: c };
    const attentionResult = await openFromDiscovery(0, a);
    await selection('dominant', false);
    await selection('ominan', true);
    const clipResult = await openFromDiscovery(1, c);
    const exactReference = await reference(exactPdf, 'exact-user-v1-public-reference.pdf');
    evidence.references.exactUserCase = exactReference;
    await openFromDiscovery(3, exactReference);
    await page.goto(origin + '/#/home');
    const reopen = page.locator('[data-feed-id="pdf-acquisition-0"]');
    await reopen.waitFor();
    const paths = requestPaths.length;
    await reopen.getByRole('button', { name: 'Read PDF', exact: true }).click();
    await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
    assert.equal(decodeURIComponent(new URL(page.url()).hash.split('/').at(-1)!), attentionResult.paperKey);
    assert.ok(!requestPaths.slice(paths).includes('/api/publications/open'), 'cached reopen skips acquisition route');
    evidence.cases.push({ name: 'cached-reopen', paperKey: attentionResult.paperKey, acquisitionSkipped: true });
    // Real application HTTP and real public non-PDF HTML, with no response override.
    await page.goto(origin + '/#/home');
    const failureRow = page.locator('[data-feed-id="pdf-acquisition-2"]');
    await failureRow.waitFor();
    const failed = page.waitForResponse((response) => response.url().endsWith('/api/publications/open'));
    await failureRow.getByRole('button', { name: 'Read PDF', exact: true }).focus();
    await page.keyboard.press('Enter');
    const failedResponse = await failed,
      failurePayload = await failedResponse.json();
    assert.equal(failedResponse.status(), 400);
    assert.equal(failurePayload.error.code, 'INVALID_INPUT');
    assert.match(failurePayload.error.message, /one main PDF/);
    await failureRow.getByRole('alert').filter({ hasText: 'one main PDF' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/home');
    assert.ok(await failureRow.getByRole('button', { name: 'Retry Read PDF' }).isEnabled());
    await page.screenshot({ path: join(output, 'real-http-no-main-pdf.png') });
    evidence.cases.push({
      name: 'real-public-HTML-failure-over-application-HTTP',
      url: rejected.url,
      status: failedResponse.status(),
      error: failurePayload.error,
      stayedInApp: true,
    });
  }
  assert.deepEqual(evidence.externalNavigation, [], 'Read and failure never navigate externally');
  assert.deepEqual(errors, []);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error instanceof Error ? error.stack : String(error);
  console.error(evidence.error);
  process.exitCode = 1;
} finally {
  if (app) {
    const current = processIdentity(ownedPid!);
    assert.deepEqual(current, evidence.runtimeIdentity, 'owned process identity unchanged before close');
    if (listener)
      evidence.listenerOwnership = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${listener} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8' },
      ).trim();
    await app.close();
    evidence.ownedProcessExited = processIdentity(ownedPid!) === null;
    assert.equal(evidence.ownedProcessExited, true);
    evidence.ownedWrapperExited = processIdentity(evidence.wrapperIdentity.ProcessId) === null;
    assert.equal(evidence.ownedWrapperExited, true);
    if (listener)
      evidence.listenerReleased =
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', `@(Get-NetTCPConnection -LocalPort ${listener} -State Listen -ErrorAction SilentlyContinue).Count`],
          { encoding: 'utf8' },
        ).trim() === '0';
    if (listener) assert.equal(evidence.listenerReleased, true);
  }
  if (browser) {
    assert.deepEqual(processIdentity(browserPid!), evidence.browserRuntimeIdentity, 'owned browser identity unchanged before close');
    await browser.close();
    evidence.ownedBrowserExited = processIdentity(browserPid!) === null;
    assert.equal(evidence.ownedBrowserExited, true);
  }
  if (serviceRunning) await service.stop();
  evidence.errors = errors;
  evidence.ownedHandleCleanup = true;
  await writeFile(join(output, 'verification.json'), JSON.stringify(evidence, null, 2));
  console.log(`${mode}: ${evidence.status}; evidence ${output}`);
}
