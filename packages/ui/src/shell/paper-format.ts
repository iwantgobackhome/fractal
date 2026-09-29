import type { Paper } from '@fractal/shared';

/** "Vaswani, Shazeer 외 6명" — family names first, the rest counted. */
export function authorsLine(authors: string[], shown = 2): string {
  if (authors.length === 0) return '저자 정보 없음';
  const family = (name: string) => {
    const trimmed = name.trim();
    if (trimmed.includes(',')) return trimmed.split(',')[0].trim();
    const parts = trimmed.split(/\s+/);
    return parts[parts.length - 1];
  };
  const head = authors.slice(0, shown).map(family).join(', ');
  const rest = authors.length - shown;
  return rest > 0 ? `${head} 외 ${rest}명` : head;
}

/** Where the paper came from, in the shortest recognisable form. */
export function sourceLabel(paper: Paper): string {
  if (paper.arxivId !== null) return `arXiv ${paper.arxivId}${paper.version !== null ? `v${paper.version}` : ''}`;
  try {
    return new URL(paper.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return '로컬 파일';
  }
}

const sameYear = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
const otherYear = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

export function addedLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.getFullYear() === now.getFullYear() ? sameYear.format(date) : otherYear.format(date);
}

export function paperTitle(paper: Paper): string {
  return paper.title?.trim() || paper.arxivId || '제목 없는 논문';
}

export function isProcessing(paper: Paper): boolean {
  return paper.status === 'fetching' || paper.status === 'extracting';
}
