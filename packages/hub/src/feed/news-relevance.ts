import { arxivCategories, arxivGroups, type FeedInterests } from '@fractal/shared';

const ignored = new Set(['and', 'the', 'for', 'with', 'from', 'of', 'in', 'on', 'to', '및', '와', '과', '의']);
const words = (value: string): string[] =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.filter((word) => !ignored.has(word)) ?? [];

function termsForField(field: string, interests: FeedInterests): string[] {
  if (field.startsWith('custom:')) {
    const custom = (interests.custom ?? []).find((item) => `custom:${item.id}` === field);
    return custom ? words(`${custom.query} ${custom.label}`) : [];
  }
  const category = arxivCategories.find((item) => item.code === field);
  if (category) return words(`${category.name.en} ${category.name.ko}`);
  const group = arxivGroups.find((item) => item.id === field);
  return group ? words(`${group.name.en} ${group.name.ko}`) : [];
}

export function hasNewsInterests(interests: FeedInterests): boolean {
  return !!(interests.categories.length || (interests.custom ?? []).length || interests.topics.length);
}

/** Require a visible topic match, then weight title matches more heavily. */
export function newsMatchScore(title: string, description: string, interests: FeedInterests, field = ''): number {
  const terms = new Set(
    field
      ? termsForField(field, interests)
      : [
          ...interests.categories.flatMap((code) => termsForField(code, interests)),
          ...(interests.custom ?? []).flatMap((item) => termsForField(`custom:${item.id}`, interests)),
          ...interests.topics.flatMap(words),
        ],
  );
  if (!terms.size) return 0;
  const titleWords = new Set(words(title));
  const descriptionWords = new Set(words(description));
  let score = 0;
  for (const term of terms) score += titleWords.has(term) ? 3 : descriptionWords.has(term) ? 1 : 0;
  return score;
}
