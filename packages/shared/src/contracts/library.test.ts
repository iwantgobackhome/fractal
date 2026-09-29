import { describe, expect, it } from 'vitest';
import { regionSchema } from './library';

describe('regionSchema', () => {
  it('accepts a finite page rectangle and rejects invalid page numbers and coordinates', () => {
    const region = { page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    expect(regionSchema.parse(region)).toEqual(region);
    expect(regionSchema.safeParse({ ...region, page: 0 }).success).toBe(false);
    expect(regionSchema.safeParse({ ...region, width: Infinity }).success).toBe(false);
  });
});
