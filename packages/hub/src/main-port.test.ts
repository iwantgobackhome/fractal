import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { startHub } from './main';

describe('embedded hub port', () => {
  it('keeps the same port across restarts in one data directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'news-papers-port-'));
    try {
      const first = await startHub({ dataDirectory: root, log: () => {} });
      const url = first.url;
      expect(first.service.server.address()?.address).toBe('127.0.0.1');
      await first.close();
      const second = await startHub({ dataDirectory: root, log: () => {} });
      try {
        expect(second.url).toBe(url);
        expect(JSON.parse(readFileSync(join(root, 'hub-port.json'), 'utf8')).port).toBe(Number(new URL(url).port));
      } finally {
        await second.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('logs a busy persisted port and persists the fallback for the next restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'news-papers-port-'));
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
    const port = (busy.address() as { port: number }).port;
    writeFileSync(join(root, 'hub-port.json'), JSON.stringify({ port }));
    const log = vi.fn();
    try {
      const hub = await startHub({ dataDirectory: root, log });
      const url = hub.url;
      try {
        const assigned = Number(new URL(url).port);
        expect(assigned).not.toBe(port);
        expect(JSON.parse(readFileSync(join(root, 'hub-port.json'), 'utf8')).port).toBe(assigned);
        expect(log).toHaveBeenCalledWith({ event: 'service.port-busy', port, source: 'persisted', code: 'EADDRINUSE' });
      } finally {
        await hub.close();
      }
      const restarted = await startHub({ dataDirectory: root, log });
      try {
        expect(restarted.url).toBe(url);
      } finally {
        await restarted.close();
      }
    } finally {
      await new Promise<void>((resolve, reject) => busy.close((error) => (error ? reject(error) : resolve())));
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors explicit ports without replacing the persisted setting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'news-papers-port-'));
    writeFileSync(join(root, 'hub-port.json'), JSON.stringify({ port: 7327 }));
    try {
      const hub = await startHub({ dataDirectory: root, port: 0, log: () => {} });
      await hub.close();
      expect(JSON.parse(readFileSync(join(root, 'hub-port.json'), 'utf8')).port).toBe(7327);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
