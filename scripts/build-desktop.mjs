import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: { hub: 'packages/hub/src/main.ts', 'pdf-extraction.worker': 'packages/hub/src/pdf/extraction-worker.ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@lydell/node-pty'],
  outdir: 'apps/desktop/dist',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import { createRequire as fractalCreateRequire } from 'node:module'; const require = fractalCreateRequire(import.meta.url);" },
});
await copyFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'apps/desktop/dist/pdf.worker.mjs');
