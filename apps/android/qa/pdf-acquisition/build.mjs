import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const accepted = resolve(process.env.QA_ACCEPTED_ROOT || '.');
const sha = execFileSync('git', ['-C', accepted, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const backendSha = process.env.QA_ACCEPTED_SHA;
if (!backendSha) throw Error('Requires coordinator-supplied accepted source SHA');
execFileSync('git', ['-C', accepted, 'merge-base', '--is-ancestor', backendSha, sha]);
if (execFileSync('git', ['-C', accepted, 'diff', backendSha, sha, '--', 'packages/hub', 'packages/shared'], { encoding: 'utf8' }).trim()) throw Error('Backend/shared source differs from accepted supply');
if (execFileSync('git', ['-C', accepted, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('Accepted source must be clean');
const deps = resolve(process.env.QA_NODE_MODULES || '../w5-hub/node_modules');
const require = createRequire(join(deps, '../package.json'));
await require('esbuild').build({
  entryPoints: [resolve('apps/android/qa/pdf-acquisition/server.ts')],
  outfile: resolve('apps/android/qa/pdf-acquisition/data/server.bundle.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', nodePaths: [deps],
  alias: { '@fractal/shared': join(accepted, 'packages/shared/src/index.ts'), '@qa/hub': join(accepted, 'packages/hub/src') },
  define: { QA_ACCEPTED_SHA: JSON.stringify(backendSha), QA_HARNESS_SHA: JSON.stringify(sha) },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [{ name: 'import-main-without-standalone-start', setup(b) {
    b.onLoad({ filter: /packages[\\/]hub[\\/]src[\\/]main\.ts$/ }, args => {
      const source = readFileSync(args.path, 'utf8');
      const predicate = 'if (invokedDirectly()) {';
      if (source.split(predicate).length !== 2) throw Error('Expected exactly one standalone Hub entry predicate');
      return { contents: source.replace(predicate, 'if (false && invokedDirectly()) {'), loader: 'ts' };
    });
  } }, { name: 'pdf-worker-location', setup(b) {
    b.onResolve({ filter: /^pdfjs-dist\// }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  } }],
});
console.log(JSON.stringify({ acceptedSourceSha: backendSha, harnessSourceSha: sha, mainStandaloneBootstrapDisabled: true }));
