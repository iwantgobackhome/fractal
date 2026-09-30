/** Current packaged Windows application, isolated Hub database/profile, no installation. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright-core';
import { startService } from '../../../packages/hub/src/main';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import { isoWeek } from '../../../packages/hub/src/feed/index';
const root = resolve(import.meta.dirname, '../../..'),
  output = join(root, 'docs/implementation/desktop/stage3');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'fractal-packaged-stage3-'));
process.env.NODE_ENV = 'test';
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
const service = await startService({
  dataDirectory: directory,
  port: 0,
  indexHtml: join(root, 'packages/ui/dist/index.html'),
  startBackground: false,
  allowRealCli: false,
  log: () => {},
});
const store = service.store as SqlitePaperStore;
store.putPreferences({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true });
const now = new Date().toISOString(),
  week = isoWeek(new Date()),
  title = 'Cached packaged research with original physical pages and durable publication metadata';
const publication = {
  year: 2026,
  venue: 'Isolated publication fixture',
  publicationKind: 'journal',
  publicationDate: '2026-09-25',
  oaAvailability: 'unknown',
  oaPdfUrl: null,
  sources: ['user'],
};
async function api(path: string, body: unknown) {
  const response = await fetch(service.url + path, {
    method: 'POST',
    headers: { origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result.data;
}
const saved = await api('/api/library/bookmarks', { title, authors: ['Verification author'], url: 'https://example.org/packaged', publication });
const pdf = await readFile(join(root, 'packages/hub/test/fixtures/text-layout.pdf'));
const response = await fetch(service.url + `/api/library/${saved.paperKey}/pdf`, {
  method: 'POST',
  headers: { origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/pdf' },
  body: pdf,
});
assert.ok(response.ok);
const row = {
  id: 'packaged-cached',
  kind: 'paper',
  title,
  authors: ['Verification author'],
  arxivId: null,
  doi: null,
  abstract: 'A cached publication in a fresh isolated profile, associated with the actual PDF geometry fixture.',
  url: 'https://example.org/packaged',
  categories: ['cs.CL'],
  source: 'user',
  publishedAt: '2026-09-25T00:00:00.000Z',
  dateBasis: 'publication',
  popularity: 0,
  publication,
  image: null,
};
store.db.prepare('INSERT INTO feed_items VALUES(?,?,?)').run(week, row.id, JSON.stringify(row));
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
for (let attempt = 0; attempt < 100; attempt++) {
  const state = store.db.prepare('SELECT status FROM structure_state WHERE paper_key=?').get(saved.paperKey) as { status: string } | undefined;
  if (state && ['ready', 'failed'].includes(state.status)) break;
  await new Promise((done) => setTimeout(done, 100));
}
assert.ok(
  ['ready', 'failed'].includes((store.db.prepare('SELECT status FROM structure_state WHERE paper_key=?').get(saved.paperKey) as { status: string }).status),
  'Preseed structure work must settle before closing its Hub',
);
await service.stop();
const app = await _electron.launch({
  executablePath: join(root, 'dist/installer/win-unpacked/Fractal.exe'),
  args: [],
  env: { ...process.env, FRACTAL_DESKTOP_PROFILE: join(directory, 'profile') },
  timeout: 60000,
});
const evidence: Record<string, unknown> = { isolatedProfile: true, installerInstalled: false, taskbarPinOrMacOSInspected: false };
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const origin = await page.evaluate(() => location.origin);
  await page.goto(origin + '/#/home');
  await page.locator('.research-entry').first().waitFor();
  assert.match((await page.locator('.research-title').textContent()) ?? '', /Cached packaged research/);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(output, 'packaged-discovery.png') });
  const selector = page.getByRole('combobox', { name: 'Publication type', exact: true });
  await selector.focus();
  await selector.press('End');
  await page.getByRole('option', { name: 'Publication type unknown', exact: true }).waitFor();
  await selector.press('Escape');
  assert.equal(await selector.evaluate((el) => document.activeElement === el), true);
  await page.getByRole('button', { name: 'Read PDF', exact: true }).click();
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash.split('/').at(-1)!), saved.paperKey);
  await page.locator('.reader-bar__views button').first().click();
  await page.getByRole('button', { name: 'T', exact: true }).click();
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  assert.match((await page.locator('[data-testid="text-layer-1"]').textContent()) ?? '', /WWW iii wide thin/);
  await page.screenshot({ path: join(output, 'packaged-cached-original.png') });
  const identity = await app.evaluate(({ app, nativeImage }) => ({
    name: app.getName(),
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    windowIcon: nativeImage.createFromPath(app.getAppPath() + '/apps/desktop/assets/icon-256.png').getSize(),
    trayIcon: nativeImage.createFromPath(app.getAppPath() + '/apps/desktop/assets/icon-32.png').getSize(),
  }));
  assert.equal(identity.packaged, true);
  assert.equal(identity.name, 'Fractal');
  assert.ok(identity.appPath.endsWith('app.asar'));
  assert.deepEqual(identity.windowIcon, { width: 256, height: 256 });
  assert.deepEqual(identity.trayIcon, { width: 32, height: 32 });
  const artifacts = [];
  for (const path of [
    'dist/installer/win-unpacked/Fractal.exe',
    'dist/installer/Fractal Setup 0.1.0.exe',
    'dist/installer/win-unpacked/resources/app.asar',
    'apps/desktop/assets/fractal.ico',
    'docs/implementation/design/assets/branch-master.svg',
  ]) {
    const full = join(root, path);
    artifacts.push({
      path: full,
      size: (await stat(full)).size,
      sha256: createHash('sha256')
        .update(await readFile(full))
        .digest('hex'),
    });
  }
  Object.assign(evidence, identity, {
    discoveryRoute: true,
    cachedOriginalReader: true,
    physicalPdfTextLayer: true,
    selectorKeyboard: true,
    exceptions: errors,
    artifacts,
  });
  assert.deepEqual(errors, []);
  evidence.status = 'passed';
  await writeFile(join(output, 'packaged-verification.json'), JSON.stringify(evidence, null, 2));
  console.log('Current packaged discovery, cached original reader, assets, selector and isolated Hub checks passed.');
} catch (error) {
  evidence.failure = String(error);
  await writeFile(join(output, 'packaged-verification.json'), JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  await app.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'fractal-packaged-stage3-'));
  await rm(directory, { recursive: true, force: true });
}
