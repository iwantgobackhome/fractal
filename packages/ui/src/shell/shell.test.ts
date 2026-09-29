import { describe, expect, it } from 'vitest';
import type { Paper } from '@fractal/shared';
import { matchCommand, type Command } from './CommandPalette';
import { authorsLine, sourceLabel } from './paper-format';
import { nextTheme } from './theme';
import { readLimits, readUsage } from './hub-api';

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

describe('hub usage', () => {
  it('turns Codex quota windows into labelled limits', () => {
    const limits = readLimits({ codex: { primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_790_000_000 }, secondary: { usedPercent: 7, windowDurationMins: 10_080, resetsAt: null } }, claude: null });
    expect(limits.map((l) => [l.provider, l.label, l.usedPercent])).toEqual([
      ['codex', '5시간 한도', 42],
      ['codex', '주간 한도', 7],
    ]);
  });

  it('keeps missing token counts at zero', () => {
    const usage = readUsage({ totals: [{ day: '2026-09-30', provider: 'claude', model: 'sonnet', requests: 2, inputTokens: null, outputTokens: 30, durationMs: 10 }] });
    expect(usage.rows[0]).toMatchObject({ requests: 2, inputTokens: 0, outputTokens: 30 });
  });
});
