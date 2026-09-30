// Read installed dependencies; bundle only this checkout's accepted production source.
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.cwd());
const deps = resolve(process.env.QA_NODE_MODULES || '../fractal-desktop/node_modules');
const require = createRequire(join(deps, '../package.json'));
const { build } = require('esbuild');
await build({
  entryPoints: [join(root, 'docs/implementation/qa/reader-prerequisite/probe.ts')],
  outfile: join(root, 'docs/implementation/qa/reader-prerequisite/probe.bundle.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', nodePaths: [deps],
  alias: { '@fractal/shared': join(root, 'packages/shared/src/index.ts') },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [{ name: 'keep-pdfjs-worker-location', setup(b) {
    b.onResolve({ filter: /^pdfjs-dist\// }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  } }],
});
console.log('Bundled accepted source with dependencies from ' + deps);
