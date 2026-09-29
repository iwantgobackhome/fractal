import type { ReferenceEnrichment, ReferenceEntry } from '@fractal/shared';

export const ENRICHMENT_CACHE_VERSION = 'reference-match-v2';
const fields = 'title,abstract,year,venue,externalIds,citationCount,openAccessPdf,authors.name';
let nextRequestAt = 0;

async function politePause(): Promise<void> {
  const now = Date.now();
  const delay = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + 500;
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizedId(value: string, arxiv = false): string {
  const clean = value
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?(?:doi\.org|arxiv\.org\/abs)\//, '')
    .replace(/^arxiv:/, '')
    .replace(/[.,;)]$/, '');
  return arxiv ? clean.replace(/v\d+$/, '') : clean;
}

function referenceTitle(reference: ReferenceEntry): string | null {
  if (reference.title && reference.title.length >= 12) return reference.title;
  if (!reference.authors) return null;
  const prefix = `${reference.authors}.`;
  if (!reference.raw.startsWith(prefix)) return null;
  const candidate = reference.raw.slice(prefix.length).trim().split(/\.\s+/)[0]?.trim();
  return candidate && candidate.length >= 12 ? candidate : null;
}

function titleTokens(value: string): Set<string> {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([A-Za-z])-\s+([a-z])/g, '$1$2')
    .toLowerCase();
  return new Set(normalized.match(/[a-z0-9]+/g) ?? []);
}

export function titleSimilarity(left: string, right: string): number {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((token) => b.has(token)).length;
  return common / (a.size + b.size - common);
}

function familyNames(value: string): Set<string> {
  return new Set(
    value
      .split(/,|\band\b/gi)
      .map(
        (part) =>
          part
            .trim()
            .split(/\s+/)
            .at(-1)
            ?.replace(/[^\p{L}-]/gu, '')
            .toLowerCase() ?? '',
      )
      .filter((name) => name.length > 1),
  );
}

export function validEnrichment(reference: ReferenceEntry, candidate: ReferenceEnrichment, authors: readonly string[]): boolean {
  const doi = candidate.externalIds.DOI ?? candidate.externalIds.doi;
  const arxiv = candidate.externalIds.ArXiv ?? candidate.externalIds.arxiv;
  if (reference.doi && doi && normalizedId(reference.doi) !== normalizedId(doi)) return false;
  if (reference.arxivId && arxiv && normalizedId(reference.arxivId, true) !== normalizedId(arxiv, true)) return false;
  if (reference.doi && doi && normalizedId(reference.doi) === normalizedId(doi)) return true;
  if (reference.arxivId && arxiv && normalizedId(reference.arxivId, true) === normalizedId(arxiv, true)) return true;
  const title = referenceTitle(reference);
  if (!title || !candidate.title || titleSimilarity(title, candidate.title) < 0.85) return false;
  if (reference.year && candidate.year && Math.abs(reference.year - candidate.year) > 1) return false;
  if (reference.authors) {
    const expected = familyNames(reference.authors);
    const found = new Set(authors.flatMap((name) => [...familyNames(name)]));
    if (expected.size && ![...expected].some((name) => found.has(name))) return false;
  }
  return true;
}

export async function enrichReference(reference: ReferenceEntry, fetcher: typeof fetch = fetch): Promise<ReferenceEnrichment | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const identifier = reference.doi ? `DOI:${reference.doi}` : reference.arxivId ? `ARXIV:${reference.arxivId}` : null;
  const query = (referenceTitle(reference) ?? reference.raw.slice(0, 180)).replace(/([A-Za-z])-\s+([a-z])/g, '$1$2');
  const semanticUrl = identifier
    ? `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(identifier)}?fields=${fields}`
    : `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(query)}&fields=${fields}`;
  try {
    await politePause();
    const response = await fetcher(semanticUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const candidate = Array.isArray(data.data) ? (data.data[0] as Record<string, unknown> | undefined) : data;
      if (candidate && typeof candidate.title === 'string') {
        const externalIds =
          candidate.externalIds && typeof candidate.externalIds === 'object'
            ? Object.fromEntries(Object.entries(candidate.externalIds).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
            : {};
        const pdf = candidate.openAccessPdf as Record<string, unknown> | null;
        const enriched: ReferenceEnrichment = {
          title: candidate.title,
          abstract: stringOrNull(candidate.abstract),
          year: typeof candidate.year === 'number' ? candidate.year : null,
          venue: stringOrNull(candidate.venue),
          externalIds,
          citationCount: typeof candidate.citationCount === 'number' ? candidate.citationCount : null,
          openAccessPdf: stringOrNull(pdf?.url),
          provider: 'semantic-scholar',
        };
        const authors = Array.isArray(candidate.authors)
          ? candidate.authors.map((author) => stringOrNull((author as Record<string, unknown>).name)).filter((name): name is string => name !== null)
          : [];
        if (validEnrichment(reference, enriched, authors)) return enriched;
      }
    }
  } catch {
    // OpenAlex is the fallback for missing records and temporary Semantic Scholar failures.
  }
  const filter = reference.doi
    ? `doi:${encodeURIComponent(`https://doi.org/${reference.doi}`)}`
    : reference.arxivId
      ? `locations.landing_page_url:${encodeURIComponent(`https://arxiv.org/abs/${reference.arxivId}`)}`
      : null;
  const openAlexUrls = [
    ...(filter ? [`https://api.openalex.org/works?filter=${filter}&per-page=5`] : []),
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`,
  ];
  try {
    for (const url of openAlexUrls) {
      await politePause();
      const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
      for (const work of data.results ?? []) {
        const primary = work.primary_location as Record<string, unknown> | undefined;
        const best = work.best_oa_location as Record<string, unknown> | undefined;
        const ids = work.ids as Record<string, unknown> | undefined;
        const source = primary?.source as Record<string, unknown> | undefined;
        const externalIds = Object.fromEntries(Object.entries(ids ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        const enriched: ReferenceEnrichment = {
          title: stringOrNull(work.title),
          abstract: null,
          year: typeof work.publication_year === 'number' ? work.publication_year : null,
          venue: stringOrNull(source?.display_name),
          externalIds,
          citationCount: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
          openAccessPdf: stringOrNull(best?.pdf_url ?? primary?.pdf_url),
          provider: 'openalex',
        };
        const authorships = Array.isArray(work.authorships) ? (work.authorships as Array<Record<string, unknown>>) : [];
        const authors = authorships
          .map((authorship) => stringOrNull((authorship.author as Record<string, unknown> | undefined)?.display_name))
          .filter((name): name is string => name !== null);
        if (validEnrichment(reference, enriched, authors)) return enriched;
      }
    }
    return null;
  } catch {
    return null;
  }
}
