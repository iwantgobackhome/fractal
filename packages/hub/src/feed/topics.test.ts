import { describe, expect, it } from 'vitest';
import { topicSeeds, type FeedItem } from '@fractal/shared';
import { extractTrending, TopicService } from './topics';
import { retainNewsByField } from './index';
import { deduplicate } from './ranking';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlitePaperStore } from '../store/sqlite';

describe('field topics', () => {
  it('seeds every requested field and follows the first six', () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-topics-'));
    const store = new SqlitePaperStore(root);
    try {
      const topics = new TopicService(store);
      for (const field of ['cs.AI', 'cs.CL', 'cs.CV', 'cs.LG', 'cs.RO', 'stat.ML', 'q-bio.NC', 'quant-ph', 'cond-mat.mtrl-sci', 'eess.AS', 'eess.IV']) {
        expect(topicSeeds[field]?.length).toBeGreaterThanOrEqual(6);
        expect(topics.list(field).filter((topic) => topic.followed)).toHaveLength(6);
      }
      const codex = topics.list('cs.AI').find((topic) => topic.label === 'Codex')!;
      topics.follow(codex.id, false);
      expect(topics.list('cs.AI').find((topic) => topic.id === codex.id)?.followed).toBe(false);
      const custom = topics.add('cs.AI', 'New model');
      expect(topics.list('cs.AI')).toContainEqual(custom);
      topics.delete(custom.id);
      expect(topics.list('cs.AI')).not.toContainEqual(custom);
    } finally {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('extracts terms seen in three distinct headlines and ignores generic/outlet terms', () => {
    const topics = extractTrending(
      [
        { title: 'GPT-6 arrives from OpenAI - Example Daily' },
        { title: 'GPT-6 benchmark from OpenAI - Example Daily' },
        { title: 'OpenAI releases GPT-6 tools - Example Daily' },
        { title: 'Scientists study the sky - Example Daily' },
      ],
      'cs.AI',
    );
    expect(topics).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'GPT-6', score: 3 })]));
    expect(topics.some((topic) => topic.label === 'Example Daily')).toBe(false);
  });
  it('retains at most 15 per followed topic and merges topic ids across duplicate stories', () => {
    const news = Array.from(
      { length: 25 },
      (_, index) => ({ id: `news-${index}`, kind: 'news', categories: ['cs.AI'], topicIds: ['topic-a'] }) as unknown as FeedItem,
    );
    const kept = retainNewsByField(news, { categories: [], topics: [], authors: [], custom: [] });
    expect(kept).toHaveLength(15);
    const base = {
      id: 'a',
      kind: 'news',
      title: 'OpenAI releases a model',
      abstract: '',
      authors: [],
      source: 'Example',
      publishedAt: '2026-09-30T00:00:00Z',
      popularity: 0,
      url: 'https://example.com/a',
      arxivId: null,
      doi: null,
      categories: ['cs.AI'],
      topicIds: ['topic-a'],
    };
    const merged = deduplicate([base, { ...base, id: 'b', topicIds: ['topic-b'] }] as any);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.topicIds).toEqual(['topic-a', 'topic-b']);
  });
});
