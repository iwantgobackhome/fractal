// Optional developer measurement: requires an already built macOS app directory and Chrome.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'fractal-packaged-book-'));
try {
  const pdf = join(root, 'book.pdf');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/generate-book-pdf.ts', pdf, ...(process.argv.includes('--images') ? ['--images'] : [])]);
  const bundle = resolve('dist/installer', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'News Papers.app/Contents');
  const data = join(root, 'data');
  mkdirSync(data);
  const report = join(root, 'measurement.json');
  execFileSync(join(bundle, 'MacOS/News Papers'), [resolve('scripts/packaged-release-probe.cjs'), join(bundle, 'Resources/app.asar'), report, pdf], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test', FRACTAL_DATA: data, PAPERREAD_DATA: join(root, 'no-legacy'), FRACTAL_DESKTOP_PROFILE: join(root, 'profile') },
    stdio: 'inherit',
  });
  console.log(JSON.stringify(JSON.parse(readFileSync(report, 'utf8')).pdfs, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
