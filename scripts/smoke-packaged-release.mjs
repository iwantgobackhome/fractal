import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import assert from 'node:assert/strict';

const platform = process.platform;
const arch = process.arch;
const output = resolve('dist/release', `${platform}-${arch}`);
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(resolve('dist', 'release-smoke-'));
try {
  const installer = resolve('dist/installer');
  let bundle;
  let executable;
  let resources;
  if (platform === 'darwin') {
    const directory = join(installer, arch === 'arm64' ? 'mac-arm64' : 'mac');
    bundle = join(directory, (await readdir(directory)).find((name) => name.endsWith('.app')));
    executable = join(bundle, 'Contents/MacOS/News Papers');
    resources = join(bundle, 'Contents/Resources');
  } else {
    bundle = join(installer, platform === 'win32' ? 'win-unpacked' : 'linux-unpacked');
    executable = join(bundle, platform === 'win32' ? 'news-papers.exe' : 'news-papers');
    resources = join(bundle, 'resources');
  }
  const report = join(output, `smoke-${platform}-${arch}.json`);
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test', FRACTAL_DATA: join(temporary, 'data'), PAPERREAD_DATA: join(temporary, 'legacy'), FRACTAL_DESKTOP_PROFILE: join(temporary, 'profile') };
  await mkdir(env.FRACTAL_DATA, { recursive: true });
  const child = spawn(executable, [resolve('scripts/packaged-release-probe.cjs'), join(resources, 'app.asar'), report], { env, windowsHide: true, stdio: 'inherit' });
  await new Promise((resolvePromise, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => { clearTimeout(timer); !timedOut && code === 0 ? resolvePromise() : reject(new Error(timedOut ? 'packaged smoke timed out' : `packaged smoke exit ${code}`)); });
  });
  const result = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(result.platform, platform);
  assert.equal(result.arch, arch);
  assert.ok(result.hubStarted && result.ptySpawn && result.pdfWorkerStarted);
  console.log(`Actual packaged Hub, PDF worker and PTY passed: ${platform}-${arch}`);
} finally {
  // Only the uniquely created directory from this process is removed.
  assert.equal(dirname(resolve(temporary)), resolve('dist'));
  assert.ok(basename(temporary).startsWith('release-smoke-'));
  await rm(temporary, { recursive: true, force: true });
}
