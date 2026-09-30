import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { _electron } from 'playwright-core';
const root = resolve(import.meta.dirname, '../../..');
const directory = await mkdtemp(join(tmpdir(), 'fractal-packaged-stage1-'));
const app = await _electron.launch({
  executablePath: join(root, 'dist/installer/win-unpacked/Fractal.exe'),
  args: [],
  env: {
    ...process.env,
    NODE_ENV: 'test',
    FRACTAL_DATA: directory,
    PAPERREAD_DATA: join(directory, 'empty-legacy'),
    FRACTAL_DESKTOP_PROFILE: join(directory, 'profile'),
  },
  timeout: 60_000,
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(async () => {
    const token = document.querySelector('meta[name="paperread-token"]').content;
    const response = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'x-paperread-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }),
    });
    if (!response.ok) throw new Error('Isolated packaged preferences rejected');
  });
  await page.goto((await page.evaluate(() => location.origin)) + '/#/library');
  await page.reload();
  await page.getByText('Your saved research starts here.').waitFor();
  const identity = await app.evaluate(({ app, nativeImage }) => ({
    name: app.getName(),
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    windowIcon: nativeImage.createFromPath(app.getAppPath() + '/apps/desktop/assets/icon-256.png').getSize(),
    trayIcon: nativeImage.createFromPath(app.getAppPath() + '/apps/desktop/assets/icon-32.png').getSize(),
  }));
  assert.equal(identity.packaged, true);
  assert.ok(identity.appPath.endsWith('app.asar'));
  assert.equal(identity.name, 'Fractal');
  assert.deepEqual(identity.windowIcon, { width: 256, height: 256 });
  assert.deepEqual(identity.trayIcon, { width: 32, height: 32 });
  await page.getByRole('combobox', { name: 'Sort papers', exact: true }).focus();
  await page.getByRole('combobox', { name: 'Sort papers', exact: true }).press('End');
  await page.getByRole('option', { name: 'First added', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Sort papers', exact: true }).press('Escape');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, 'docs/implementation/desktop/stage1/packaged-index-empty-en.png') });
  assert.deepEqual(errors, []);
  await writeFile(
    join(root, 'docs/implementation/desktop/stage1/packaged-verification.json'),
    JSON.stringify(
      {
        passed: true,
        ...identity,
        isolatedData: true,
        readerAssetsServed: true,
        emptyIndexAction: true,
        selectorKeyboard: true,
        exceptions: errors,
        limits: 'Packaged application startup verified; no installer installation or OS shortcut/tray visual inspection.',
      },
      null,
      2,
    ),
  );
  console.log('Packaged Fractal.exe startup, bundled assets, index and selector checks passed.');
} finally {
  await app.close();
  assert.ok(directory.startsWith(resolve(tmpdir()) + sep + 'fractal-packaged-stage1-'));
  await rm(directory, { recursive: true, force: true });
}
