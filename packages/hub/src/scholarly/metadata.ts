import type { PublicationMetadata } from '@fractal/shared';
export type Row = Record<string, unknown>;
export const row = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
export function normalizeDoi(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let doi = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  try {
    doi = decodeURIComponent(doi);
  } catch {
    return null;
  }
  return /^10\.\d{4,9}\/[^\s?#]+$/i.test(doi) ? doi.toLowerCase() : null;
}
export function normalizeArxiv(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '')
    .replace(/v\d+$/, '')
    .toLowerCase();
  return /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/.test(id) ? id : null;
}
export const normalizedTitle = (title: string) =>
  title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export interface IdentityEvidence {
  title?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  authors?: string[];
  year?: number | null;
}
export function identifiersConflict(a: Pick<IdentityEvidence, 'doi' | 'arxivId'>, b: Pick<IdentityEvidence, 'doi' | 'arxivId'>): boolean {
  const ad = normalizeDoi(a.doi),
    bd = normalizeDoi(b.doi),
    aa = normalizeArxiv(a.arxivId),
    ba = normalizeArxiv(b.arxivId);
  return !!((ad && bd && ad !== bd) || (aa && ba && aa !== ba));
}
export function identityMatches(a: IdentityEvidence, b: IdentityEvidence): boolean {
  if (identifiersConflict(a, b)) return false;
  if (
    (normalizeDoi(a.doi) && normalizeDoi(a.doi) === normalizeDoi(b.doi)) ||
    (normalizeArxiv(a.arxivId) && normalizeArxiv(a.arxivId) === normalizeArxiv(b.arxivId))
  )
    return true;
  if (!a.title || !b.title || !titleMatches(a.title, b.title)) return false;
  if (a.year && b.year && a.year !== b.year) return false;
  if (a.authors?.length && b.authors?.length) {
    const names = (value: string) => normalizedTitle(value).split(' ');
    if (
      !a.authors.some((first) =>
        b.authors!.some((second) => {
          const left = names(first),
            right = names(second);
          return (
            normalizedTitle(first) === normalizedTitle(second) ||
            (left.length > 1 && right.length > 1 && left.at(-1) === right.at(-1) && left[0][0] === right[0][0])
          );
        }),
      )
    )
      return false;
  }
  return true;
}
export function titleMatches(a: string, b: string): boolean {
  const first = normalizedTitle(a),
    second = normalizedTitle(b);
  // Title-only identity must preserve sequence. Reordered treatment/causal terms
  // can describe a different study despite identical bag-of-words similarity.
  return first === second && first.length >= 5;
}
export function safePublicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value),
      h = u.hostname.toLowerCase();
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      !h.includes('.') ||
      h.endsWith('.local') ||
      h.endsWith('.localhost') ||
      h === 'localhost' ||
      /^\[|^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.|$)/.test(h)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const year = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 3000 ? v : null);
export const unknownPublication = (): PublicationMetadata => ({
  year: null,
  venue: null,
  publicationKind: 'unknown',
  publicationDate: null,
  oaAvailability: 'unknown',
  oaPdfUrl: null,
});
export function openAlexMetadata(work: Row): PublicationMetadata {
  const location = row(work.primary_location),
    source = row(location.source),
    oa = row(work.open_access),
    best = row(work.best_oa_location);
  const availability = oa.is_oa === true ? 'open' : oa.is_oa === false ? 'closed' : 'unknown';
  const kind =
    work.type === 'preprint'
      ? 'preprint'
      : work.type === 'conference-paper' || source.type === 'conference'
        ? 'conference'
        : source.type === 'journal'
          ? 'journal'
          : typeof work.type === 'string' && work.type !== 'article'
            ? 'other'
            : 'unknown';
  const date = str(work.publication_date);
  const validDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
  return {
    sources: ['openAlex'],
    year: year(work.publication_year),
    venue: str(source.display_name),
    publicationKind: kind,
    publicationDate: validDate,
    oaAvailability: availability,
    oaPdfUrl: availability === 'open' ? (safePublicUrl(best.pdf_url) ?? (location.is_oa === true ? safePublicUrl(location.pdf_url) : null)) : null,
  };
}
export function crossrefMetadata(work: Row): PublicationMetadata {
  const dates = ['published', 'issued', 'published-online', 'published-print']
    .map((k) => row(work[k])['date-parts'])
    .find((v) => Array.isArray(v) && Array.isArray(v[0])) as number[][] | undefined;
  const parts = dates?.[0],
    y = year(parts?.[0]);
  const publicationDate =
    y && parts?.length === 3 && parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1 && parts[2] <= 31
      ? `${y}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`
      : null;
  return {
    ...unknownPublication(),
    sources: ['crossref'],
    year: y,
    venue: Array.isArray(work['container-title']) ? str(work['container-title'][0]) : null,
    publicationKind:
      work.type === 'journal-article'
        ? 'journal'
        : work.type === 'proceedings-article'
          ? 'conference'
          : work.type === 'posted-content'
            ? 'preprint'
            : typeof work.type === 'string'
              ? 'other'
              : 'unknown',
    publicationDate:
      publicationDate && Number.isFinite(Date.parse(publicationDate)) && new Date(publicationDate).toISOString().slice(0, 10) === publicationDate
        ? publicationDate
        : null,
  };
}
export function invertedAbstract(value: unknown): string {
  const pieces = new Map<number, string>();
  for (const [word, positions] of Object.entries(row(value)))
    if (Array.isArray(positions)) for (const pos of positions) if (Number.isInteger(pos) && pos >= 0 && pos < 10000) pieces.set(pos, word);
  return [...pieces]
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(' ')
    .slice(0, 3000);
}
export function publicationIdentity(item: { doi?: string | null; arxivId?: string | null; title?: string | null; url?: string | null }): string {
  return normalizeDoi(item.doi)
    ? `doi:${normalizeDoi(item.doi)}`
    : normalizeArxiv(item.arxivId)
      ? `arxiv:${normalizeArxiv(item.arxivId)}`
      : `title:${normalizedTitle(item.title ?? '')}:${item.url ?? ''}`;
}
