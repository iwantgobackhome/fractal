import { describe, expect, it } from 'vitest';
import { publicationBookmarkSchema, publicationMetadataSchema } from './publication';
import { feedSettingsSchema } from './feed';
import { libraryPatchSchema } from './library';

describe('discovery wire compatibility', () => {
  const unknown = { year: null, venue: null, publicationKind: 'unknown', publicationDate: null, oaAvailability: 'unknown', oaPdfUrl: null };
  it('accepts old source settings without inventing optional source flags', () => {
    const old = {
      sources: { arxiv: true, huggingFace: false, news: true, recommendations: false },
      customRssFeeds: [],
      digestEnabled: false,
      refreshIntervalHours: 6,
      translateNewsTitles: true,
    };
    expect(feedSettingsSchema.parse(old)).toEqual(old);
    expect(feedSettingsSchema.parse({ ...old, sources: { ...old.sources, openAlex: false, crossref: true } }).sources.openAlex).toBe(false);
  });
  it('retains honest unknowns and optional provider provenance in catalog edits', () => {
    expect(publicationMetadataSchema.parse(unknown)).toEqual(unknown);
    expect(libraryPatchSchema.parse({ publication: { ...unknown, sources: ['openAlex', 'crossref'] } })).toEqual({
      publication: { ...unknown, sources: ['openAlex', 'crossref'] },
    });
  });
  it('rejects fictional calendar dates and insecure bookmark schemes', () => {
    expect(publicationMetadataSchema.safeParse({ ...unknown, publicationDate: '2026-02-31' }).success).toBe(false);
    expect(publicationMetadataSchema.safeParse({ ...unknown, publicationDate: '2026-02-28' }).success).toBe(true);
    expect(publicationBookmarkSchema.safeParse({ title: 'Paper', url: 'http://example.org/paper' }).success).toBe(false);
  });
});
