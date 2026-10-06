// Run only through the actual shipped Electron executable in Node mode.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');

(async () => {
  const [archive, output, ...pdfPaths] = process.argv.slice(2);
  const pkg = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.5.0');
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'desktop-third-party.txt', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) {
    assert.ok(fs.readFileSync(path.join(path.dirname(archive), 'licenses', name), 'utf8').trim(), `packaged license ${name}`);
  }
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
  for (const name of ['package.json', 'apps/desktop/main.cjs', 'apps/desktop/dist/hub.mjs', 'apps/desktop/dist/pdf.worker.mjs', 'apps/desktop/dist/pdf-extraction.worker.mjs', 'packages/ui/dist/index.html']) {
    const bytes = fs.readFileSync(path.join(archive, name));
    hashes.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  }
  for (const entry of binaries) {
    const real = entry.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    assert.ok(fs.existsSync(real), 'native PTY binary must be physically unpacked');
    const bytes = fs.readFileSync(real);
    hashes.push({ path: path.relative(path.dirname(archive), real), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  }
  // Exercise the actual shipped worker directly: the hub's fallback must not hide a missing bundle.
  const workerEntry = path.join(archive.replace(/app\.asar$/, 'app.asar.unpacked'), 'apps/desktop/dist/pdf-extraction.worker.mjs');
  await new Promise((resolve, reject) => {
    const worker = new Worker(workerEntry, { workerData: { bytes: new Uint8Array([0]), paperKey: 'probe', options: {} } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('packaged extraction worker timed out')); }, 15000);
    worker.once('error', (error) => { clearTimeout(timer); reject(error); });
    worker.once('message', async (message) => {
      clearTimeout(timer);
      await worker.terminate();
      try { assert.equal(message.error?.reason, 'NOT_PDF'); resolve(); } catch (error) { reject(error); }
    });
  });
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
    const pdfs = [];
    for (const pdfPath of pdfPaths) {
      const bytes = fs.readFileSync(pdfPath);
      const started = performance.now();
      const pings = [];
      let pingPending = false;
      const pingTimer = setInterval(async () => {
        if (pingPending) return;
        pingPending = true;
        const start = performance.now();
        try { await (await fetch(hub.url + '/api/papers')).text(); pings.push(performance.now() - start); }
        finally { pingPending = false; }
      }, 20);
      let response;
      let result;
      try {
        response = await fetch(hub.url + '/api/papers/upload', {
          method: 'POST', headers: { Origin: hub.url, 'x-paperread-token': hub.service.token, 'content-type': 'application/pdf' }, body: bytes,
        });
        result = await response.json();
      } finally { clearInterval(pingTimer); }
      assert.equal(response.status, 201, JSON.stringify(result));
      const paper = result.data.paper;
      assert.equal(paper.status, 'ready');
      const uploadAndExtractMs = Math.round(performance.now() - started);
      const extractionPeakRssMiB = Math.round(process.resourceUsage().maxRSS / 1024);
      const snapshot = await (await fetch(hub.url + '/api/papers/' + paper.paperKey)).text();
      let desktopOpenMs;
      let canvases;
      if (paper.pageCount > 300) {
        const { chromium } = require('playwright-core');
        const browser = await chromium.launch({ channel: 'chrome', headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          await fetch(hub.url + '/api/preferences', {
            method: 'PUT', headers: { Origin: hub.url, 'x-paperread-token': hub.service.token, 'content-type': 'application/json' },
            body: JSON.stringify({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }),
          });
          const open = performance.now();
          await page.goto(hub.url + '/#/paper/' + paper.paperKey);
          await page.waitForFunction(() => [...document.querySelectorAll('.pdf-page canvas')].some((canvas) => canvas.width > 300) && document.querySelectorAll('.textLayer span').length > 0);
          desktopOpenMs = Math.round(performance.now() - open);
          canvases = await page.locator('.pdf-page canvas').count();
        } finally { await browser.close(); }
      }
      pdfs.push({ file: path.basename(pdfPath), bytes: bytes.length, pages: paper.pageCount, status: paper.status,
        uploadAndExtractMs, extractionPeakRssMiB, snapshotBytes: Buffer.byteLength(snapshot), desktopOpenMs, canvases, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), maxPingMs: Math.round(Math.max(0, ...pings)) });
    }
    fs.writeFileSync(output, JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch, executable: process.execPath, ptyEntry, nativeEntry, binaries, hubStarted: true, uiServed: true, libraryApi: true, ptySpawn: true, pdfWorkerStarted: true, pdfWorkerEntry: workerEntry, pdfs, resources: hashes }, null, 2) + '\n');
  } finally { await hub.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
