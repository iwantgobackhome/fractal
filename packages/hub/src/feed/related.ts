import type { RelatedPaper, RelatedPapersResponse } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { notFound } from '../store/errors';

type Row = Record<string, unknown>;
const FIELDS = 'title,authors,year,venue,abstract,url,externalIds,citationCount';
let requestQueue = Promise.resolve();
function queue<T>(task: () => Promise<T>): Promise<T> {
  const result = requestQueue.then(task, task);
  requestQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
async function getJson(url: string, fetcher: typeof fetch): Promise<Row> {
  return queue(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = {};
      if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(15000) });
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(60000, retryAfter * 1000) : 10000 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) throw Object.assign(new Error(`Semantic Scholar HTTP ${response.status}`), { code: response.status === 429 ? 'QUOTA' : 'NETWORK' });
      return (await response.json()) as Row;
    }
    throw Object.assign(new Error('Semantic Scholar rate limited'), { code: 'QUOTA' });
  });
}
function normalize(raw: unknown, relation: RelatedPaper['relation'], library: ReturnType<SqlitePaperStore['listLibrary']>): RelatedPaper | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  if (typeof row.title !== 'string' || !row.title.trim()) return null;
  const title = row.title;
  const ids = row.externalIds && typeof row.externalIds === 'object' ? (row.externalIds as Row) : {};
  const arxivId = typeof ids.ArXiv === 'string' ? ids.ArXiv.replace(/v\d+$/, '') : null;
  const doi = typeof ids.DOI === 'string' ? ids.DOI : null;
  const url =
    typeof row.url === 'string' && row.url.startsWith('https://')
      ? row.url
      : arxivId
        ? `https://arxiv.org/abs/${arxivId}`
        : doi
          ? `https://doi.org/${doi}`
          : '';
  if (!url) return null;
  return {
    title: title.trim(),
    authors: Array.isArray(row.authors)
      ? row.authors.map((author) => (author && typeof author === 'object' ? String((author as Row).name ?? '') : '')).filter(Boolean)
      : [],
    year: typeof row.year === 'number' ? row.year : null,
    ...(typeof row.venue === 'string' && row.venue ? { venue: row.venue } : {}),
    ...(typeof row.abstract === 'string' && row.abstract ? { abstract: row.abstract } : {}),
    arxivId,
    doi,
    url,
    ...(typeof row.citationCount === 'number' ? { citationCount: row.citationCount } : {}),
    relation,
    inLibrary: library.some(
      (item) =>
        !!(
          (arxivId && item.arxivId?.replace(/v\d+$/, '') === arxivId) ||
          (doi && item.doi?.toLowerCase() === doi.toLowerCase()) ||
          (item.title && item.title.toLowerCase() === title.toLowerCase())
        ),
    ),
    image: null,
  };
}
export function mergeRelated(groups: RelatedPaper[][]): RelatedPaper[] {
  const seen = new Map<string, RelatedPaper>();
  for (const item of groups.flat()) {
    const key = (item.arxivId ? `a:${item.arxivId}` : item.doi ? `d:${item.doi}` : `t:${item.title.toLowerCase().replace(/\W+/g, ' ')}`).toLowerCase();
    const prior = seen.get(key);
    if (!prior) seen.set(key, item);
    else
      seen.set(key, {
        ...prior,
        citationCount: Math.max(prior.citationCount ?? 0, item.citationCount ?? 0),
        inLibrary: prior.inLibrary || item.inLibrary,
        abstract: prior.abstract ?? item.abstract,
      });
  }
  return [...seen.values()];
}
export class RelatedPaperService {
  constructor(
    private readonly store: SqlitePaperStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async get(key: string): Promise<RelatedPapersResponse> {
    const paper = this.store.getPaper(key);
    if (!paper) throw notFound('Paper not found');
    const cached = this.store.db.prepare('SELECT data,fetched_at FROM related_papers WHERE paper_key=?').get(key) as
      { data: string; fetched_at: string } | undefined;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < 7 * 86400000) return JSON.parse(cached.data) as RelatedPapersResponse;
    const library = this.store.listLibrary();
    const record = this.store.getLibrary(key);
    let id = paper.arxivId ? `ARXIV:${paper.arxivId.replace(/v\d+$/, '')}` : record?.doi ? `DOI:${record.doi}` : '';
    try {
      if (!id && paper.title) {
        const match = await getJson(`https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(paper.title)}`, this.fetcher);
        if (typeof match.paperId === 'string') id = match.paperId;
      }
      if (!id) throw Object.assign(new Error('Paper has no arXiv ID, DOI or title match'), { code: 'NOT_FOUND' });
      const encoded = encodeURIComponent(id);
      const recommended: Row = await getJson(
        `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${encoded}?fields=${FIELDS}&limit=30`,
        this.fetcher,
      ).catch((error: unknown) => {
        if ((error as { code?: string }).code === 'QUOTA') throw error;
        return {};
      });
      const graph = await getJson(
        `https://api.semanticscholar.org/graph/v1/paper/${encoded}?fields=references.title,references.authors,references.year,references.venue,references.abstract,references.url,references.externalIds,references.citationCount,citations.title,citations.authors,citations.year,citations.venue,citations.abstract,citations.url,citations.externalIds,citations.citationCount`,
        this.fetcher,
      );
      const recs = Array.isArray(recommended.recommendedPapers)
        ? recommended.recommendedPapers.map((row) => normalize(row, 'similar', library)).filter((row): row is RelatedPaper => !!row)
        : [];
      const references = Array.isArray(graph.references)
        ? graph.references
            .map((row) => normalize(row, 'cites', library))
            .filter((row): row is RelatedPaper => !!row)
            .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
            .slice(0, 15)
        : [];
      const citations = Array.isArray(graph.citations)
        ? graph.citations
            .map((row) => normalize(row, 'citedBy', library))
            .filter((row): row is RelatedPaper => !!row)
            .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
            .slice(0, 15)
        : [];
      const response: RelatedPapersResponse = {
        items: mergeRelated([recs, references, citations]).slice(0, 60),
        source: 'semanticScholar',
        fetchedAt: new Date().toISOString(),
      };
      this.store.db
        .prepare(
          'INSERT INTO related_papers(paper_key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(paper_key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at',
        )
        .run(key, JSON.stringify(response), response.fetchedAt);
      return response;
    } catch (error) {
      if (cached) return JSON.parse(cached.data) as RelatedPapersResponse;
      throw error;
    }
  }
}
