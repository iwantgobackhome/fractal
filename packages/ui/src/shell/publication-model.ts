import type { FeedItem, LibraryRecord, PublicationMetadata } from '@fractal/shared';

export interface PublicationItem {
  title: string;
  authors: string[];
  doi?: string | null;
  arxivId?: string | null;
  url: string;
  abstract?: string | null;
  publication?: PublicationMetadata;
}
const normalized = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function doi(value?: string | null): string | null {
  let result = (value ?? '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  try {
    result = decodeURIComponent(result);
  } catch {
    return null;
  }
  return /^10\.\d{4,9}\/[^\s?#]+$/i.test(result) ? result.toLowerCase() : null;
}
function arxiv(value?: string | null): string | null {
  const result = (value ?? '')
    .trim()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '')
    .replace(/v\d+$/i, '')
    .toLowerCase();
  return /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/.test(result) ? result : null;
}
type Evidence = Pick<PublicationItem, 'title' | 'authors' | 'doi' | 'arxivId' | 'publication'>;
function conflicts(a: Evidence, b: Evidence): boolean {
  const ad = doi(a.doi),
    bd = doi(b.doi),
    aa = arxiv(a.arxivId),
    ba = arxiv(b.arxivId);
  return !!((ad && bd && ad !== bd) || (aa && ba && aa !== ba));
}
function matches(a: Evidence, b: Evidence): boolean {
  if (conflicts(a, b)) return false;
  if ((doi(a.doi) && doi(a.doi) === doi(b.doi)) || (arxiv(a.arxivId) && arxiv(a.arxivId) === arxiv(b.arxivId))) return true;
  const title = normalized(a.title);
  if (title.length < 5 || title !== normalized(b.title)) return false;
  if (a.publication?.year && b.publication?.year && a.publication.year !== b.publication.year) return false;
  if (!a.authors.length || !b.authors.length) return true;
  return a.authors.some((first) =>
    b.authors.some((second) => {
      const left = normalized(first).split(' '),
        right = normalized(second).split(' ');
      return normalized(first) === normalized(second) || (left.length > 1 && right.length > 1 && left.at(-1) === right.at(-1) && left[0][0] === right[0][0]);
    }),
  );
}
export function sourceNames(source: string): string[] {
  return [
    ...new Set(
      source
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function providerName(source: string): string {
  if (source.startsWith('news:')) {
    const outlet = source.slice(5).split(':')[0];
    return (
      (
        {
          'news.google.com': 'Google News',
          'www.bing.com': 'Bing News',
          'research.google': 'Google Research',
          'deepmind.google': 'Google DeepMind',
          'openai.com': 'OpenAI',
          'bair.berkeley.edu': 'Berkeley AI Research',
          'thegradient.pub': 'The Gradient',
        } as Record<string, string>
      )[outlet] ?? outlet
    );
  }
  return (
    (
      { openAlex: 'OpenAlex', crossref: 'Crossref', semanticScholar: 'Semantic Scholar', arxiv: 'arXiv', huggingFace: 'Hugging Face' } as Record<string, string>
    )[source] ?? source.replace(/^news:/, '')
  );
}
/** Presentation-only lookup; an ambiguous identity never becomes a claimed saved record. */
export function matchPublication(item: PublicationItem, records: LibraryRecord[]): LibraryRecord | null {
  const found = records.filter((r) =>
    matches(item, {
      title: r.title ?? '',
      doi: r.doi,
      arxivId: r.arxivId,
      authors: r.authors.map((a) => `${a.given} ${a.family}`),
      publication: r.publication ?? (r.year ? ({ year: r.year } as PublicationMetadata) : undefined),
    }),
  );
  return found.length === 1 ? found[0] : null;
}
export function uniqueFeedPapers(items: FeedItem[]): FeedItem[] {
  const groups: FeedItem[][] = [];
  for (const item of items) {
    if (item.kind !== 'paper') continue;
    const found = groups.filter((group) => group.some((prior) => matches(prior, item)) && group.every((prior) => !conflicts(prior, item)));
    if (found.length === 1) found[0].push(item);
    else groups.push([item]);
  }
  return groups.map((group) => group[0]);
}
