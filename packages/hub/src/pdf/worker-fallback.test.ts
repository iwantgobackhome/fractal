import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { generatedBook } from '../../test/generated-book';

const startup = vi.hoisted(() => ({ mode: 'constructor' }));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super();
      if (startup.mode === 'uncoded') throw new Error('Worker unavailable');
      if (startup.mode === 'constructor') throw Object.assign(new Error('Worker unavailable'), { code: 'ERR_WORKER_INIT_FAILED' });
      setImmediate(() => this.emit('error', Object.assign(new Error('Missing packaged entrypoint'), { code: 'ERR_MODULE_NOT_FOUND' })));
    }
    async terminate() { return 0; }
  },
}));
import { extractPdf } from './index';

describe('PDF worker startup fallback', () => {
  it.each(['constructor', 'uncoded', 'module'])('extracts and preserves caller bytes after %s failure', async (mode) => {
    startup.mode = mode;
    const bytes = generatedBook(400);
    let progress = 0;
    const result = await extractPdf(bytes, 'fallback-book', { onProgress: (page) => { progress = page; } });
    expect(result.coverage.textPages).toBe(400);
    expect(progress).toBe(400);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);
});
