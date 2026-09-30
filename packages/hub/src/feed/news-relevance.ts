import { newsKeywordsForCategory, type FeedInterests, type FieldNewsKeywords } from '@fractal/shared';

const ignored = new Set(['and', 'the', 'for', 'with', 'from', 'of', 'in', 'on', 'to']);
const words = (value: string): string[] =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.filter((word) => !ignored.has(word)) ?? [];
const normalized = (value: string): string => words(value).join(' ');
const unique = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

export function newsQueriesForField(field: string, interests: FeedInterests): FieldNewsKeywords {
  if (!field.startsWith('custom:')) return newsKeywordsForCategory(field);
  const custom = (interests.custom ?? []).find((item) => `custom:${item.id}` === field);
  if (!custom) return { en: [], ko: [] };
  const values = unique([custom.query, custom.label]);
  const korean = values.filter((value) => /[\uac00-\ud7af]/u.test(value));
  return { en: values.slice(0, 2), ko: (korean.length ? korean : values).slice(0, 2) };
}

function termsForField(field: string, interests: FeedInterests): string[] {
  const queries = newsQueriesForField(field, interests);
  const phrases = unique([...queries.en, ...queries.ko]);
  if (field.startsWith('custom:')) return unique([...phrases, ...phrases.flatMap(words).filter((word) => word.length >= 4)]);
  return phrases;
}

/** Match full field phrases in the visible story text, then rank title matches first. */
export function newsMatchScore(title: string, description: string, interests: FeedInterests, field = ''): number {
  const terms = unique(
    field
      ? termsForField(field, interests)
      : [
          ...interests.categories.flatMap((code) => termsForField(code, interests)),
          ...(interests.custom ?? []).flatMap((item) => termsForField(`custom:${item.id}`, interests)),
          ...interests.topics.flatMap(words),
        ],
  );
  const titleText = ` ${normalized(title)} `;
  const descriptionText = ` ${normalized(description)} `;
  let score = 0;
  for (const term of terms) {
    const phrase = normalized(term);
    if (!phrase) continue;
    score += titleText.includes(` ${phrase} `) ? 3 : descriptionText.includes(` ${phrase} `) ? 1 : 0;
  }
  return score;
}
