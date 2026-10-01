/** Only opaque, Hub-owned image identities may reach a device transport. */
export function feedImagePath(value: string | undefined): string | null {
  return value && /^\/api\/feed\/images\/[0-9a-f]{64}$/.test(value) ? value : null;
}

const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_CACHE = 16 * 1024 * 1024;
type Entry = { controller: AbortController; users: number; blob?: Blob; promise: Promise<Blob> };

/** One immutable HubApi owns this cache; another connection never shares its bytes. */
export class FeedImages {
  private entries = new Map<string, Entry>();
  constructor(private readonly fetchImage: (path: string, signal: AbortSignal) => Promise<Response>) {}

  acquire(path: string): { blob: Promise<Blob>; release(): void } {
    if (!feedImagePath(path)) throw new Error('Invalid Hub image');
    let entry = this.entries.get(path);
    if (!entry) {
      this.trim();
      if (this.entries.size >= 32) throw new Error('Image cache busy');
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 15_000);
      entry = { controller, users: 0, promise: this.load(path, controller.signal) };
      const captured = entry;
      entry.promise = entry.promise
        .then((blob) => {
          captured.blob = blob;
          this.trim();
          return blob;
        })
        .catch((error: unknown) => {
          if (this.entries.get(path) === captured) this.entries.delete(path);
          throw error;
        })
        .finally(() => clearTimeout(deadline));
      this.entries.set(path, entry);
    }
    entry.users++;
    // Refresh LRU order without resetting another Hub's state.
    this.entries.delete(path);
    this.entries.set(path, entry);
    const captured = entry;
    let released = false;
    return {
      blob: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        captured.users--;
        if (!captured.users && !captured.blob) {
          captured.controller.abort();
          if (this.entries.get(path) === captured) this.entries.delete(path);
        }
        this.trim();
      },
    };
  }

  private trim(): void {
    let size = [...this.entries.values()].reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0);
    for (const [path, entry] of this.entries) {
      if (size <= MAX_CACHE && this.entries.size < 32) break;
      if (entry.users || !entry.blob) continue;
      size -= entry.blob.size;
      this.entries.delete(path);
    }
  }

  private async load(path: string, signal: AbortSignal): Promise<Blob> {
    const response = await this.fetchImage(path, signal);
    const type = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!response.ok || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(type) || !response.body || response.redirected) {
      await response.body?.cancel();
      throw new Error('Image unavailable');
    }
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE || signal.aborted) throw new Error('Image unavailable');
        chunks.push(new Uint8Array(value));
      }
      if (!size || signal.aborted) throw new Error('Image unavailable');
      return new Blob(chunks, { type });
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }
}
