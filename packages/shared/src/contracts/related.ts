import type { FeedItem } from './feed';
export interface RelatedPaper {
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  abstract?: string;
  arxivId: string | null;
  doi: string | null;
  url: string;
  citationCount?: number;
  relation: 'similar' | 'cites' | 'citedBy';
  inLibrary: boolean;
  image?: FeedItem['image'];
}
export interface RelatedPapersResponse {
  items: RelatedPaper[];
  source: 'semanticScholar' | 'openAlex';
  fetchedAt: string;
}
