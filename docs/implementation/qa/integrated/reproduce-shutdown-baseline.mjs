/** Real isolated upload/stop reproduction using accepted pre-fix service/API source, never the retained D Hub. */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve('.'),
  owned = join(root, 'docs/implementation/qa/integrated');
const snapshot = '3a2cf10617b85dbbbf74aea25b810730175448cc';
await mkdir(join(owned, 'runtime'), { recursive: true });
const bundle = join(owned, 'runtime/shutdown-baseline.bundle.mjs');
await build({
  stdin: {
    contents:
      "export { startService } from './packages/hub/src/main'; export { PdfJsStructureDetector } from './packages/hub/src/structure/detector'; export { TOKEN_HEADER } from './packages/hub/src/api/index';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@lydell/node-pty'],
  outfile: bundle,
  banner: { js: "import { createRequire as qaRequire } from 'node:module'; const require = qaRequire(import.meta.url);" },
  plugins: [
    {
      name: 'accepted-before-fix',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]packages[\\/]hub[\\/]src[\\/](?:structure[\\/]service|api[\\/]index)\.ts$/ }, (args) => ({
          contents: execFileSync('git', ['show', snapshot + ':' + relative(root, args.path).replaceAll('\\', '/')], { encoding: 'utf8' }),
          loader: 'ts',
          resolveDir: resolve(args.path, '..'),
        }));
      },
    },
  ],
});
await copyFile(join(root, 'packages/hub/dist/pdf.worker.mjs'), join(owned, 'runtime/pdf.worker.mjs'));
const { startService, PdfJsStructureDetector, TOKEN_HEADER } = await import(pathToFileURL(bundle).href);
const directory = await mkdtemp(join(owned, 'runtime/shutdown-baseline-'));
process.env.NODE_ENV = 'test';
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
let began, reject;
const started = new Promise((done) => {
  began = done;
});
const flight = new Promise((_done, fail) => {
  reject = fail;
});
PdfJsStructureDetector.prototype.detect = () => {
  began();
  return flight;
};
let observed;
const unhandled = new Promise((done) => {
  observed = done;
});
const onUnhandled = (error) => observed(String(error));
process.on('unhandledRejection', onUnhandled);
const hub = await startService({ dataDirectory: directory, port: 0, allowRealCli: false, startBackground: false, log() {} });
let closed = false,
  timer;
try {
  const bytes = await readFile(join(root, 'packages/hub/test/fixtures/text-layout.pdf'));
  const response = await fetch(hub.url + '/api/papers/upload', {
    method: 'POST',
    headers: { origin: hub.url, [TOKEN_HEADER]: hub.token, 'content-type': 'application/pdf' },
    body: bytes,
  });
  assert.equal(response.status, 201);
  const paper = (await response.json()).data.paper;
  await started;
  await hub.stop();
  closed = true;
  reject(Error('controlled detector failure after immediate upload shutdown'));
  const error = await Promise.race([
    unhandled,
    new Promise((_done, fail) => {
      timer = setTimeout(() => fail(Error('Expected baseline rejection absent')), 2000);
    }),
  ]);
  assert.match(error, /database is not open/i);
  await mkdir(join(owned, 'shutdown-evidence'), { recursive: true });
  await writeFile(
    join(owned, 'shutdown-evidence/baseline.json'),
    JSON.stringify(
      {
        sourceSha: snapshot,
        status: 'reproduced',
        route: 'POST /api/papers/upload',
        httpStatus: response.status,
        paperKey: paper.paperKey,
        detector: 'controlled pending then reject after stop',
        unhandledRejection: error,
        hubStopped: closed,
        isolation: 'fresh E-only disposable Hub; retained Hub40024 and D fixture untouched',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Accepted baseline real HTTP upload/immediate-stop reproduced unhandled closed-SQLite rejection');
} finally {
  clearTimeout(timer);
  if (!closed) await hub.stop();
  process.off('unhandledRejection', onUnhandled);
}
