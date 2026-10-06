// Run only through the actual shipped Electron executable in Node mode.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');

(async () => {
  const [archive, output] = process.argv.slice(2);
  const pkg = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.2.4');
  assert.equal(pkg.build.appId, 'app.newspapers.desktop');
  assert.equal(pkg.build.productName, 'News Papers');
  assert.equal(pkg.build.executableName, 'news-papers');
  const requireApp = createRequire(path.join(archive, 'package.json'));
  const ptyEntry = requireApp.resolve('@lydell/node-pty');
  assert.ok(ptyEntry.startsWith(archive + path.sep), 'PTY must resolve inside shipped app');
  const optional = `@lydell/node-pty-${process.platform}-${process.arch}`;
  const nativeEntry = requireApp.resolve(optional);
  assert.ok(nativeEntry.startsWith(archive + path.sep), 'optional PTY module must be shipped');
  const pty = requireApp('@lydell/node-pty');
  let transcript = '';
  let terminal;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('packaged PTY timed out')), 15000);
      const shell = process.platform === 'win32' ? process.env.ComSpec : '/bin/sh';
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'echo FRACTAL_PTY_OK'] : ['-c', 'printf FRACTAL_PTY_OK'];
      terminal = pty.spawn(shell, args, { name: 'xterm-color', cols: 80, rows: 24, cwd: process.env.FRACTAL_DATA, env: process.env });
      terminal.onData((chunk) => { transcript += chunk; });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timer);
        try { assert.equal(exitCode, 0); assert.ok(transcript.includes('FRACTAL_PTY_OK')); resolve(); } catch (error) { reject(error); }
      });
    });
  } finally { try { terminal?.kill(); } catch {} }
  const binaries = Object.keys(require.cache).filter((entry) => entry.endsWith('.node') && entry.includes('node-pty'));
  assert.ok(binaries.length, 'actual native PTY binary must be loaded');
  const hashes = [];
  for (const name of ['package.json', 'apps/desktop/main.cjs', 'apps/desktop/dist/hub.mjs', 'apps/desktop/dist/pdf.worker.mjs', 'packages/ui/dist/index.html']) {
    const bytes = fs.readFileSync(path.join(archive, name));
    hashes.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  }
  for (const entry of binaries) {
    const real = entry.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    assert.ok(fs.existsSync(real), 'native PTY binary must be physically unpacked');
    const bytes = fs.readFileSync(real);
    hashes.push({ path: path.relative(path.dirname(archive), real), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  }
  const { startHub } = await import(pathToFileURL(path.join(archive, 'apps/desktop/dist/hub.mjs')).href);
  const hub = await startHub({ port: 0, indexHtml: path.join(archive, 'packages/ui/dist/index.html'), allowRealCli: false, startBackground: false });
  try {
    const response = await fetch(hub.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('<html'), 'bundled UI must be served by bundled Hub');
    const entries = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]);
    assert.ok(entries.some((entry) => entry.endsWith('.js')), 'built UI must reference its JavaScript');
    for (const asset of entries) {
      const served = await fetch(hub.url + asset);
      assert.equal(served.status, 200, `bundled UI asset ${asset}`);
      const bytes = Buffer.from(await served.arrayBuffer());
      assert.deepEqual(bytes, fs.readFileSync(path.join(archive, 'packages/ui/dist', asset.slice(1))));
    }
    for (const name of fs.readdirSync(path.join(archive, 'packages/ui/dist/assets'))) {
      const relative = path.join('packages/ui/dist/assets', name);
      const bytes = fs.readFileSync(path.join(archive, relative));
      hashes.push({ path: relative.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    }
    const api = await fetch(hub.url + '/api/papers');
    assert.equal(api.status, 200);
    assert.ok(Array.isArray((await api.json()).data?.papers), 'bundled Hub must serve actual library API success envelope');
    fs.writeFileSync(output, JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch, executable: process.execPath, ptyEntry, nativeEntry, binaries, hubStarted: true, uiServed: true, libraryApi: true, ptySpawn: true, resources: hashes }, null, 2) + '\n');
  } finally { await hub.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
