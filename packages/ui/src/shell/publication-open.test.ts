import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicationBookmark, PublicationPdfLinkResult } from '@fractal/shared';
import { HubApi } from './hub-api';

const item: PublicationBookmark = { title: 'Available scholarly paper', authors: ['Author'], url: 'https://publisher.example/paper', doi: '10.1234/paper' };
const readable = {
  paperKey: 'stable-key',
  hasPdf: true,
  record: { paperKey: 'stable-key', saved: false },
  paper: { paperKey: 'stable-key', pdfSha256: 'actual-hash' },
} as PublicationPdfLinkResult;
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('explicit publication PDF acquisition', () => {
  it('shares simultaneous lookup and sends only publication metadata, with no Save or Recent request', async () => {
    let resolve!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const changed = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: changed });
    const hub = new HubApi('token', transport);
    const enriched = { ...item, id: 'feed-id', saved: true };
    const first = hub.openPublication(enriched),
      second = hub.openPublication(enriched);
    expect(first).toBe(second);
    expect(transport).toHaveBeenCalledTimes(1);
    const [path, request] = transport.mock.calls[0];
    expect(path).toBe('/api/publications/open');
    expect(request).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json', 'x-paperread-token': 'token' } });
    expect(JSON.parse(request!.body as string)).toEqual(item);
    resolve(response(readable));
    expect(await first).toEqual(readable);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].type).toBe('fractal:catalog-changed');
  });

  it.each([404, 405, 501])('honestly returns unavailable from old Hub route (%s), without a catalog event', async (status) => {
    const changed = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: changed });
    const hub = new HubApi(
      null,
      vi.fn<typeof fetch>(async () => new Response('', { status })),
    );
    expect(await hub.openPublication(item)).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([
    { ...readable, hasPdf: false },
    { ...readable, record: { paperKey: 'other-key' } },
    { ...readable, paper: { paperKey: 'stable-key', pdfSha256: null } },
    null,
  ])('rejects a response that cannot prove a readable association', async (result) => {
    const changed = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: changed });
    const hub = new HubApi(
      null,
      vi.fn<typeof fetch>(async () => response(result)),
    );
    if (result === null) expect(await hub.openPublication(item)).toBeNull();
    else await expect(hub.openPublication(item)).rejects.toMatchObject({ code: 'pdf_open_invalid' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('preserves a structured rejection and permits a fresh retry', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'PDF_AUTH_REQUIRED', message: 'Publisher requires sign-in', details: { source: 'publisher' } } }), {
          status: 403,
        }),
      )
      .mockResolvedValueOnce(response(readable));
    const hub = new HubApi(null, transport);
    await expect(hub.openPublication(item)).rejects.toMatchObject({ code: 'PDF_AUTH_REQUIRED', message: 'Publisher requires sign-in', httpStatus: 403 });
    expect(await hub.openPublication(item)).toEqual(readable);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('bounds a hung transport even if it ignores abort; a late reply cannot announce a catalog change', async () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: changed });
    let finish!: (response: Response) => void;
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(response(readable));
    const hub = new HubApi(null, transport);
    const pending = hub.openPublication(item);
    const failed = expect(pending).rejects.toMatchObject({ code: 'pdf_open_timeout' });
    await vi.advanceTimersByTimeAsync(90_000);
    await failed;
    expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(true);
    finish(response(readable));
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(await hub.openPublication(item)).toEqual(readable);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
