import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collectionSchema, libraryPatchSchema, libraryRecordSchema, readProgressSchema } from './library';
import { annotationSchema, syncPullSchema, syncPushSchema } from './sync';
import { memoSchema } from './annotations';
import { aiSseEventSchema, askPaperSchema, explainSchema } from './ai';

describe('backward-compatible foundation contracts', () => {
  const record = {
    id: 'record',
    paperKey: 'paper',
    title: null,
    authors: [],
    year: null,
    venue: null,
    doi: null,
    arxivId: null,
    url: null,
    abstract: null,
    tags: [],
    collections: ['legacy'],
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'unread',
    bibtexKey: 'key',
  };
  const memo = {
    id: randomUUID(),
    paperKey: 'paper',
    kind: 'memo',
    page: 1,
    text: 'Text',
    quote: null,
    rect: null,
    updatedAt: record.updatedAt,
    deleted: false,
    rev: 0,
    deviceId: 'android',
  };
  it('accepts old bibliography, collections, memos and annotation-only sync without inventing read timestamps', () => {
    expect(libraryRecordSchema.parse(record).lastReadAt).toBeUndefined();
    expect(collectionSchema.parse({ id: 'legacy', name: 'Old collection' }).parentId).toBeUndefined();
    expect(memoSchema.parse(memo)).toEqual(memo);
    expect(syncPushSchema.parse({ annotations: [memo] }).annotations).toEqual([memo]);
    expect(syncPullSchema.parse({ cursor: '1', papers: [record], annotations: [memo] })).toMatchObject({ cursor: '1' });
  });
  it('lets old non-strict pull decoders consume new arrays and keeps annotation semantics', () => {
    const oldRecord = libraryRecordSchema.omit({ saved: true, savedAt: true, lastReadAt: true, readProgress: true, rev: true, deviceId: true });
    const oldPull = z.object({ cursor: z.string(), papers: z.array(oldRecord), annotations: z.array(annotationSchema) });
    const payload = { cursor: '2', papers: [{ ...record, saved: false, lastReadAt: null }], annotations: [memo], folders: [], history: [], deletedPapers: [] };
    expect(oldPull.parse(payload)).toMatchObject({ cursor: '2', annotations: [memo] });
  });
  it('validates normalized physical-page progress and optional sticky appearance', () => {
    expect(readProgressSchema.parse({ page: 2, fraction: 0.5, scrollOffset: 0.2, blockId: 'anchor' })).toMatchObject({ page: 2 });
    expect(readProgressSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(readProgressSchema.safeParse({ page: 1, fraction: 2 }).success).toBe(false);
    expect(readProgressSchema.safeParse({ page: 1, scrollOffset: -0.2 }).success).toBe(false);
    expect(memoSchema.parse({ ...memo, collapsed: true, color: 'blue', rect: { x: 0.1, y: 0.2, width: 0.1, height: 0.2 } })).toMatchObject({
      collapsed: true,
      color: 'blue',
    });
    expect(libraryPatchSchema.parse({ saved: false, readProgress: null })).toEqual({ saved: false, readProgress: null });
  });
  it('keeps SSE opcodes and preserves history ID plus request IDs on validated requests', () => {
    expect(aiSseEventSchema.parse({ type: 'delta', text: '', historyId: 'durable' })).toEqual({ type: 'delta', text: '', historyId: 'durable' });
    expect(askPaperSchema.parse({ question: 'Why?', requestId: 'repeat' }).requestId).toBe('repeat');
    expect(explainSchema.parse({ kind: 'figure', page: 1, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, requestId: 'explain' }).requestId).toBe('explain');
  });
});
