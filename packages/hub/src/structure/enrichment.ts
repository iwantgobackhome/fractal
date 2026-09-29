import type { ReferenceEnrichment, ReferenceEntry } from '@fractal/shared';

const fields = 'title,abstract,year,venue,externalIds,citationCount,openAccessPdf';
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

export async function enrichReference(reference: ReferenceEntry, fetcher: typeof fetch = fetch): Promise<ReferenceEnrichment | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const identifier = reference.doi ? `DOI:${reference.doi}` : reference.arxivId ? `ARXIV:${reference.arxivId}` : null;
  const semanticUrl = identifier
    ? `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(identifier)}?fields=${fields}`
    : `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(reference.title ?? reference.raw.slice(0, 180))}&fields=${fields}`;
  try {
    await politePause();
    const response = await fetcher(semanticUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      const candidate = Array.isArray(data.data) ? data.data[0] as Record<string, unknown> | undefined : data;
      if (candidate && typeof candidate.title === 'string') {
        const externalIds = candidate.externalIds && typeof candidate.externalIds === 'object' ? Object.fromEntries(Object.entries(candidate.externalIds).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
        const pdf = candidate.openAccessPdf as Record<string, unknown> | null;
        return { title: candidate.title, abstract: stringOrNull(candidate.abstract), year: typeof candidate.year === 'number' ? candidate.year : null, venue: stringOrNull(candidate.venue), externalIds, citationCount: typeof candidate.citationCount === 'number' ? candidate.citationCount : null, openAccessPdf: stringOrNull(pdf?.url), provider: 'semantic-scholar' };
      }
    }
  } catch {
    // OpenAlex is the fallback for missing records and temporary Semantic Scholar failures.
  }
  const filter = reference.doi ? `doi:${encodeURIComponent(`https://doi.org/${reference.doi}`)}` : reference.arxivId ? `locations.landing_page_url:${encodeURIComponent(`https://arxiv.org/abs/${reference.arxivId}`)}` : null;
  const openAlexUrl = filter ? `https://api.openalex.org/works?filter=${filter}&per-page=1` : `https://api.openalex.org/works?search=${encodeURIComponent(reference.title ?? reference.raw.slice(0, 180))}&per-page=1`;
  try {
    await politePause();
    const response = await fetcher(openAlexUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json() as { results?: Array<Record<string, unknown>> };
    const work = data.results?.[0];
    if (!work) return null;
    const primary = work.primary_location as Record<string, unknown> | undefined;
    const best = work.best_oa_location as Record<string, unknown> | undefined;
    const ids = work.ids as Record<string, unknown> | undefined;
    const source = primary?.source as Record<string, unknown> | undefined;
    const externalIds = Object.fromEntries(Object.entries(ids ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    return { title: stringOrNull(work.title), abstract: null, year: typeof work.publication_year === 'number' ? work.publication_year : null, venue: stringOrNull(source?.display_name), externalIds, citationCount: typeof work.cited_by_count === 'number' ? work.cited_by_count : null, openAccessPdf: stringOrNull(best?.pdf_url ?? primary?.pdf_url), provider: 'openalex' };
  } catch {
    return null;
  }
}
