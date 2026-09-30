import { _electron } from 'playwright-core';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'fractal-packaged-limits-'));
const data = join(root, 'data');
const profile = join(root, 'profile');
if (process.env.FRACTAL_COPY_DATA === '1') cpSync(join(homedir(), 'AppData', 'Local', 'Fractal'), data, { recursive: true });
const executablePath = resolve('dist/installer/win-unpacked/Fractal.exe');
let electron;
try {
  electron = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env: { ...process.env, FRACTAL_DATA: data }, timeout: 30000 });
  const window = await electron.firstWindow({ timeout: 30000 });
  const url = new URL(window.url());
  let accounts;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${url.origin}/api/ai/limits`);
    const payload = await response.json();
    accounts = payload.data?.accounts;
    if (accounts?.every((account) => !/Checking|확인하고/.test(account.message ?? ''))) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log(JSON.stringify({ origin: url.origin, accounts }, null, 2));
} finally {
  await electron?.close();
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('fractal-packaged-limits-')) throw new Error('Unsafe probe directory');
  rmSync(root, { recursive: true, force: true });
}
