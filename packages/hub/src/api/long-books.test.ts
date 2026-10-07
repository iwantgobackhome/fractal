import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Block, Paper, Translator } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import { JobManager } from '../jobs/state';
import { TranslationPipeline } from '../translation/index';
import { createApiServer, type ApiServerOptions } from './index';
import { generatedBook } from '../../test/generated-book';
import { sha256 } from '../pdf/index';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it('keeps long-book snapshots bounded, translates selected sections, and widens to the whole book without resending them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fractal-book-api-'));
  roots.push(root);
  const store = new SqlitePaperStore(root);
  const key = '2501.00001v1';
  const bytes = generatedBook(1);
  const paper: Paper = {
    paperKey: key,
    arxivId: '2501.00001',
    version: 1,
    title: 'Book',
    authors: [],
    sourceUrl: 'https://arxiv.org/pdf/2501.00001v1',
    pdfSha256: sha256(bytes),
    pageCount: 1232,
    extractionVersion: 'test',
    status: 'ready',
    coverage: { totalPages: 1232, textPages: 1232, unsupportedPages: [] },
    createdAt: new Date().toISOString(),
  };
  store.savePaper(paper, bytes);
  const blocks = Array.from({ length: 1232 }, (_, index): Block => ({
    blockId: `b${index}`,
    paperKey: key,
    order: index,
    kind: 'paragraph',
    sourceText: `Page ${index + 1} sentence.`,
    sourceHash: sha256(`Page ${index + 1} sentence.`),
    regions: [{ page: index + 1, x: 0.1, y: 0.1, width: 0.8, height: 0.1 }],
    alignment: 'exact',
    translatable: true,
    fontFamily: 'serif',
    fontWeight: 'normal',
    fontSize: 0.02,
    pageOrdinal: 0,
  }));
  store.saveBlocks(key, blocks);
  const sent: number[] = [];
  const translator: Translator = {
    connection: async () => ({ status: 'subscription', modelIds: ['gpt-6-sol'], defaultModelId: 'gpt-6-sol', limits: null }),
    disconnect: async () => {},
    translate: async () => {
      throw new Error('unused');
    },
    translatePage: async (input) => {
      sent.push(input.paragraphs[0].block.regions[0].page);
      return {
        results: input.paragraphs.map((p) => ({ number: p.number, text: `Translated ${p.block.sourceText}` })),
        usage: { inputTokens: null, outputTokens: null, limits: null, observedAt: null },
      };
    },
  };
  const jobs = new JobManager(store);
  const server = createApiServer({
    store,
    jobs,
    translator,
    pipeline: new TranslationPipeline({ store, jobs, translator }),
    acquirer: {} as ApiServerOptions['acquirer'],
    paperChat: {
      ask: async () => {
        throw new Error('unused');
      },
      forget: async () => {},
    },
  });
  const address = await server.listen(0),
    url = `http://127.0.0.1:${address.port}`;
  const post = async (range: Record<string, number> = {}) =>
    fetch(`${url}/api/papers/${key}/translation`, {
      method: 'POST',
      headers: { Origin: url, 'x-paperread-token': server.token, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'gpt-6-sol', ...range }),
    });
  const settle = async () => {
    for (let i = 0; i < 1000 && jobs.getJobForPaper(key)?.state === 'running'; i++) await new Promise((r) => setTimeout(r, 10));
  };
  try {
    const first = (await (await fetch(`${url}/api/papers/${key}`)).json()).data;
    expect(first.blocks).toHaveLength(30);
    expect(first.blockPageRange).toEqual({ start: 1, end: 30, totalPages: 1232 });
    expect(sent).toEqual([]); // Merely opening a book never spends the user's AI subscription.
    const last = (await (await fetch(`${url}/api/papers/${key}?pageStart=1231&pageEnd=1232`)).json()).data;
    expect(last.blocks).toHaveLength(2);
    expect((await fetch(`${url}/api/papers/${key}?pageStart=1&pageEnd=300`)).status).toBe(400);
    expect((await post({ pageStart: 31, pageEnd: 32 })).status).toBe(200);
    await settle();
    expect(sent).toEqual([31, 32]);
    expect(jobs.getJobForPaper(key)).toMatchObject({ state: 'completed', completedBlocks: 2, totalTranslatableBlocks: 2, pageRange: { start: 31, end: 32 } });
    expect((await post({ pageStart: 33, pageEnd: 34 })).status).toBe(200);
    await settle();
    expect(sent).toEqual([31, 32, 33, 34]);
    expect(store.listTranslations(key).filter((t) => t.status === 'completed')).toHaveLength(4);
    expect((await post({ pageStart: 1, pageEnd: 31 })).status).toBe(400);
    // A whole-document start translates every remaining page and reuses the sections already done.
    expect((await post()).status).toBe(200);
    await settle();
    expect(sent.slice(4)).toEqual(Array.from({ length: 1232 }, (_, i) => i + 1).filter((page) => page < 31 || page > 34));
    expect(jobs.getJobForPaper(key)).toMatchObject({ state: 'completed', completedBlocks: 1232, totalTranslatableBlocks: 1232 });
    expect(jobs.getJobForPaper(key)?.pageRange).toBeUndefined();
    expect(store.listTranslations(key).filter((t) => t.status === 'completed')).toHaveLength(1232);
  } finally {
    await server.close();
    store.db.close();
  }
}, 60_000);
