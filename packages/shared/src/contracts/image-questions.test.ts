import { describe, expect, it } from 'vitest';
import { askPaperSchema, explainSchema } from './ai';
import { historyEntrySchema } from './history';
const bbox = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const attachment = { page: 2, bbox, kind: 'figure', label: 'Figure 3' };
describe('backward compatible image questions', () => {
  it('accepts old ask and explain clients, and strips unknown keys', () => {
    expect(askPaperSchema.parse({ question: 'Why?', unknown: true })).toEqual({ question: 'Why?' });
    expect(explainSchema.parse({ kind: 'figure', page: 2, bbox, croppedPngBase64: 'png' }).croppedPngBase64).toBe('png');
  });
  it('accepts crops and geometry descriptors on both endpoints', () => {
    expect(askPaperSchema.parse({ question: 'Why?', page: 2, rect: bbox, croppedPngBase64: 'png', attachment }).attachment).toEqual(attachment);
    expect(explainSchema.parse({ question: 'Figure 3 설명', kind: 'figure', page: 2, bbox, attachment }).question).toBe('Figure 3 설명');
  });
  it('rejects a descriptor on a different physical page', () => {
    expect(() => askPaperSchema.parse({ question: 'Why?', page: 1, attachment })).toThrow('attachment must match');
    expect(() => explainSchema.parse({ kind: 'figure', page: 1, bbox, attachment })).toThrow('attachment must match');
  });
  it('history context strips bytes while retaining the small descriptor', () => {
    const context = historyEntrySchema.shape.context.parse({ page: 2, rect: bbox, attachment, croppedPngBase64: 'large-data' });
    expect(context).toEqual({ page: 2, rect: bbox, attachment });
  });
});
