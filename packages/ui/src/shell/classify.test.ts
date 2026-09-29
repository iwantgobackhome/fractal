import { describe, expect, it } from 'vitest';
import { classifyInput } from './classify';

describe('classifyInput', () => {
  it('recognises arXiv ids and urls', () => {
    expect(classifyInput('2401.01234')).toEqual({ kind: 'arxiv', value: '2401.01234' });
    expect(classifyInput('arXiv:2401.01234v2')).toEqual({ kind: 'arxiv', value: '2401.01234v2' });
    expect(classifyInput('https://arxiv.org/abs/2401.01234')).toEqual({ kind: 'arxiv', value: '2401.01234' });
    expect(classifyInput('https://arxiv.org/pdf/2401.01234v3.pdf')).toEqual({ kind: 'arxiv', value: '2401.01234v3' });
    expect(classifyInput('hep-th/9901001')).toEqual({ kind: 'arxiv', value: 'hep-th/9901001' });
  });

  it('recognises DOIs', () => {
    expect(classifyInput('10.1038/nature14539')).toEqual({ kind: 'doi', value: '10.1038/nature14539' });
    expect(classifyInput('doi:10.1145/3292500.3330701')).toEqual({ kind: 'doi', value: '10.1145/3292500.3330701' });
    expect(classifyInput('https://doi.org/10.1038/nature14539')).toEqual({ kind: 'doi', value: '10.1038/nature14539' });
  });

  it('treats other links as urls and everything else as a search', () => {
    expect(classifyInput('https://openreview.net/forum?id=abc')).toEqual({ kind: 'url', value: 'https://openreview.net/forum?id=abc' });
    expect(classifyInput('  diffusion transformer  ')).toEqual({ kind: 'search', value: 'diffusion transformer' });
    expect(classifyInput('   ')).toEqual({ kind: 'empty' });
  });
});
