import type { Annotation, LibraryRecord } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';

const clean = (v: string) =>
  v
    .replace(/[{}]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
export function bibtex(records: LibraryRecord[]): string {
  return (
    records
      .map((r) => {
        const fields: [string, string | null][] = [
          ['title', r.title],
          ['author', r.authors.map((a) => [a.family, a.given].filter(Boolean).join(', ')).join(' and ')],
          ['year', r.year?.toString() ?? null],
          ['journal', r.venue],
          ['doi', r.doi],
          ['eprint', r.arxivId],
          ['url', r.url],
          ['abstract', r.abstract],
        ];
        return `@article{${clean(r.bibtexKey)},\n${fields
          .filter(([, v]) => v)
          .map(([k, v]) => `  ${k} = {${clean(v!)}},`)
          .join('\n')}\n}`;
      })
      .join('\n\n') + '\n'
  );
}
export function cslJson(records: LibraryRecord[]): unknown[] {
  return records.map((r) => ({
    id: r.bibtexKey,
    type: 'article-journal',
    title: r.title,
    author: r.authors.map((a) => ({ given: a.given, family: a.family })),
    issued: r.year ? { 'date-parts': [[r.year]] } : undefined,
    'container-title': r.venue,
    DOI: r.doi,
    URL: r.url,
    abstract: r.abstract,
  }));
}
export function markdown(
  record: LibraryRecord,
  annotations: Annotation[],
  highlights: { page: number; text: string; note: string | null }[],
  aiNotes: string[] = [],
): string {
  const yaml = (s: string) => JSON.stringify(s);
  const lines = [
    '---',
    `citekey: ${yaml(record.bibtexKey)}`,
    `title: ${yaml(record.title ?? '')}`,
    `doi: ${yaml(record.doi ?? '')}`,
    '---',
    '',
    `# ${record.title ?? record.bibtexKey}`,
    '',
  ];
  for (const h of highlights) lines.push(`> ${h.text.replace(/\n/g, '\n> ')}`, `> — p. ${h.page}`, '', ...(h.note ? [h.note, ''] : []));
  for (const a of annotations)
    if (!a.deleted) {
      if (a.kind === 'highlight') lines.push(`> ${a.text.replace(/\n/g, '\n> ')}`, `> — p. ${a.page}`, '', ...(a.note ? [a.note, ''] : []));
      if (a.kind === 'memo') lines.push(`## Memo · p. ${a.page}`, '', a.quote ? `> ${a.quote}` : '', a.text, '');
    }
  if (aiNotes.length) lines.push('## AI notes', '', ...aiNotes.flatMap((n) => [n, '']));
  return lines.join('\n').trimEnd() + '\n';
}
export function exportLibrary(store: SqlitePaperStore, format: 'bibtex' | 'csl-json', keys?: string[]): string {
  const records = keys ? keys.map((k) => store.getLibrary(k)).filter((r): r is LibraryRecord => r !== null) : store.listLibrary();
  return format === 'bibtex' ? bibtex(records) : JSON.stringify(cslJson(records), null, 2) + '\n';
}
