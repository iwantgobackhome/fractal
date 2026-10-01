import type { RelatedPaper, RelatedPapersResponse, PublicationProviderStatus, LibraryRecord } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { notFound } from '../store/errors';
import { ProviderFailure, ScholarlyClient } from '../scholarly/client';
import {
  identityMatches,
  identifiersConflict,
  normalizeDoi,
  normalizeArxiv,
  normalizedTitle,
  titleMatches,
  unknownPublication,
  row,
  type Row,
  safePublicUrl,
  publicationIdentity,
} from '../scholarly/metadata';
import { openAlexItem } from './scholarly-sources';

const FIELDS =
  'paperId,title,references.title,references.authors,references.year,references.venue,references.abstract,references.url,references.externalIds,references.citationCount,references.openAccessPdf,citations.title,citations.authors,citations.year,citations.venue,citations.abstract,citations.url,citations.externalIds,citations.citationCount,citations.openAccessPdf';
const OA_FIELDS =
  'id,display_name,authorships,publication_year,publication_date,primary_location,best_oa_location,locations,open_access,type,doi,cited_by_count,abstract_inverted_index';
const oaId = (v: unknown): string | null => (typeof v === 'string' ? (/^https:\/\/openalex\.org\/(W\d+)$/.exec(v)?.[1] ?? null) : null);
const inLibrary = (item: RelatedPaper, library: LibraryRecord[]) =>
  library.some((r) => identityMatches(item, { ...r, authors: r.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')) }));
function semanticItem(raw: unknown, relation: RelatedPaper['relation']): RelatedPaper | null {
  const work = row(raw),
    ids = row(work.externalIds),
    title = typeof work.title === 'string' ? work.title.trim() : '';
  const doi = normalizeDoi(ids.DOI),
    arxivId = normalizeArxiv(ids.ArXiv);
  const url = safePublicUrl(work.url) ?? (doi ? `https://doi.org/${doi}` : arxivId ? `https://arxiv.org/abs/${arxivId}` : null);
  if (!title || !url) return null;
  const publication = {
    ...unknownPublication(),
    sources: ['semanticScholar' as const],
    year: typeof work.year === 'number' && work.year > 0 ? work.year : null,
    venue: typeof work.venue === 'string' && work.venue ? work.venue : null,
  };
  const oaPdfUrl = safePublicUrl(row(work.openAccessPdf).url);
  if (oaPdfUrl) {
    publication.oaAvailability = 'open';
    publication.oaPdfUrl = oaPdfUrl;
  }
  return {
    title,
    authors: Array.isArray(work.authors) ? work.authors.flatMap((a) => (typeof row(a).name === 'string' ? [String(row(a).name)] : [])) : [],
    year: publication.year,
    ...(publication.venue ? { venue: publication.venue } : {}),
    ...(typeof work.abstract === 'string' ? { abstract: work.abstract } : {}),
    doi,
    arxivId,
    url,
    publication,
    provider: 'semanticScholar',
    relation,
    relations: [relation],
    inLibrary: false,
    image: null,
    ...(typeof work.citationCount === 'number' ? { citationCount: work.citationCount } : {}),
  };
}
function alexItem(raw: unknown, relation: RelatedPaper['relation']): RelatedPaper | null {
  const work = row(raw),
    item = openAlexItem(
      work,
      { interests: { categories: [], topics: [], authors: [] }, libraryArxivIds: [], rssFeeds: [], get: async () => '', now: new Date() },
      { text: '', categories: [], topicIds: [] },
    );
  if (!item) return null;
  return {
    title: item.title,
    authors: item.authors,
    year: item.publication?.year ?? null,
    doi: item.doi,
    arxivId: item.arxivId,
    url: item.url,
    publication: item.publication,
    ...(item.publication?.venue ? { venue: item.publication.venue } : {}),
    ...(item.abstract ? { abstract: item.abstract } : {}),
    provider: 'openAlex',
    relation,
    relations: [relation],
    citationCount: item.popularity,
    inLibrary: false,
    image: null,
  };
}
export function mergeRelated(groups: RelatedPaper[][]): RelatedPaper[] {
  const result: RelatedPaper[] = [];
  for (const item of groups.flat()) {
    const matches = result.filter((p) => identityMatches(p, item));
    const contradictory = matches.some((a, i) => matches.slice(i + 1).some((b) => identifiersConflict(a, b)));
    const prior = contradictory ? undefined : matches[0];
    if (prior && matches.length > 1) {
      for (const extra of matches.slice(1)) {
        prior.relations = [...new Set([...(prior.relations ?? [prior.relation]), ...(extra.relations ?? [extra.relation])])];
        prior.citationCount = Math.max(prior.citationCount ?? 0, extra.citationCount ?? 0);
        prior.inLibrary ||= extra.inLibrary;
        prior.doi ??= extra.doi;
        prior.arxivId ??= extra.arxivId;
        result.splice(result.indexOf(extra), 1);
      }
    }
    if (!prior) result.push({ ...item, relations: item.relations ?? [item.relation] });
    else {
      prior.relations = [...new Set([...(prior.relations ?? [prior.relation]), ...(item.relations ?? [item.relation])])];
      prior.citationCount = Math.max(prior.citationCount ?? 0, item.citationCount ?? 0);
      prior.inLibrary ||= item.inLibrary;
      prior.abstract ??= item.abstract;
      prior.doi ??= item.doi;
      prior.arxivId ??= item.arxivId;
    }
  }
  return result;
}
type Provider = RelatedPapersResponse['source'];
type Target = { title: string | null; doi: string | null; arxivId: string | null; authors: string[]; year: number | null };
type CacheRow = { data: string; fetched_at: string };
export class RelatedPaperService {
  private readonly shutdown = new AbortController();
  private readonly client: ScholarlyClient;
  private readonly flights = new Map<string, Promise<RelatedPapersResponse>>();
  constructor(
    private readonly store: SqlitePaperStore,
    fetcher: typeof fetch = fetch,
    private readonly options: { intervalMs?: number; timeoutMs?: number; providerBudgetMs?: number; now?: () => number } = {},
  ) {
    this.client = new ScholarlyClient(fetcher, options);
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private cache(provider: Provider, identity: string): CacheRow | undefined {
    return this.store.db.prepare('SELECT data,fetched_at FROM related_provider_cache WHERE provider=? AND identity=?').get(provider, identity) as
      CacheRow | undefined;
  }
  async get(key: string, signal?: AbortSignal): Promise<RelatedPapersResponse> {
    this.shutdown.signal.throwIfAborted();
    signal?.throwIfAborted();
    const paper = this.store.getPaper(key),
      record = this.store.getLibrary(key);
    if (!paper && !record) throw notFound('Paper not found');
    const target: Target = {
      title: record?.title ?? paper?.title ?? null,
      authors: record?.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')) ?? paper?.authors ?? [],
      year: record?.year ?? null,
      doi: normalizeDoi(record?.doi),
      arxivId: normalizeArxiv(record?.arxivId ?? paper?.arxivId),
    };
    // Include title in identity: metadata edits invalidate wrong/failed title lookups.
    const identity = `${publicationIdentity(target)}|${normalizedTitle(target.title ?? '')}|${JSON.stringify([target.year, target.authors.map(normalizedTitle).sort()])}`;
    let work = this.flights.get(identity);
    if (!work) {
      work = this.load(key, target, identity).finally(() => this.flights.delete(identity));
      this.flights.set(identity, work);
    }
    // A caller closing its panel must not cancel shared requests for other callers.
    const result = signal
      ? await new Promise<RelatedPapersResponse>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          work!.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        })
      : await work;
    const library = this.store.listLibrary();
    return { ...result, items: result.items.map((item) => ({ ...item, inLibrary: inLibrary(item, library) })) };
  }
  private async semantic(target: Target, signal: AbortSignal, statuses: PublicationProviderStatus[]): Promise<RelatedPaper[]> {
    const id = target.doi ? `DOI:${target.doi}` : target.arxivId ? `ARXIV:${target.arxivId}` : null;
    if (!id)
      throw new ProviderFailure({ provider: 'semanticScholar', state: 'not_found', message: 'Semantic Scholar lookup requires a reported DOI or arXiv ID' });
    const graph = await this.client.json(
      'semanticScholar',
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${FIELDS}`,
      signal,
    );
    const groups: RelatedPaper[][] = [
      ['references', 'cites'],
      ['citations', 'citedBy'],
    ].map(([field, relation]) =>
      Array.isArray(graph[field!])
        ? (graph[field!] as unknown[])
            .slice(0, 15)
            .map((w) => semanticItem(w, relation as RelatedPaper['relation']))
            .filter((v): v is RelatedPaper => !!v)
        : [],
    );
    statuses.push({ provider: 'semanticScholar', state: 'ok' });
    if (typeof graph.paperId === 'string' && /^[a-f0-9]{40}$/i.test(graph.paperId)) {
      try {
        const rec = await this.client.json(
          'semanticScholar',
          `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${graph.paperId}?limit=15&fields=title,authors,year,venue,abstract,url,externalIds,citationCount,openAccessPdf`,
          signal,
        );
        if (Array.isArray(rec.recommendedPapers))
          groups.push(rec.recommendedPapers.map((w) => semanticItem(w, 'similar')).filter((v): v is RelatedPaper => !!v));
      } catch (error) {
        statuses.push(this.failure('semanticScholar', error));
      }
    }
    return mergeRelated(groups);
  }
  private async alex(target: Target, signal: AbortSignal, statuses: PublicationProviderStatus[]): Promise<RelatedPaper[]> {
    let work: Row | undefined;
    if (target.doi) {
      try {
        work = await this.client.json(
          'openAlex',
          `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(target.doi)}?select=id,display_name,doi,authorships,publication_year,primary_location,related_works,referenced_works`,
          signal,
        );
      } catch (error) {
        if (!(error instanceof ProviderFailure) || error.status.state !== 'not_found') throw error;
      }
    }
    if (work) {
      const item = alexItem(work, 'similar');
      if (!item || !identityMatches(target, item)) work = undefined;
    }
    if (!oaId(work?.id) && target.title) {
      const data = await this.client.json(
        'openAlex',
        `https://api.openalex.org/works?search=${encodeURIComponent(target.title)}&per_page=5&select=id,display_name,doi,authorships,publication_year,primary_location,related_works,referenced_works`,
        signal,
      );
      const candidates = Array.isArray(data.results)
        ? data.results.map(row).filter((w) => {
            const item = alexItem(w, 'similar');
            return item && identityMatches(target, item) && titleMatches(target.title!, item.title);
          })
        : [];
      const distinct = [...new Map(candidates.filter((w) => oaId(w.id)).map((w) => [oaId(w.id), w])).values()];
      work = distinct.length === 1 ? distinct[0] : undefined;
    }
    const id = oaId(work?.id);
    if (!id)
      throw new ProviderFailure({ provider: 'openAlex', state: 'not_found', message: 'OpenAlex could not confidently identify this paper by DOI or title' });
    const references = Array.isArray(work?.referenced_works)
      ? work.referenced_works
          .map(oaId)
          .filter((v): v is string => !!v)
          .slice(0, 15)
      : [];
    const similar = Array.isArray(work?.related_works)
      ? work.related_works
          .map(oaId)
          .filter((v): v is string => !!v)
          .slice(0, 15)
      : [];
    const ids = [...new Set([...references, ...similar])],
      groups: RelatedPaper[][] = [];
    statuses.push({ provider: 'openAlex', state: 'ok' });
    if (ids.length) {
      try {
        const linked = await this.client.json(
          'openAlex',
          `https://api.openalex.org/works?filter=openalex_id:${ids.join('|')}&per_page=${ids.length}&select=${OA_FIELDS}`,
          signal,
        );
        if (!Array.isArray(linked.results)) throw new Error('Missing results');
        for (const raw of linked.results) {
          const workId = oaId(row(raw).id);
          for (const relation of [references.includes(workId ?? '') ? 'cites' : null, similar.includes(workId ?? '') ? 'similar' : null] as const) {
            if (relation) {
              const item = alexItem(raw, relation);
              if (item) groups.push([item]);
            }
          }
        }
      } catch (error) {
        statuses.push(this.failure('openAlex', error));
      }
    }
    try {
      const citing = await this.client.json(
        'openAlex',
        `https://api.openalex.org/works?filter=cites:${id}&per_page=15&sort=cited_by_count:desc&select=${OA_FIELDS}`,
        signal,
      );
      if (!Array.isArray(citing.results)) throw new Error('Missing results');
      groups.push(citing.results.map((w) => alexItem(w, 'citedBy')).filter((v): v is RelatedPaper => !!v));
    } catch (error) {
      statuses.push(this.failure('openAlex', error));
    }
    return mergeRelated(groups);
  }
  async close(): Promise<void> {
    this.shutdown.abort();
    await Promise.allSettled([...this.flights.values()]);
  }
  private failure(provider: Provider, error: unknown): PublicationProviderStatus {
    return error instanceof ProviderFailure ? error.status : { provider, state: 'error', message: `${provider} metadata could not be read` };
  }
  private async load(key: string, target: Target, identity: string): Promise<RelatedPapersResponse> {
    const statuses: PublicationProviderStatus[] = [],
      stale: RelatedPapersResponse[] = [];
    for (const provider of ['semanticScholar', 'openAlex'] as const) {
      const cached = this.cache(provider, identity);
      if (cached) {
        const result = JSON.parse(cached.data) as RelatedPapersResponse;
        if (this.now() - Date.parse(cached.fetched_at) < 7 * 86400000) {
          if (result.items.length || (provider === 'openAlex' && !stale.length))
            return { ...result, providerStatus: [...statuses, ...(result.providerStatus ?? [])] };
          statuses.push(...(result.providerStatus ?? [{ provider, state: 'ok' as const }]));
          continue;
        }
        if (result.items.length) stale.push(result);
      }
      const providerStatuses: PublicationProviderStatus[] = [];
      try {
        // New deadline per provider, independent of time already spent by its peer.
        const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.options.providerBudgetMs ?? 9000)]);
        const items = await (provider === 'semanticScholar' ? this.semantic(target, signal, providerStatuses) : this.alex(target, signal, providerStatuses));
        statuses.push(...providerStatuses);
        const failed = providerStatuses.some((s) => s.state !== 'ok');
        const result: RelatedPapersResponse = {
          items: items.slice(0, 45),
          source: provider,
          fetchedAt: new Date(this.now()).toISOString(),
          status: failed ? 'partial' : 'ready',
          providerStatus: [...statuses],
        };
        this.shutdown.signal.throwIfAborted();
        if (!failed)
          this.store.db
            .prepare(
              'INSERT INTO related_provider_cache VALUES(?,?,?,?) ON CONFLICT(provider,identity) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at',
            )
            .run(provider, identity, JSON.stringify({ ...result, providerStatus: providerStatuses }), result.fetchedAt);
        if (items.length) return result;
        if (provider === 'openAlex' && !failed && !stale.length) return result;
      } catch (error) {
        statuses.push(...providerStatuses, this.failure(provider, error));
      }
    }
    // Old schema caches remain usable as stale evidence, but are never advertised
    // fresh because they lack normalized identity/version/provider isolation.
    const legacy = this.store.db.prepare('SELECT data,fetched_at FROM related_papers WHERE paper_key=?').get(key) as CacheRow | undefined;
    if (legacy && (this.store.getLibrary(key)?.updatedAt ?? '') <= legacy.fetched_at) {
      const value = JSON.parse(legacy.data) as RelatedPapersResponse;
      if (value.items.length) stale.push({ ...value, fetchedAt: legacy.fetched_at });
    }
    const prior = stale.sort((a, b) => Date.parse(b.fetchedAt ?? '') - Date.parse(a.fetchedAt ?? ''))[0];
    return prior
      ? { ...prior, status: 'stale', providerStatus: statuses }
      : { items: [], source: 'openAlex', fetchedAt: null, status: 'unavailable', providerStatus: statuses };
  }
}
