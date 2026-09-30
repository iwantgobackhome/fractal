import { createHash } from 'node:crypto';
import { arxivCategories } from '@fractal/shared';
import type { FeedSource, SourceContext, RawItem } from './sources';
import {
  row,
  normalizeDoi,
  normalizeArxiv,
  openAlexMetadata,
  crossrefMetadata,
  invertedAbstract,
  safePublicUrl,
  normalizedTitle,
  type Row,
} from '../scholarly/metadata';
import { ProviderFailure } from '../scholarly/client';

type Query = { text: string; author?: string; categories: string[]; topicIds: string[] };
/** Translate category codes to actual scholarly queries, keeping the original field
 * and followed-topic IDs for existing grouping/ranking. No arbitrary default topic. */
export function discoveryQueries(ctx: SourceContext): Query[] {
  const queries: Query[] = [
    ...ctx.interests.categories.map((code) => ({ text: arxivCategories.find((c) => c.code === code)?.name.en ?? code, categories: [code], topicIds: [] })),
    ...(ctx.interests.custom ?? []).map((c) => ({ text: c.query || c.label, categories: [`custom:${c.id}`], topicIds: [] })),
    ...(ctx.followedTopics ?? []).map((t) => ({ text: t.query || t.label, categories: [t.field], topicIds: [t.id] })),
    ...ctx.interests.topics.map((text) => ({ text, categories: [], topicIds: [] })),
    ...ctx.interests.authors.map((text) => ({ text, author: text, categories: [], topicIds: [] })),
  ];
  const merged = new Map<string, Query>();
  for (const q of queries) {
    q.text = q.text.trim().slice(0, 200);
    if (!q.text) continue;
    const key = `${q.author ? 'author:' : 'topic:'}${normalizedTitle(q.text)}`,
      prior = merged.get(key);
    merged.set(
      key,
      prior
        ? { text: prior.text, categories: [...new Set([...prior.categories, ...q.categories])], topicIds: [...new Set([...prior.topicIds, ...q.topicIds])] }
        : q,
    );
  }
  return [...merged.values()].slice(0, 12);
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
export function openAlexItem(work: Row, ctx: SourceContext, query: Query): RawItem | null {
  const title = typeof work.display_name === 'string' ? work.display_name.trim() : '';
  const doi = normalizeDoi(work.doi),
    location = row(work.primary_location);
  const url = doi ? `https://doi.org/${doi}` : (safePublicUrl(location.landing_page_url) ?? safePublicUrl(work.id));
  if (!title || !url) return null;
  // A provider-returned arXiv identifier/landing URL is evidence; a synthesized
  // DOI must never be used to claim a match for an arbitrary arXiv target.
  const arxivId =
    normalizeArxiv(location.landing_page_url) ?? (doi?.startsWith('10.48550/arxiv.') ? normalizeArxiv(doi.replace(/^10\.48550\/arxiv\./, '')) : null);
  const publication = openAlexMetadata(work);
  return {
    id: `openAlex:${digest(String(work.id ?? url))}`,
    kind: 'paper',
    title,
    authors: Array.isArray(work.authorships)
      ? work.authorships.flatMap((a) => (typeof row(row(a).author).display_name === 'string' ? [String(row(row(a).author).display_name)] : []))
      : [],
    abstract: invertedAbstract(work.abstract_inverted_index),
    categories: query.categories,
    topicIds: query.topicIds,
    arxivId,
    doi,
    url,
    source: 'openAlex',
    publishedAt: publication.publicationDate ? `${publication.publicationDate}T00:00:00.000Z` : ctx.now.toISOString(),
    dateBasis: publication.publicationDate ? 'publication' : 'observed',
    popularity: typeof work.cited_by_count === 'number' ? work.cited_by_count : 0,
    publication,
    image: null,
  };
}
export function crossrefItem(work: Row, ctx: SourceContext, query: Query): RawItem | null {
  const title = Array.isArray(work.title) && typeof work.title[0] === 'string' ? work.title[0].trim() : '';
  const doi = normalizeDoi(work.DOI),
    url = doi ? `https://doi.org/${doi}` : safePublicUrl(work.URL);
  if (!title || !url) return null;
  const publication = crossrefMetadata(work);
  return {
    id: `crossref:${digest(doi ?? url)}`,
    kind: 'paper',
    title,
    authors: Array.isArray(work.author)
      ? work.author.map((a) => [row(a).given, row(a).family].filter((v) => typeof v === 'string').join(' ')).filter(Boolean)
      : [],
    abstract:
      typeof work.abstract === 'string'
        ? work.abstract
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : '',
    categories: query.categories,
    topicIds: query.topicIds,
    arxivId: null,
    doi,
    url,
    source: 'crossref',
    publication,
    publishedAt: publication.publicationDate ? `${publication.publicationDate}T00:00:00.000Z` : ctx.now.toISOString(),
    dateBasis: publication.publicationDate ? 'publication' : 'observed',
    popularity: typeof work['is-referenced-by-count'] === 'number' ? work['is-referenced-by-count'] : 0,
    image: null,
  };
}
function source(id: 'openAlex' | 'crossref'): FeedSource {
  return {
    id,
    async load(ctx) {
      const output: RawItem[] = [];
      let failure: unknown;
      // Bounded refresh cost: at most 12 OpenAlex searches and four Crossref searches.
      // Crossref complements OA results with DOI/venue/year data during deduplication.
      const queries = discoveryQueries(ctx).slice(0, id === 'crossref' ? 4 : 12);
      const since = new Date(ctx.now.getTime() - 31 * 86400000).toISOString().slice(0, 10);
      for (const query of queries) {
        const url = new URL(id === 'openAlex' ? 'https://api.openalex.org/works' : 'https://api.crossref.org/works');
        try {
          if (id === 'openAlex') {
            if (query.author) {
              const lookup = new URL('https://api.openalex.org/authors');
              lookup.searchParams.set('search', query.author);
              lookup.searchParams.set('per_page', '5');
              lookup.searchParams.set('select', 'id,display_name');
              const data = row(JSON.parse(await ctx.get(lookup.href)));
              if (!Array.isArray(data.results)) throw new Error('Malformed author results');
              const authors = data.results
                .map(row)
                .filter(
                  (a) =>
                    typeof a.display_name === 'string' &&
                    normalizedTitle(a.display_name) === normalizedTitle(query.author!) &&
                    typeof a.id === 'string' &&
                    /^https:\/\/openalex\.org\/A\d+$/.test(a.id),
                );
              if (authors.length !== 1) {
                ctx.report?.({
                  source: id,
                  state: 'error',
                  fetchedAt: null,
                  errorCode: 'not_found',
                  message: 'OpenAlex author name is missing or ambiguous; use an identifiable author query',
                });
                continue;
              }
              url.searchParams.set('filter', `from_publication_date:${since},author.id:${String(authors[0].id).split('/').at(-1)}`);
            } else url.searchParams.set('search', query.text);
            if (!query.author) url.searchParams.set('filter', `from_publication_date:${since}`);
            url.searchParams.set('per_page', '15');
          } else {
            url.searchParams.set(query.author ? 'query.author' : 'query.bibliographic', query.text);
            url.searchParams.set('filter', `from-pub-date:${since}`);
            url.searchParams.set('rows', '15');
          }
          const data = row(JSON.parse(await ctx.get(url.href))),
            values = id === 'openAlex' ? data.results : row(data.message).items;
          if (!Array.isArray(values)) throw new Error('Malformed scholarly search results');
          output.push(
            ...values.map((w) => (id === 'openAlex' ? openAlexItem(row(w), ctx, query) : crossrefItem(row(w), ctx, query))).filter((v): v is RawItem => !!v),
          );
        } catch (error) {
          failure = error;
          break;
        } // Stop spending quota on an unavailable provider.
      }
      if (failure && !output.length) throw failure;
      if (failure) {
        const status = failure instanceof ProviderFailure ? failure.status : undefined;
        ctx.report?.({
          source: id,
          state: 'error',
          fetchedAt: ctx.now.toISOString(),
          message: status?.message ?? `${id} search partially failed`,
          errorCode: status?.state === 'ok' ? undefined : (status?.state ?? 'error'),
          retryAt: status?.retryAt,
        });
      }
      return output;
    },
  };
}
export const openAlexSource = source('openAlex');
export const crossrefSource = source('crossref');
