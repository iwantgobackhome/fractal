import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve('.');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('release manifests preserve update metadata and reject unknown or missing artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fractal-release-fixture-'));
  try {
    const put = async (path, data = 'fixture') => {
      const full = join(directory, path);
      await mkdir(resolve(full, '..'), { recursive: true });
      await writeFile(full, data);
    };
    const run = (script, ...args) =>
      spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_SHA: '', GITHUB_REF_TYPE: '' },
      });
    await put('package.json', JSON.stringify({ version }));
    execFileSync('git', ['init', '-q'], { cwd: directory });
    execFileSync('git', ['add', 'package.json'], { cwd: directory });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: directory });
    const platforms = {
      'win32-x64': [`News-Papers-${version}-win-x64.exe`, 'latest.yml', `News-Papers-${version}-win-x64.exe.blockmap`],
      'linux-x64': [
        `News-Papers-${version}-linux-x64.AppImage`,
        `News-Papers-${version}-linux-x64.deb`,
        'latest-linux.yml',
        `News-Papers-${version}-linux-x64.AppImage.blockmap`,
        `News-Papers-${version}-linux-x64.deb.blockmap`,
      ],
      'darwin-arm64': [`News-Papers-${version}-mac-arm64.dmg`],
      'darwin-x64': [`News-Papers-${version}-mac-x64.dmg`],
    };
    for (const [label, files] of Object.entries(platforms)) {
      for (const name of files) await put(`dist/installer/${name}`);
      const [platform, arch] = label.split('-');
      const bundle =
        platform === 'win32' ? 'win-unpacked' : platform === 'linux' ? 'linux-unpacked' : `${arch === 'arm64' ? 'mac-arm64' : 'mac'}/News Papers.app`;
      await put(`dist/installer/${bundle}/resources/fixture`);
      await put(
        `dist/release/${label}/smoke-${label}.json`,
        JSON.stringify({ version, platform, arch, hubStarted: true, uiServed: true, libraryApi: true, ptySpawn: true }),
      );
      const result = run('release-manifest.mjs', label);
      assert.equal(result.status, 0, result.stderr);
      for (const name of files) assert.equal(await readFile(join(directory, 'dist/release', label, name), 'utf8'), 'fixture');
    }
    await put('apps/android/app/build/outputs/apk/debug/app-debug.apk');
    await put(
      'dist/release/android/android-verification.json',
      JSON.stringify({
        version,
        versionCode: 10,
        applicationId: 'app.newspapers.reader',
        debugSigned: true,
        signatureVerified: true,
        certificateSha256: 'ab'.repeat(32),
      }),
    );
    assert.equal(run('release-manifest.mjs', 'android').status, 0);
    const aggregate = join(directory, 'dist/release-all');
    await mkdir(aggregate);
    for (const label of [...Object.keys(platforms), 'android']) {
      for (const name of await readdir(join(directory, 'dist/release', label)))
        await copyFile(join(directory, 'dist/release', label, name), join(aggregate, name));
    }
    let result = run('verify-release-artifacts.mjs', aggregate);
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(join(aggregate, 'SHA256SUMS.txt'), 'utf8'), /latest-linux\.yml/);
    const legacyApk = `Fractal-${version}-android-debug.apk`;
    assert.deepEqual(await readFile(join(aggregate, legacyApk)), await readFile(join(aggregate, `News-Papers-${version}-android-debug.apk`)));
    const androidChecksums = join(aggregate, 'SHA256SUMS-android.txt');
    const androidOriginal = await readFile(androidChecksums, 'utf8');
    assert.ok(androidOriginal.includes(legacyApk));
    assert.ok((await readFile(join(aggregate, 'SHA256SUMS.txt'), 'utf8')).includes(legacyApk));
    await rm(join(aggregate, 'SHA256SUMS.txt'));
    await writeFile(
      androidChecksums,
      androidOriginal
        .split('\n')
        .filter((line) => !line.endsWith(`  ${legacyApk}`))
        .join('\n'),
    );
    result = run('verify-release-artifacts.mjs', aggregate);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`missing ${legacyApk} in android`), result.stderr);
    await writeFile(join(aggregate, legacyApk), 'different APK');
    await writeFile(
      androidChecksums,
      androidOriginal
        .split('\n')
        .map((line) => (line.endsWith(`  ${legacyApk}`) ? `${hash('different APK')}  ${legacyApk}` : line))
        .join('\n'),
    );
    result = run('verify-release-artifacts.mjs', aggregate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /legacy Android alias must be identical/);
    await copyFile(join(aggregate, `News-Papers-${version}-android-debug.apk`), join(aggregate, legacyApk));
    await writeFile(androidChecksums, androidOriginal);
    await writeFile(join(aggregate, 'unknown.txt'), 'unknown');
    result = run('verify-release-artifacts.mjs', aggregate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unexpected file unknown\.txt/);
    const checksumFile = join(aggregate, 'SHA256SUMS-linux-x64.txt');
    const original = await readFile(checksumFile, 'utf8');
    await writeFile(checksumFile, original + `${hash('unknown')}  unknown.txt\n`);
    result = run('verify-release-artifacts.mjs', aggregate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unexpected file unknown\.txt in linux-x64/);
    await rm(join(aggregate, 'unknown.txt'));
    for (const name of ['latest-linux.yml', `News-Papers-${version}-linux-x64.AppImage.blockmap`]) {
      await writeFile(
        checksumFile,
        original
          .split('\n')
          .filter((line) => !line.endsWith(`  ${name}`))
          .join('\n'),
      );
      result = run('verify-release-artifacts.mjs', aggregate);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`missing ${name} in linux-x64`), result.stderr);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop updates are gated to supported installed formats and authorize every IPC action', async () => {
  const { runInNewContext } = await import('node:vm');
  const { EventEmitter } = await import('node:events');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const original = await readFile(join(root, 'apps/desktop/main.cjs'), 'utf8');
  const source = original.replace(
    /const \{ startHub, augmentCliPath \} = await import\([^\n]+\);/,
    'const augmentCliPath = async () => {}; const startHub = async () => ({ url: "http://localhost:4567", close() {} });',
  );
  assert.notEqual(source, original, 'replace only the Hub import for this isolated main-process test');
  for (const scenario of [
    { platform: 'darwin', packaged: true, enabled: false, manual: true },
    { platform: 'darwin', packaged: false, enabled: false },
    { platform: 'win32', packaged: false, enabled: false },
    { platform: 'linux', packaged: true, enabled: false },
    { platform: 'linux', packaged: true, env: { APPIMAGE: '/tmp/Fractal.AppImage' }, enabled: true },
    { platform: 'linux', packaged: true, packageType: 'deb', enabled: true },
    { platform: 'win32', packaged: true, enabled: true },
  ]) {
    const handlers = new Map();
    const timers = [];
    const intervals = [];
    const app = Object.assign(new EventEmitter(), {
      isPackaged: scenario.packaged,
      setName() {},
      setPath() {},
      getPath: () => '/fake-app-data',
      setAppUserModelId() {},
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      getAppPath: () => root,
      getVersion: () => '0.2.3',
      quit() {},
    });
    let checks = 0,
      downloads = 0,
      installs = 0,
      loaded = 0;
    const updater = Object.assign(new EventEmitter(), {
      checkForUpdates: async () => {
        checks++;
      },
      downloadUpdate: async () => {
        downloads++;
        updater.emit('update-downloaded');
      },
      quitAndInstall: () => {
        installs++;
      },
    });
    class Tray extends EventEmitter {
      setToolTip() {}
      setContextMenu() {}
    }
    const electron = {
      app,
      Tray,
      Menu: { buildFromTemplate: (items) => items },
      nativeImage: {
        createFromPath() {
          return {
            setTemplateImage(value) {
              assert.equal(value, true);
              assert.equal(scenario.platform, 'darwin');
            },
          };
        },
      },
      BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false }) },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      shell: { openExternal: async (url) => opened.push(url) },
    };
    const opened = [];
    let latest = { tag_name: 'v0.2.3', draft: false, prerelease: false };
    let fetchError;
    runInNewContext(source, {
      __dirname: join(root, 'apps/desktop'),
      URL,
      AbortSignal,
      Error,
      fetch: async (url) => {
        assert.equal(url, 'https://api.github.com/repos/iwantgobackhome/news-papers/releases/latest');
        if (fetchError) throw fetchError;
        return { ok: true, json: async () => latest };
      },
      process: {
        platform: scenario.platform,
        env: scenario.env ?? {},
        argv: ['--headless'],
        resourcesPath: '/resources',
        stdout: { write() {} },
        stderr: {
          write(text) {
            throw new Error(text);
          },
        },
      },
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return 1;
      },
      clearTimeout() {},
      setInterval: (fn, ms) => {
        intervals.push({ fn, ms });
        return 2;
      },
      clearInterval() {},
      require(name) {
        if (name === './data-migration.cjs') return { migrateDesktopData() {} };
        if (name === 'electron') return electron;
        if (name === 'node:fs')
          return {
            readFileSync: () => {
              if (scenario.packageType) return scenario.packageType;
              throw new Error('missing package-type');
            },
          };
        if (name === 'electron-updater') {
          loaded++;
          return {
            autoUpdater: updater,
            AppImageUpdater: function () {
              return updater;
            },
            DebUpdater: function () {
              return updater;
            },
          };
        }
        return require(name);
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loaded, scenario.enabled ? 1 : 0, JSON.stringify(scenario));
    if (scenario.manual) {
      // Unsigned macOS builds never load electron-updater; they announce releases and open the download page.
      assert.equal(timers[0].ms, 10000);
      assert.equal(intervals[0].ms, 6 * 60 * 60 * 1000);
      const trusted = { sender: { getURL: () => 'http://localhost:4567/' } };
      await assert.rejects(handlers.get('fractal:updates:check')({ sender: { getURL: () => 'https://untrusted.example/' } }), /Updates are unavailable/);
      assert.equal((await handlers.get('fractal:updates:check')(trusted)).status, 'current');
      assert.equal(await handlers.get('fractal:updates:state')(trusted), undefined, 'same version is not offered');
      latest = { tag_name: 'v0.2.10', draft: false, prerelease: false };
      assert.equal((await handlers.get('fractal:updates:check')(trusted)).version, '0.2.10');
      assert.deepEqual({ ...(await handlers.get('fractal:updates:state')(trusted)) }, { type: 'update-available', version: '0.2.10', manual: true });
      await handlers.get('fractal:updates:download')(trusted);
      assert.deepEqual(opened, ['https://github.com/iwantgobackhome/news-papers/releases/tag/v0.2.10']);
      await handlers.get('fractal:updates:install')(trusted);
      fetchError = new Error('Network unavailable');
      assert.deepEqual({ ...(await handlers.get('fractal:updates:check')(trusted)) }, { status: 'error', error: 'Network unavailable' });
      continue;
    }
    if (!scenario.enabled) {
      assert.equal(handlers.has('fractal:updates:check'), false);
      continue;
    }
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(timers[0].ms, 10000);
    assert.equal(intervals[0].ms, 6 * 60 * 60 * 1000);
    const trusted = { sender: { getURL: () => 'http://localhost:4567/' } };
    const untrusted = { sender: { getURL: () => 'https://untrusted.example/' } };
    for (const action of ['check', 'download', 'install', 'state'])
      await assert.rejects(handlers.get(`fractal:updates:${action}`)(untrusted), /Updates are unavailable/);
    await handlers.get('fractal:updates:check')(trusted);
    assert.equal(checks, 1);
    await handlers.get('fractal:updates:download')(trusted);
    await handlers.get('fractal:updates:install')(trusted);
    assert.equal(downloads, 0);
    assert.equal(installs, 0);
    updater.emit('update-available', { version: '0.3.0' });
    updater.emit('download-progress', { percent: 15 });
    updater.emit('error', new Error('download failed'));
    assert.equal((await handlers.get('fractal:updates:state')(trusted)).type, 'update-available');
    assert.equal((await handlers.get('fractal:updates:state')(trusted)).version, '0.3.0');
    await handlers.get('fractal:updates:download')(trusted);
    assert.equal(downloads, 1);
    assert.equal((await handlers.get('fractal:updates:state')(trusted)).type, 'update-downloaded');
    updater.emit('error', new Error('install failed'));
    assert.equal((await handlers.get('fractal:updates:state')(trusted)).type, 'update-downloaded');
    await handlers.get('fractal:updates:install')(trusted);
    assert.equal(installs, 1);
  }
});

