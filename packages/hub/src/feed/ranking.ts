import type { FeedInterests, FeedItem, LibraryRecord } from '@fractal/shared';
import type { Preferences } from '@fractal/shared';
import type { RawItem } from './sources';
import { newsMatchScore } from './news-relevance';

const words = (value: string): string[] =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [];
const normalizedTitle = (value: string): string => words(value).join(' ');
const identity = (item: RawItem): string =>
  item.arxivId ? `a:${item.arxivId.toLowerCase().replace(/v\d+$/, '')}` : item.doi ? `d:${item.doi.toLowerCase()}` : `t:${normalizedTitle(item.title)}`;

export function deduplicate(items: RawItem[]): RawItem[] {
  const seen = new Map<string, number>();
  const output: RawItem[] = [];
  for (const item of items) {
    const keys = [identity(item), `t:${normalizedTitle(item.title)}`];
    const index = keys.map((key) => seen.get(key)).find((value) => value !== undefined);
    if (index !== undefined) {
      const existing = output[index]!;
      const merged: RawItem = {
        ...existing,
        abstract: existing.abstract.length >= item.abstract.length ? existing.abstract : item.abstract,
        authors: existing.authors.length ? existing.authors : item.authors,
        arxivId: existing.arxivId ?? item.arxivId,
        doi: existing.doi ?? item.doi,
        categories: [...new Set([...existing.categories, ...item.categories])],
        popularity: Math.max(existing.popularity, item.popularity),
        source: [...new Set([...existing.source.split(','), ...item.source.split(',')])].join(','),
        image: existing.image ?? item.image ?? null,
        imageCandidate: item.source.includes('bing.com') && item.imageCandidate ? item.imageCandidate : (existing.imageCandidate ?? item.imageCandidate),
        topicIds: [...new Set([...(existing.topicIds ?? []), ...(item.topicIds ?? [])])],
      };
      output[index] = merged;
      for (const key of keys) seen.set(key, index);
    } else {
      const next = output.push(item) - 1;
      for (const key of keys) seen.set(key, next);
    }
  }
  return output;
}

function libraryMatch(item: RawItem, library: LibraryRecord[]): boolean {
  return library.some((record) =>
    Boolean(
      (item.arxivId && record.arxivId?.replace(/v\d+$/, '').toLowerCase() === item.arxivId.toLowerCase()) ||
      (item.doi && record.doi?.toLowerCase() === item.doi.toLowerCase()) ||
      (record.title && normalizedTitle(record.title) === normalizedTitle(item.title)),
    ),
  );
}

/** Small BM25-like term score over title and abstract, with title weighted twice. */
function relevance(
  item: RawItem,
  interests: FeedInterests,
  uiLanguage: Preferences['uiLanguage'],
): Pick<FeedItem, 'score' | 'reason' | 'reasonCode' | 'reasonParams'> {
  const title = words(item.title);
  const abstract = words(item.abstract);
  const wanted = [...new Set(interests.topics.flatMap(words))];
  let termScore = 0;
  let bestTerm = '';
  for (const term of wanted) {
    const frequency = title.filter((word) => word === term).length * 2 + abstract.filter((word) => word === term).length;
    const score = frequency ? (2.2 * frequency) / (frequency + 1.2 * (0.25 + (0.75 * (title.length * 2 + abstract.length)) / 180)) : 0;
    termScore += score;
    if (score > 0 && !bestTerm) bestTerm = term;
  }
  const category = item.categories.find(
    (value) => interests.categories.includes(value) || (interests.custom ?? []).some((interest) => value === `custom:${interest.id}`),
  );
  const author = item.authors.find((value) => interests.authors.some((wantedAuthor) => value.toLowerCase().includes(wantedAuthor.toLowerCase())));
  const newsScore = item.kind === 'news' ? newsMatchScore(item.title, item.abstract, interests, category) : 0;
  const score = termScore + (category ? 4 : 0) + (author ? 5 : 0) + newsScore;
  const reasonCode = author
    ? 'followed_author'
    : category
      ? 'interest_category'
      : bestTerm
        ? 'interest_topic'
        : item.source.includes('recommendations')
          ? 'similar_library'
          : 'new_this_week';
  const reasonParams: Record<string, string> = author ? { author } : category ? { category } : bestTerm ? { topic: bestTerm } : {};
  const reason =
    uiLanguage === 'ko'
      ? author
        ? `팔로우한 저자 ${author}`
        : category
          ? `관심 분야 ${category}`
          : bestTerm
            ? `관심 주제 ${bestTerm}`
            : reasonCode === 'similar_library'
              ? '보관한 논문과 비슷함'
              : '이번 주 새 소식'
      : author
        ? `Followed author ${author}`
        : category
          ? `Interested in ${category}`
          : bestTerm
            ? `Topic ${bestTerm}`
            : reasonCode === 'similar_library'
              ? 'Similar to saved papers'
              : 'New this week';
  return { score, reason, reasonCode, reasonParams };
}

export function rankItems(
  items: RawItem[],
  interests: FeedInterests,
  library: LibraryRecord[],
  now: Date,
  uiLanguage: Preferences['uiLanguage'] = 'ko',
): FeedItem[] {
  return deduplicate(items)
    .map((item) => {
      const match = relevance(item, interests, uiLanguage);
      const ageDays = Math.max(0, (now.getTime() - Date.parse(item.publishedAt)) / 86400000);
      const recency = 2 * Math.exp(-ageDays / 7);
      const popularity = Math.min(4, Math.log1p(item.popularity) / 2);
      return {
        ...item,
        image: item.image ?? null,
        score: Math.round((match.score + recency + popularity) * 100) / 100,
        reason: match.reason,
        reasonCode: match.reasonCode,
        reasonParams: match.reasonParams,
        inLibrary: libraryMatch(item, library),
      };
    })
    .sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}
