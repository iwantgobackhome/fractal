import type { FeedItem } from './feed';
import type { PublicationMetadata, PublicationProviderStatus } from './publication';
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
  publication?: PublicationMetadata;
  provider?: 'semanticScholar' | 'openAlex';
  relations?: RelatedPaper['relation'][];
}
export interface RelatedPapersResponse {
  items: RelatedPaper[];
  source: 'semanticScholar' | 'openAlex';
  fetchedAt: string | null;
  status?: 'ready' | 'partial' | 'stale' | 'unavailable';
  providerStatus?: PublicationProviderStatus[];
}
