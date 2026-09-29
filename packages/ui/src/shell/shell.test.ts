import { describe, expect, it } from 'vitest';
import type { Paper } from '@fractal/shared';
import { matchCommand, type Command } from './CommandPalette';
import { authorsLine, sourceLabel } from './paper-format';
import { nextTheme } from './theme';

const command = (label: string, keywords?: string): Command => ({ id: label, label, group: '이동', keywords, run: () => undefined });

describe('matchCommand', () => {
  it('matches every word against label, keywords and group', () => {
    expect(matchCommand(command('보관함', 'library'), 'lib')).toBe(true);
    expect(matchCommand(command('테마: 세피아', 'theme sepia'), '테마 sepia')).toBe(true);
    expect(matchCommand(command('설정'), '이동')).toBe(true);
    expect(matchCommand(command('설정'), 'library')).toBe(false);
  });
});

describe('paper formatting', () => {
  it('shortens author lists to family names', () => {
    expect(authorsLine(['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'])).toBe('Vaswani, Shazeer 외 1명');
    expect(authorsLine(['Ho, Jonathan'])).toBe('Ho');
    expect(authorsLine([])).toBe('저자 정보 없음');
  });

  it('labels the source', () => {
    const base = { arxivId: null, version: null, sourceUrl: 'https://www.nature.com/articles/x' } as Paper;
    expect(sourceLabel(base)).toBe('nature.com');
    expect(sourceLabel({ ...base, arxivId: '1706.03762', version: 7 })).toBe('arXiv 1706.03762v7');
  });
});

describe('nextTheme', () => {
  it('cycles light → sepia → dark → light', () => {
    expect(nextTheme('light')).toBe('sepia');
    expect(nextTheme('sepia')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('system')).toBe('light');
  });
});
