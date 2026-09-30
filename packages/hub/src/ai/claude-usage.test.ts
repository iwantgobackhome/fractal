import { describe, expect, it } from 'vitest';
import { parseClaudeUsageScreen } from './claude-usage';

describe('Claude /usage screen', () => {
  it('reads both subscription windows and their local reset times', () => {
    const screen = '\x1b[2JCurrent session████20%usedResets3:50pm(Asia/Seoul)\nCurrent week (all models)████28%usedResetsOct 3, 10pm(Asia/Seoul)';
    expect(parseClaudeUsageScreen(screen, new Date('2026-09-30T00:00:00Z'))).toEqual({
      fiveHour: { usedPercent: 20, resetsAt: '2026-09-30T06:50:00.000Z' },
      weekly: { usedPercent: 28, resetsAt: '2026-10-03T13:00:00.000Z' },
    });
    expect(parseClaudeUsageScreen('No subscription windows')).toEqual({ fiveHour: null, weekly: null });
  });
});
