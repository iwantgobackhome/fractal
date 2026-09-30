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
const doi = (s?: string | null) =>
  (s ?? '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .toLowerCase();
const arxiv = (s?: string | null) =>
  (s ?? '')
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '')
    .replace(/v\d+$/, '');
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
  return (
    (
      { openAlex: 'OpenAlex', crossref: 'Crossref', semanticScholar: 'Semantic Scholar', arxiv: 'arXiv', huggingFace: 'Hugging Face' } as Record<string, string>
    )[source] ?? source.replace(/^news:/, '')
  );
}
/** Presentation-only lookup; an ambiguous identity never becomes a claimed saved record. */
export function matchPublication(item: PublicationItem, records: LibraryRecord[]): LibraryRecord | null {
  const matches = records.filter((r) => {
    if (doi(item.doi) && doi(r.doi) && doi(item.doi) !== doi(r.doi)) return false;
    if (arxiv(item.arxivId) && arxiv(r.arxivId) && arxiv(item.arxivId) !== arxiv(r.arxivId)) return false;
    if ((doi(item.doi) && doi(item.doi) === doi(r.doi)) || (arxiv(item.arxivId) && arxiv(item.arxivId) === arxiv(r.arxivId))) return true;
    if (normalized(item.title) !== normalized(r.title ?? '')) return false;
    const year = item.publication?.year;
    if (year && r.year && year !== r.year) return false;
    const authors = item.authors.map(normalized),
      stored = r.authors.map((a) => normalized(`${a.given} ${a.family}`));
    return !authors.length || !stored.length || authors.some((a) => stored.includes(a));
  });
  return matches.length === 1 ? matches[0] : null;
}
export function uniqueFeedPapers(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.kind !== 'paper') return false;
    const key = doi(item.doi)
      ? `doi:${doi(item.doi)}`
      : arxiv(item.arxivId)
        ? `arxiv:${arxiv(item.arxivId)}`
        : `${normalized(item.title)}|${item.authors.map(normalized).join('|')}|${item.publication?.year ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
