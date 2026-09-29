import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Block, Paper } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import { FtsLibrarySearch, questionTerms } from './library-search';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

function paper(key: string, title: string): Paper {
  return { paperKey: key, sourceKind: 'publication', arxivId: null, version: null, title, authors: [], sourceUrl: 'https://example.org/p.pdf', pdfSha256: hash(key), pageCount: 2, extractionVersion: 'test', status: 'ready', coverage: { totalPages: 2, textPages: 2, unsupportedPages: [] }, createdAt: '2026-09-30T00:00:00.000Z' };
}

function block(key: string, id: string, page: number, text: string): Block {
  return { blockId: id, paperKey: key, order: page, kind: 'paragraph', sourceText: text, sourceHash: hash(text), regions: [{ page, x: 0.1, y: 0.1, width: 0.8, height: 0.1 }], alignment: 'exact', translatable: true, fontFamily: 'serif', fontWeight: 'normal', fontSize: 0.012, pageOrdinal: 0 };
}

const A = `pdf-${hash('a')}-${hash('a.pdf')}`;
const B = `pdf-${hash('b')}-${hash('b.pdf')}`;

describe('FtsLibrarySearch', () => {
  it('drops question words that carry no content', () => {
    expect(questionTerms('Which papers use contrastive learning with diffusion?')).toEqual(['contrastive', 'learning', 'diffusion']);
    expect(questionTerms('내가 저장한 논문 중 diffusion 모델을 사용한 것은?')).toEqual(['diffusion', '모델을', '것은']);
  });

  it('finds paragraphs that match only some of the question words, best first', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-fts-'));
    roots.push(root);
    const store = new SqlitePaperStore(root);
    try {
      store.savePaper(paper(A, 'Diffusion Models'));
      store.saveBlocks(A, [block(A, 'a1', 1, 'We train a denoising diffusion model on images.'), block(A, 'a2', 2, 'Results on CIFAR-10.')]);
      store.savePaper(paper(B, 'Contrastive Learning'));
      store.saveBlocks(B, [block(B, 'b1', 1, 'Contrastive learning with diffusion augmentations improves robustness.')]);

      const hits = await new FtsLibrarySearch(store).searchLibrary('Which papers use contrastive learning with diffusion?');
      expect(hits.map((h) => h.paperKey)).toEqual([B, A]);
      expect(hits[0]).toMatchObject({ title: 'Contrastive Learning', page: 1 });
      expect(hits[0].text).toContain('Contrastive learning');
    } finally {
      store.db.close();
    }
  });
});