test('preload freezes the update API, replays state and removes subscriptions', async () => {
  const { runInNewContext } = await import('node:vm');
  const { EventEmitter } = await import('node:events');
  const source = await readFile(join(root, 'apps/desktop/preload.cjs'), 'utf8');
  for (const enabled of [false, true]) {
    let bridge;
    const ipc = Object.assign(new EventEmitter(), { invoke: async () => ({ type: 'update-downloaded' }) });
    runInNewContext(source, {
      process: { argv: ['--fractal-version=7.8.9', ...(enabled ? ['--fractal-updates'] : [])] },
      require: () => ({
        contextBridge: {
          exposeInMainWorld: (_name, api) => {
            bridge = api;
          },
        },
        ipcRenderer: ipc,
      }),
    });
    assert.ok(Object.isFrozen(bridge));
    assert.equal(bridge.version, '7.8.9');
    assert.equal(!!bridge.updates, enabled);
    if (!enabled) continue;
    assert.ok(Object.isFrozen(bridge.updates));
    const events = [];
    const unsubscribe = bridge.updates.onEvent((event) => events.push(event));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events[0].type, 'update-downloaded');
    ipc.emit('fractal:update', {}, { type: 'download-progress', percent: 42 });
    assert.equal(events[1].percent, 42);
    unsubscribe();
    assert.equal(ipc.listenerCount('fractal:update'), 0);
  }
});
