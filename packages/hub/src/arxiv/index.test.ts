import { describe, expect, it } from 'vitest';
import { normalizeArxiv } from './index';

describe('normalizeArxiv', () => {
  it('normalizes versioned IDs and canonical PDF URLs', () => {
    expect(normalizeArxiv('arxiv:2409.01234v2')).toEqual({ arxivId: '2409.01234', version: 2, paperKey: '2409.01234v2' });
    expect(normalizeArxiv('https://arxiv.org/pdf/2409.01234v2.pdf').paperKey).toBe('2409.01234v2');
  });
  it('rejects lookalike hosts and malformed versions', () => {
    expect(() => normalizeArxiv('https://arxiv.org.evil.example/abs/2409.01234')).toThrow();
    expect(() => normalizeArxiv('2409.01234v0')).toThrow();
  });
});
