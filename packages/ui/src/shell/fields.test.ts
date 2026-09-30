import { describe, expect, it } from 'vitest';
import { fieldName, registerCategories, searchCategories } from './fields';

describe('field search', () => {
  it('finds common fields by Korean name, English name and code before the hub list arrives', () => {
    expect(searchCategories('로보')[0]?.code).toBe('cs.RO');
    expect(searchCategories('robotics')[0]?.code).toBe('cs.RO');
    expect(searchCategories('cs.cl')[0]?.code).toBe('cs.CL');
    expect(searchCategories('')).toEqual([]);
  });

  it('uses the full list once registered, ranking exact codes and name starts first', () => {
    registerCategories([
      { code: 'eess.SY', group: 'eess', name: { en: 'Systems and Control', ko: '시스템·제어' } },
      { code: 'math.OC', group: 'math', name: { en: 'Optimization and Control', ko: '최적화·제어' } },
      { code: 'cs.SY', group: 'cs', name: { en: 'Systems and Control', ko: '시스템·제어' } },
    ]);
    expect(searchCategories('control').map((c) => c.code)).toEqual(['cs.SY', 'eess.SY', 'math.OC']);
    expect(searchCategories('math.oc')[0]?.code).toBe('math.OC');
    expect(fieldName('eess.SY')).not.toBe('eess.SY');
    expect(fieldName('nonexistent.XX')).toBe('nonexistent.XX');
  });
});
