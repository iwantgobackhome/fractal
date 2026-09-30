import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['packages/hub/src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@lydell/node-pty'],
  outfile: 'apps/desktop/dist/hub.mjs',
  banner: { js: "import { createRequire as fractalCreateRequire } from 'node:module'; const require = fractalCreateRequire(import.meta.url);" },
});
await copyFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'apps/desktop/dist/pdf.worker.mjs');
