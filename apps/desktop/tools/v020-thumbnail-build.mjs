import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
const backend = resolve(process.env.QA_BACKEND_ROOT || '.');
await build({
  entryPoints: ['apps/desktop/tools/v020-thumbnail-harness.ts'],
  outfile: 'apps/android/qa/v020-thumbnails/data/harness.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@qa/hub': join(backend, 'packages/hub/src'), '@fractal/shared': resolve('packages/shared/src/index.ts') },
  external: ['@lydell/node-pty'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [
    {
      name: 'import-main-without-standalone-start',
      setup(b) {
        b.onLoad({ filter: /packages[\\/]hub[\\/]src[\\/]main\.ts$/ }, (args) => {
          const source = readFileSync(args.path, 'utf8'),
            predicate = 'if (invokedDirectly()) {';
          if (source.split(predicate).length !== 2) throw Error('Unexpected Hub main bootstrap');
          return { contents: source.replace(predicate, 'if (false && invokedDirectly()) {'), loader: 'ts' };
        });
      },
    },
  ],
});
