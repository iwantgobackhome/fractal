import type { Paper } from '@fractal/shared';
import { locale, t } from '../i18n';

/** "Vaswani, Shazeer 외 6명" — family names first, the rest counted. */
export function authorsLine(authors: string[], shown = 2): string {
  if (authors.length === 0) return t('paper.noAuthors');
  const family = (name: string) => {
    const trimmed = name.trim();
    if (trimmed.includes(',')) return trimmed.split(',')[0].trim();
    const parts = trimmed.split(/\s+/);
    return parts[parts.length - 1];
  };
  const head = authors.slice(0, shown).map(family).join(', ');
  const rest = authors.length - shown;
  return rest > 0 ? t('paper.moreAuthors', { head, count: rest }) : head;
}

/** Where the paper came from, in the shortest recognisable form. */
export function sourceLabel(paper: Paper): string {
  if (paper.arxivId !== null) return `arXiv ${paper.arxivId}${paper.version !== null ? `v${paper.version}` : ''}`;
  try {
    return new URL(paper.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return t('paper.localFile');
  }
}

export function addedLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale(), sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export function paperTitle(paper: Paper): string {
  return paper.title?.trim() || paper.arxivId || t('paper.untitled');
}

export function isProcessing(paper: Paper): boolean {
  return paper.status === 'fetching' || paper.status === 'extracting';
}
