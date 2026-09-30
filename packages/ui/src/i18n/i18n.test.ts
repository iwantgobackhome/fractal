import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { getLanguage, setLanguage, t } from './index';
import { ko } from './ko';

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix === '' ? key : `${prefix}.${key}`));
}

afterEach(() => setLanguage('ko'));

describe('i18n', () => {
  it('fills placeholders and follows the current language', () => {
    setLanguage('ko');
    expect(t('paper.moreAuthors', { head: 'Vaswani, Shazeer', count: 6 })).toBe('Vaswani, Shazeer 외 6명');
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(t('paper.moreAuthors', { head: 'Vaswani, Shazeer', count: 6 })).toBe('Vaswani, Shazeer and 6 more');
  });

  it('has the same keys and placeholders in Korean and English', () => {
    const koKeys = leaves(ko).sort();
    expect(leaves(en).sort()).toEqual(koKeys);
    for (const key of koKeys) {
      const get = (dict: unknown) => key.split('.').reduce((node, part) => (node as Record<string, unknown>)[part], dict) as string;
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(get(en)), key).toEqual(names(get(ko)));
    }
  });
});
