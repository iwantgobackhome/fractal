import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../main';

describe('service shutdown', () => {
  it('aborts an in-flight feed refresh before closing SQLite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-shutdown-'));
    let started!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      started = resolve;
    });
    const aborted = vi.fn();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          started();
          const signal = init?.signal;
          if (!signal) return reject(new Error('Feed request has no abort signal'));
          const cancel = () => {
            aborted();
            reject(signal.reason);
          };
          if (signal.aborted) cancel();
          else signal.addEventListener('abort', cancel, { once: true });
        }),
    ) as unknown as typeof fetch;
    const service = await startService({ dataDirectory: root, port: 0, log: () => {}, allowRealCli: false, startBackground: true, fetcher });
    try {
      await Promise.race([firstRequest, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Feed did not start')), 1500))]);
      const startedAt = Date.now();
      await service.stop();
      expect(Date.now() - startedAt).toBeLessThan(1500);
      expect(aborted).toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps real CLI probes disabled by default under Vitest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-no-cli-'));
    const service = await startService({ dataDirectory: root, port: 0, log: () => {} });
    try {
      const response = await fetch(`${service.url}/api/ai/providers`, { signal: AbortSignal.timeout(1500) });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { providers: Array<{ status: { loggedIn: boolean } }> } };
      expect(body.data.providers.every((provider) => !provider.status.loggedIn)).toBe(true);
    } finally {
      await service.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
