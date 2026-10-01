// Focused HTTP proof using the production bundle; no response fixture or packaged claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

await mkdir('dist', { recursive: true });
const profile = await mkdtemp(resolve('dist', 'hub-envelope-review-'));
const bundle = resolve('apps/desktop/dist/hub.mjs');
const evidence = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  bundleSha256: createHash('sha256').update(await readFile(bundle)).digest('hex'),
  process: { pid: process.pid, executable: process.execPath, argv: process.argv },
  packaged: false,
};
if (process.platform === 'win32') {
  evidence.process.osIdentity = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}" | Select-Object ProcessId,ExecutablePath,CreationDate,CommandLine | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }));
}
let hub;
try {
  process.env.PAPERREAD_DATA = join(profile, 'legacy');
  const { startHub } = await import(pathToFileURL(bundle).href);
  hub = await startHub({ dataDirectory: join(profile, 'data'), port: 0, allowRealCli: false, startBackground: false });
  evidence.listener = hub.url;
  const response = await fetch(hub.url + '/api/papers');
  evidence.httpStatus = response.status;
  evidence.body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(evidence.body.data?.papers), 'actual production HTTP success envelope must contain data.papers');
  evidence.assertionPassed = true;
} finally {
  if (hub) await hub.close();
  evidence.hubClosed = Boolean(hub);
  assert.equal(dirname(resolve(profile)), resolve('dist'));
  assert.ok(basename(profile).startsWith('hub-envelope-review-'));
  await rm(profile, { recursive: true, force: true });
  evidence.ownedProfileRemoved = true;
}
await writeFile('docs/implementation/release/v020/built-hub-envelope.json', JSON.stringify(evidence, null, 2) + '\n');
console.log('PASS actual production Hub HTTP 200 with {data:{papers:[]}}; Hub closed and owned profile removed');
