import type { SearchHit } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';

let configuredStore: SqlitePaperStore | null = null;
export function configureLibrarySearch(store: SqlitePaperStore): void { configuredStore = store; }
/** FTS5 ranking uses BM25; a lower score is a better match. */
export function searchLibrary(query: string, options: { limit?: number; store?: SqlitePaperStore } = {}): SearchHit[] {
  const store = options.store ?? configuredStore;
  if (!store) throw new Error('library search is not configured');
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 20;
  const tokens = query.match(/[\p{L}\p{N}]+/gu)?.slice(0,16) ?? [];
  if (!tokens.length) return [];
  const expression = tokens.map(t=>`"${t}"`).join(' AND ');
  const rows = store.db.prepare(`SELECT paper_key,block_id,page,CASE WHEN block_id IS NULL THEN title ELSE snippet(paper_fts,6,'<mark>','</mark>','…',20) END AS snippet,bm25(paper_fts) AS score FROM paper_fts WHERE paper_fts MATCH ? ORDER BY score LIMIT ?`).all(expression,limit) as Array<Record<string,unknown>>;
  return rows.map(r=>({paperKey:String(r.paper_key),page:r.page===null?null:Number(r.page),blockId:r.block_id===null?null:String(r.block_id),snippet:String(r.snippet),score:Number(r.score)}));
}
