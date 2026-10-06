import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { generatedBook } from '../../test/generated-book';
import { extractPdf } from './index';
import { PDF_LIMITS } from './limits';

describe('long books', () => {
  it('extracts 400 pages with cleanup/progress and serves HTTP while extracting', async () => {
    const bytes = generatedBook(400);
    const server = createServer((_req, res) => res.end('pong'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const samples: Promise<number>[] = [];
    let progress = 0;
    try {
      const result = await extractPdf(bytes, '2501.00001v1', {
        onProgress: (page) => {
          progress = page;
          if (page % 50 === 0) {
            const started = performance.now();
            samples.push(
              fetch(`http://127.0.0.1:${port}`)
                .then((r) => r.text())
                .then(() => performance.now() - started),
            );
          }
        },
      });
      expect(result.coverage.totalPages).toBe(400);
      expect(result.coverage.textPages).toBe(400);
      expect(progress).toBe(400);
      expect(Math.max(...(await Promise.all(samples)))).toBeLessThan(200);
      expect(result.blocks.some((b) => b.regions[0].page === 400)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);

  it('rejects more than 3000 pages with a localized limit error', async () => {
    await expect(extractPdf(generatedBook(3001), '2501.00001v1')).rejects.toMatchObject({ code: 'TOO_LARGE', message: expect.stringContaining('3000') });
    expect(PDF_LIMITS.bytes).toBe(300 * 1024 * 1024);
  }, 30_000);

  it('terminates a worker that misses its page deadline and leaves the next import usable', async () => {
    const bytes = generatedBook(400);
    await expect(extractPdf(bytes, '2501.00001v1', { pageTimeoutMs: 1 })).rejects.toMatchObject({ reason: 'PAGE_TIMEOUT' });
    const next = await extractPdf(bytes, '2501.00002v1');
    expect(next.coverage.textPages).toBe(400);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); // Transferring the worker copy preserves the caller's bytes.
  }, 30_000);
});
