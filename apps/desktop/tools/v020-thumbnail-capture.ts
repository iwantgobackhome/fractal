import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron } from 'playwright-core';
const root = resolve('.'),
  output = join(root, 'docs/implementation/desktop/v020-thumbnails/screens');
await mkdir(output, { recursive: true });
const owned = join(root, 'apps/android/qa/v020-thumbnails/data');
const executablePath = await realpath(process.env.QA_ELECTRON_EXE || join(root, 'node_modules/electron/dist/electron.exe'));
const identity = (pid: number) =>
  JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8' },
    ),
  );
const app = await _electron.launch({
  executablePath,
  args: [root],
  env: {
    ...process.env,
    FRACTAL_DATA: join(owned, 'desktop-hub'),
    PAPERREAD_DATA: join(owned, 'empty-legacy'),
    FRACTAL_DESKTOP_PROFILE: join(owned, 'desktop-profile'),
  },
  timeout: 60000,
});
const evidence: any = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  appVersion: await app.evaluate(({ app }) => app.getVersion()),
  packaged: await app.evaluate(({ app }) => app.isPackaged),
  wrapper: identity(app.process().pid!),
  runtime: identity(await app.evaluate(() => process.pid)),
  screenshots: [],
  requests: [],
  errors: [],
};
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.addInitScript('window.__name = (value) => value');
  await page.evaluate('window.__name = (value) => value');
  const origin = await page.evaluate(() => location.origin);
  evidence.origin = origin;
  page.on('pageerror', (e) => evidence.errors.push(e.message));
  page.on('request', (r) => evidence.requests.push({ method: r.method(), origin: new URL(r.url()).origin, path: new URL(r.url()).pathname }));
  await page.goto(origin + '/#/home');
  await page.locator('[data-feed-id="qa-paper"]').scrollIntoViewIfNeeded();
  await page.locator('[data-feed-id="qa-paper"] .picture img').waitFor();
  const capture = async (name: string) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .querySelector('.article-sheet')
          ?.getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)) ?? [],
      );
    });
    await page.screenshot({ path: join(output, name + '.png') });
    evidence.screenshots.push(name);
  };
  for (const width of [1440, 1280]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await capture(`desktop${width}-papers`);
    assert.equal(await page.locator('[data-feed-id="qa-absent"] .picture').count(), 0);
    assert.equal(await page.locator('[data-feed-id="qa-broken"] .picture').count(), 0);
    assert.equal(
      await page.locator('[data-feed-id="qa-paper"] .picture img').evaluate((image: HTMLImageElement) => getComputedStyle(image).objectFit),
      'contain',
    );
    await page.locator('[data-feed-id="qa-paper"] .feed-picture__open').click();
    await page.locator('.publication-dossier .picture img').waitFor();
    await capture(`desktop${width}-paper-dossier`);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'News', exact: true }).click();
    await page.locator('.news-card .picture img').waitFor();
    await capture(`desktop${width}-news`);
    await page.locator('.news-card__link').filter({ hasText: 'AI generates' }).click();
    await page.locator('.article__figure--lead .picture img').waitFor();
    await capture(`desktop${width}-news-dossier`);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Topics', exact: true }).click();
    await page.locator('[data-feed-id="qa-paper"]').scrollIntoViewIfNeeded();
    await page.locator('[data-feed-id="qa-paper"] .picture img').waitFor();
    await capture(`desktop${width}-topics`);
    await page.getByRole('tab', { name: 'Papers', exact: true }).click();
  }
  // Both activation surfaces reach the same dossier; keyboard retains explicit separate actions.
  await page.locator('[data-feed-id="qa-paper"] .research-title').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.getByRole('dialog').getByRole('button', { name: 'Read PDF', exact: true }).isVisible());
  await page.keyboard.press('Escape');
  const token = await page.locator('meta[name="paperread-token"]').getAttribute('content');
  const state = await page.evaluate(async (token) => {
    const read = async (path: string) => (await (await fetch(path, { headers: { 'x-paperread-token': token! } })).json()).data;
    return { library: await read('/api/library'), history: (await read('/api/sync/pull?since=0')).history };
  }, token);
  evidence.state = state;
  assert.equal(state.library.length, 0);
  assert.equal(state.history.length, 0);
  assert.deepEqual(evidence.errors, []);
  assert.ok(evidence.requests.every((r: any) => r.origin === origin));
  evidence.imageRequestPaths = [...new Set(evidence.requests.filter((r: any) => r.path.startsWith('/api/feed/images/')).map((r: any) => r.path))];
  const supply = JSON.parse(await readFile(join(owned, 'supply-evidence.json'), 'utf8'));
  evidence.publicImages = supply.images.filter((i: any) => i.directory.endsWith('desktop-hub'));
} finally {
  const last = await app.firstWindow();
  evidence.lastText = await last
    .locator('body')
    .innerText()
    .catch(() => 'unavailable');
  await last.screenshot({ path: join(output, 'last-state.png') }).catch(() => undefined);
  await app.close();
  evidence.closed = true;
  await writeFile(join(root, 'docs/implementation/desktop/v020-thumbnails/desktop-evidence.json'), JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify({ ok: true, screenshots: evidence.screenshots.length, version: evidence.appVersion }));
