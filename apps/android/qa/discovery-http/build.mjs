import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve('.');
const deps = resolve(process.env.QA_NODE_MODULES || '../fractal-desktop/node_modules');
const require = createRequire(join(deps, '../package.json'));
await require('esbuild').build({
  entryPoints: [join(root, 'apps/android/qa/discovery-http/server.ts')],
  outfile: join(root, 'apps/android/qa/discovery-http/server.bundle.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', nodePaths: [deps],
  alias: { '@fractal/shared': join(root, 'packages/shared/src/index.ts') },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [{ name: 'pdf-worker-location', setup(b) {
    b.onResolve({ filter: /^pdfjs-dist\// }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  } }],
});
