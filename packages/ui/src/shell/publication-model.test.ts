import { describe, expect, it } from 'vitest';
import type { FeedItem, LibraryRecord } from '@fractal/shared';
import { matchPublication, uniqueFeedPapers } from './publication-model';
const paper = (id: string, overrides: Partial<FeedItem> = {}) =>
  ({ id, kind: 'paper', title: 'An actual research title', authors: ['Ada Lovelace'], doi: null, arxivId: null, ...overrides }) as FeedItem;
const record = (overrides: Partial<LibraryRecord> = {}) =>
  ({
    paperKey: 'stable',
    title: 'An actual research title',
    authors: [{ given: 'Ada', family: 'Lovelace' }],
    doi: null,
    arxivId: null,
    year: null,
    ...overrides,
  }) as LibraryRecord;
describe('publication identity projection', () => {
  it('recognizes DOI encoding/prefix and arxiv PDF/version/case aliases', () => {
    expect(matchPublication(paper('a', { doi: 'doi: 10.1234%2FABC' }), [record({ doi: 'https://doi.org/10.1234/abc' })])?.paperKey).toBe('stable');
    expect(matchPublication(paper('a', { arxivId: 'https://www.arxiv.org/pdf/HEP-TH/9901001v2.pdf' }), [record({ arxivId: 'hep-th/9901001' })])?.paperKey).toBe(
      'stable',
    );
  });
  it('does not claim a saved identity from short/punctuation titles, contradictory IDs or ambiguous records', () => {
    expect(matchPublication(paper('a', { title: 'A!' }), [record({ title: 'A?' })])).toBeNull();
    expect(matchPublication(paper('a', { doi: '10.1234/a', arxivId: '2409.01234' }), [record({ doi: '10.1234/a', arxivId: '2409.01235' })])).toBeNull();
    expect(matchPublication(paper('a'), [record(), record({ paperKey: 'second' })])).toBeNull();
    expect(matchPublication(paper('a', { authors: ['Grace Hopper'] }), [record()])).toBeNull();
  });
  it('keeps conflicting reported identities while removing repeated projections across sections', () => {
    const first = paper('a', { doi: '10.1234/a', arxivId: '2409.01234' }),
      repeat = paper('b', { doi: 'https://doi.org/10.1234%2Fa', arxivId: '2409.01234v2' }),
      conflict = paper('c', { doi: '10.1234/a', arxivId: '2409.01235' });
    expect(uniqueFeedPapers([first, repeat, conflict]).map((p) => p.id)).toEqual(['a', 'c']);
    expect(uniqueFeedPapers([paper('no-id', { doi: '10.1234/a' }), first, conflict]).map((p) => p.id)).toEqual(['no-id', 'c']);
  });
});
