import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  entryPoints: ['packages/hub/src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@lydell/node-pty', '@napi-rs/canvas'],
  outfile: 'packages/hub/dist/index.mjs',
  absWorkingDir: root,
  banner: { js: "import { createRequire as fractalCreateRequire } from 'node:module'; const require = fractalCreateRequire(import.meta.url);" },
});
await copyFile(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'), join(root, 'packages/hub/dist/pdf.worker.mjs'));
