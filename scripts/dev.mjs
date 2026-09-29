import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;

function start(args, env = process.env) {
  const child = spawn(npm, args, { stdio: 'inherit', env, shell: process.platform === 'win32', windowsHide: true });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid === undefined) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else child.kill('SIGTERM');
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

start(['run', 'hub'], { ...process.env, PAPERREAD_INDEX: resolve('packages/ui/index.html') });
start(['run', 'dev', '-w', '@fractal/ui']);
