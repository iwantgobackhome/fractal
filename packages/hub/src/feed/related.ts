import type { RelatedPaper, RelatedPapersResponse } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { appError, notFound } from '../store/errors';

type Row = Record<string, unknown>;
const FIELDS =
  'references.title,references.authors,references.year,references.venue,references.abstract,references.url,references.externalIds,references.citationCount,citations.title,citations.authors,citations.year,citations.venue,citations.abstract,citations.url,citations.externalIds,citations.citationCount';
const busy = () => appError('RELATED_RATE_LIMITED', 'Semantic Scholar is busy. Try related papers again shortly.', true);
async function getJson(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Row> {
  const headers: Record<string, string> = {};
  if (url.startsWith('https://api.semanticscholar.org/') && process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const response = await fetcher(url, { headers, signal });
  if (response.status === 429) throw busy();
  if (!response.ok) throw appError('NETWORK', `Related paper source returned HTTP ${response.status}`, true);
  return (await response.json()) as Row;
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

function openAlexPaper(raw: unknown, relation: RelatedPaper['relation'], library: ReturnType<SqlitePaperStore['listLibrary']>): RelatedPaper | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  const doi = typeof row.doi === 'string' ? row.doi.replace(/^https?:\/\/doi\.org\//i, '') : null;
  const arxivId = doi ? (/^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1] ?? null) : null;
  const location = row.primary_location && typeof row.primary_location === 'object' ? (row.primary_location as Row) : {};
  const source = location.source && typeof location.source === 'object' ? (location.source as Row) : {};
  const title = typeof row.display_name === 'string' ? row.display_name : typeof row.title === 'string' ? row.title : '';
  const url = arxivId
    ? `https://arxiv.org/abs/${arxivId}`
    : doi
      ? `https://doi.org/${doi}`
      : typeof location.landing_page_url === 'string'
        ? location.landing_page_url
        : '';
  if (!title || !url.startsWith('https://')) return null;
  return {
    title,
    authors: Array.isArray(row.authorships)
      ? row.authorships.flatMap((entry) => {
          const author = entry && typeof entry === 'object' ? (entry as Row).author : null;
          return author && typeof author === 'object' && typeof (author as Row).display_name === 'string' ? [(author as Row).display_name as string] : [];
        })
      : [],
    year: typeof row.publication_year === 'number' ? row.publication_year : null,
    ...(typeof source.display_name === 'string' ? { venue: source.display_name } : {}),
    arxivId,
    doi,
    url,
    ...(typeof row.cited_by_count === 'number' ? { citationCount: row.cited_by_count } : {}),
    relation,
    inLibrary: library.some(
      (item) =>
        (arxivId && item.arxivId?.replace(/v\d+$/, '').toLowerCase() === arxivId.toLowerCase()) ||
        (doi && item.doi?.toLowerCase() === doi.toLowerCase()) ||
        item.title?.toLowerCase() === title.toLowerCase(),
    ),
    image: null,
  };
}

const OPENALEX_FIELDS = 'id,display_name,authorships,publication_year,primary_location,doi,cited_by_count';
function openAlexId(value: unknown): string | null {
  return typeof value === 'string' ? (/^https:\/\/openalex\.org\/(W\d+)$/.exec(value)?.[1] ?? null) : null;
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
  private async openAlex(
    paper: { arxivId: string | null; title: string | null },
    doi: string | null,
    library: ReturnType<SqlitePaperStore['listLibrary']>,
    signal: AbortSignal,
  ): Promise<RelatedPapersResponse> {
    const arxiv = paper.arxivId?.replace(/v\d+$/, '');
    const identifier = doi ?? (arxiv ? `10.48550/arXiv.${arxiv}` : null);
    const lookup = identifier
      ? `https://api.openalex.org/works/https://doi.org/${identifier}?select=id,related_works,referenced_works`
      : `https://api.openalex.org/works?search=${encodeURIComponent(paper.title ?? '')}&per-page=1&select=id,related_works,referenced_works`;
    const result = await getJson(lookup, this.fetcher, signal);
    const work = identifier ? result : Array.isArray(result.results) ? (result.results[0] as Row | undefined) : undefined;
    const id = openAlexId(work?.id);
    if (!id) throw appError('NOT_FOUND', 'Related paper source could not identify this paper', false);
    const related = Array.isArray(work?.related_works)
      ? work.related_works
          .map(openAlexId)
          .filter((value): value is string => !!value)
          .slice(0, 15)
      : [];
    const references = Array.isArray(work?.referenced_works)
      ? work.referenced_works
          .map(openAlexId)
          .filter((value): value is string => !!value)
          .slice(0, 15)
      : [];
    const ids = [...new Set([...related, ...references])];
    const requests: Promise<Row>[] = [];
    if (ids.length)
      requests.push(
        getJson(`https://api.openalex.org/works?filter=openalex_id:${ids.join('|')}&per-page=${ids.length}&select=${OPENALEX_FIELDS}`, this.fetcher, signal),
      );
    requests.push(
      getJson(`https://api.openalex.org/works?filter=cites:${id}&per-page=15&sort=cited_by_count:desc&select=${OPENALEX_FIELDS}`, this.fetcher, signal),
    );
    const [linked, citing] = await Promise.all(requests);
    const linkedRows = ids.length && Array.isArray(linked?.results) ? linked.results : [];
    const citingRows = Array.isArray((ids.length ? citing : linked)?.results) ? ((ids.length ? citing : linked).results as unknown[]) : [];
    const items = mergeRelated([
      linkedRows
        .map((row) => {
          const workId = openAlexId((row as Row).id);
          return openAlexPaper(row, references.includes(workId ?? '') ? 'cites' : 'similar', library);
        })
        .filter((row): row is RelatedPaper => !!row),
      citingRows.map((row) => openAlexPaper(row, 'citedBy', library)).filter((row): row is RelatedPaper => !!row),
    ]);
    return { items: items.slice(0, 45), source: 'openAlex', fetchedAt: new Date().toISOString() };
  }
  async get(key: string): Promise<RelatedPapersResponse> {
    const paper = this.store.getPaper(key);
    if (!paper) throw notFound('Paper not found');
    const cached = this.store.db.prepare('SELECT data,fetched_at FROM related_papers WHERE paper_key=?').get(key) as
      { data: string; fetched_at: string } | undefined;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < 7 * 86400000) return JSON.parse(cached.data) as RelatedPapersResponse;
    const library = this.store.listLibrary();
    const record = this.store.getLibrary(key);
    const id = paper.arxivId ? `ARXIV:${paper.arxivId.replace(/v\d+$/, '')}` : record?.doi ? `DOI:${record.doi}` : '';
    const signal = AbortSignal.timeout(9500);
    try {
      let response: RelatedPapersResponse;
      try {
        if (!id) throw appError('NOT_FOUND', 'Paper has no arXiv ID or DOI', false);
        const graph = await getJson(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${FIELDS}`, this.fetcher, signal);
        const references = Array.isArray(graph.references)
          ? graph.references
              .map((row) => normalize(row, 'cites', library))
              .filter((row): row is RelatedPaper => !!row)
              .slice(0, 15)
          : [];
        const citations = Array.isArray(graph.citations)
          ? graph.citations
              .map((row) => normalize(row, 'citedBy', library))
              .filter((row): row is RelatedPaper => !!row)
              .slice(0, 15)
          : [];
        response = { items: mergeRelated([references, citations]).slice(0, 30), source: 'semanticScholar', fetchedAt: new Date().toISOString() };
      } catch (semanticError) {
        try {
          response = await this.openAlex(paper, record?.doi ?? null, library, signal);
          if (!response.items.length && (semanticError as { error?: { code?: string } }).error?.code === 'RELATED_RATE_LIMITED') throw busy();
        } catch (openAlexError) {
          if (
            (semanticError as { error?: { code?: string } }).error?.code === 'RELATED_RATE_LIMITED' ||
            (openAlexError as { error?: { code?: string } }).error?.code === 'RELATED_RATE_LIMITED'
          )
            throw busy();
          throw appError('NETWORK', 'Related paper sources are unavailable. Try again shortly.', true);
        }
      }
      if (response.items.length)
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
