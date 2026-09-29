import type { SqlitePaperStore } from '../store/sqlite';
import type { PaperStore } from '../store/index';
export interface LibraryHit {
  paperKey: string;
  title: string;
  page: number;
  text: string;
}
export interface LibrarySearch {
  searchLibrary(query: string, limit?: number): Promise<LibraryHit[]>;
}
export class InMemoryLibrarySearch implements LibrarySearch {
  constructor(private readonly store: PaperStore) {}
  async searchLibrary(query: string, limit = 12): Promise<LibraryHit[]> {
    const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const scored: { hit: LibraryHit; score: number }[] = [];
    for (const key of this.store.listPapers()) {
      const title = this.store.getPaper(key)?.title ?? key;
      for (const block of this.store.listBlocks(key)) {
        const text = block.sourceText.slice(0, 3000);
        const lower = `${title} ${text}`.toLowerCase();
        const score = words.reduce((n, word) => n + (lower.includes(word) ? 1 : 0), 0);
        if (score) scored.push({ hit: { paperKey: key, title, page: block.regions[0]?.page ?? 1, text }, score });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((v) => v.hit);
  }
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'what',
  'which',
  'how',
  'are',
  'was',
  'were',
  'from',
  'into',
  'does',
  'did',
  'use',
  'used',
  'using',
  'about',
  'paper',
  'papers',
  '논문',
  '무엇',
  '어떤',
  '어떻게',
  '있는',
  '사용한',
  '사용',
  '내가',
  '저장한',
]);

/** Question words for the full-text index: distinct, at least 2 characters, common words dropped. */
export function questionTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]+/gu) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))].slice(0, 16);
}

/**
 * Library-wide retrieval over the SQLite FTS5 index. A question rarely has every word
 * in one paragraph, so terms are OR-ed and BM25 orders the paragraphs.
 */
export class FtsLibrarySearch implements LibrarySearch {
  constructor(private readonly store: SqlitePaperStore) {}

  async searchLibrary(query: string, limit = 12): Promise<LibraryHit[]> {
    const terms = questionTerms(query);
    if (terms.length === 0) return [];
    const expression = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    const rows = this.store.db
      .prepare(
        'SELECT paper_key, block_id, page, bm25(paper_fts) AS score FROM paper_fts WHERE paper_fts MATCH ? AND block_id IS NOT NULL ORDER BY score LIMIT ?',
      )
      .all(expression, limit) as { paper_key: string; block_id: string; page: number | null }[];
    const hits: LibraryHit[] = [];
    for (const row of rows) {
      const block = this.store.getBlock(row.paper_key, row.block_id);
      if (block === null) continue;
      const title = this.store.getPaper(row.paper_key)?.title ?? row.paper_key;
      hits.push({ paperKey: row.paper_key, title, page: row.page ?? block.regions[0]?.page ?? 1, text: block.sourceText.slice(0, 3000) });
    }
    return hits;
  }
}
