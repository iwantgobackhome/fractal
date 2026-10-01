import { describe, expect, it, vi } from 'vitest';
import { FeedImages, feedImagePath } from './feed-images';
import { HubApi } from './hub-api';

const path = `/api/feed/images/${'a'.repeat(64)}`;
const ok = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
describe('captured Hub image bytes', () => {
  it('expires a stalled visible body within fifteen seconds and releases the stream', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      let captured: AbortSignal | undefined;
      const cache = new FeedImages(async (_path, signal) => {
        captured = signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
            cancel,
          }),
          { headers: { 'content-type': 'image/png' } },
        );
      });
      const lease = cache.acquire(path);
      const rejected = expect(lease.blob).rejects.toThrow('Image unavailable');
      await vi.advanceTimersByTimeAsync(15_001);
      await rejected;
      expect(captured?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      lease.release();
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects external, traversal, query and ambiguous routes before transport', () => {
    for (const value of ['https://publisher.org/image.png', `//hub${path}`, `${path}?token=x`, `${path}/..`, path.toUpperCase()]) {
      expect(feedImagePath(value)).toBeNull();
    }
    expect(feedImagePath(path)).toBe(path);
    const transport = vi.fn();
    expect(() => new FeedImages(transport).acquire('https://publisher.org/pic')).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('deduplicates leases, cancels only after last owner and permits a fresh request', async () => {
    const signals: AbortSignal[] = [];
    const cache = new FeedImages(async (_path, signal) => {
      signals.push(signal);
      return await new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('cancelled'))));
    });
    const a = cache.acquire(path),
      b = cache.acquire(path);
    const failure = expect(a.blob).rejects.toThrow('cancelled');
    a.release();
    expect(signals[0].aborted).toBe(false);
    b.release();
    await failure;
    expect(signals[0].aborted).toBe(true);
    const c = cache.acquire(path);
    expect(signals).toHaveLength(2);
    const retry = expect(c.blob).rejects.toThrow('cancelled');
    c.release();
    await retry;
  });
  it('uses authenticated same-origin transport and isolates each HubApi cache', async () => {
    const transport = vi.fn(async () => ok());
    const hub = new HubApi('account-one', transport);
    const a = hub.feedImages.acquire(path);
    await a.blob;
    a.release();
    const b = hub.feedImages.acquire(path);
    await b.blob;
    b.release();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]).toEqual([
      path,
      expect.objectContaining({
        headers: { 'x-paperread-token': 'account-one' },
        credentials: 'same-origin',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    ]);
    const second = new HubApi('account-two', transport).feedImages.acquire(path);
    await second.blob;
    second.release();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('rejects HTML and oversize streaming responses without retaining failed entries', async () => {
    let attempt = 0;
    const cache = new FeedImages(async () => (++attempt === 1 ? new Response('login', { headers: { 'content-type': 'text/html' } }) : ok()));
    const a = cache.acquire(path);
    await expect(a.blob).rejects.toThrow();
    a.release();
    const b = cache.acquire(path);
    expect((await b.blob).size).toBe(3);
    b.release();
    const large = new FeedImages(async () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }));
    const c = large.acquire(path);
    await expect(c.blob).rejects.toThrow();
    c.release();
  });
});
