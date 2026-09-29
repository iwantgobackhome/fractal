import type { LibraryRecord } from '@fractal/shared';

/** arXiv identifiers encode the submission month, including the pre-2007 category form. */
export function yearFromArxivId(arxivId: string | null): number | null {
  if (arxivId === null) return null;

  const modern = /^(\d{2})(?:0[1-9]|1[0-2])\.\d{4,5}(?:v\d+)?$/.exec(arxivId);
  if (modern) return 2000 + Number(modern[1]);

  const legacy = /^[a-z][a-z0-9.-]*\/(\d{2})(?:0[1-9]|1[0-2])\d{3}(?:v\d+)?$/.exec(arxivId);
  if (!legacy) return null;

  const year = Number(legacy[1]);
  if (year > 7 && year < 91) return null;
  return year >= 91 ? 1900 + year : 2000 + year;
}

/** The old default used the date added; this is only for detecting untouched keys. */
export function legacyBibtexKey(record: LibraryRecord): string {
  const family = record.authors[0]?.family ?? 'paper';
  return `${family.replace(/\W/g, '').toLowerCase()}${record.addedAt.slice(0, 4)}`;
}

export function bibtexKeyBase(record: Pick<LibraryRecord, 'authors' | 'year'>): string {
  const family = record.authors[0]?.family ?? 'paper';
  const prefix = family.replace(/\W/g, '').toLowerCase() || 'paper';
  return `${prefix}${record.year ?? 'undated'}`;
}

/** Deterministic BibTeX collision suffixes: a through z, then aa, ab, ... */
export function uniqueBibtexKey(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;

  for (let index = 0; ; index += 1) {
    let value = index;
    let suffix = '';
    do {
      suffix = String.fromCharCode(97 + (value % 26)) + suffix;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);

    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
