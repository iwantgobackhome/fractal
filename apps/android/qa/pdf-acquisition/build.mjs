import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const accepted = resolve(process.env.QA_ACCEPTED_ROOT || '.');
const sha = execFileSync('git', ['-C', accepted, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!process.env.QA_ACCEPTED_SHA || sha !== process.env.QA_ACCEPTED_SHA) throw Error('Requires coordinator-supplied accepted source SHA');
if (execFileSync('git', ['-C', accepted, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('Accepted source must be clean');
const deps = resolve(process.env.QA_NODE_MODULES || '../w5-hub/node_modules');
const require = createRequire(join(deps, '../package.json'));
await require('esbuild').build({
  entryPoints: [resolve('apps/android/qa/pdf-acquisition/server.ts')],
  outfile: resolve('apps/android/qa/pdf-acquisition/data/server.bundle.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', nodePaths: [deps],
  alias: { '@fractal/shared': join(accepted, 'packages/shared/src/index.ts'), '@qa/hub': join(accepted, 'packages/hub/src') },
  define: { QA_ACCEPTED_SHA: JSON.stringify(sha) },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [{ name: 'pdf-worker-location', setup(b) {
    b.onResolve({ filter: /^pdfjs-dist\// }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  } }],
});
console.log(JSON.stringify({ acceptedSourceSha: sha }));
