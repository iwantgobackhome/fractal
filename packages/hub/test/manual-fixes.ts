import { readFileSync } from 'node:fs';
import { PdfJsStructureDetector } from '../src/structure/detector';
import { latexFiles, matchLatex, mathSimilarity, parseLatexSources } from '../src/structure/source';
import { enrichReference } from '../src/structure/enrichment';

for (const id of ['1706.03762', '2006.11239']) {
  const pdf = readFileSync(`${process.env.TEMP}\\fractal-${id}.pdf`);
  const source = readFileSync(`${process.env.TEMP}\\fractal-${id}.source`);
  const structure = await new PdfJsStructureDetector().detect(pdf, id);
  const fragments = parseLatexSources(latexFiles(source));
  const matched = matchLatex(structure.items, fragments);
  const equations = matched.filter((item) => item.kind === 'equation' && /^\(\d+\)$/.test(item.label));
  console.log(JSON.stringify({ id, numberedEquations: equations.map((item) => {
    const source = fragments.find((fragment) => fragment.latex && fragment.latex === item.latex);
    const score = source?.latex ? mathSimilarity(item.caption, source.latex) : 0;
    const best = Math.max(...fragments.filter((fragment) => fragment.kind === 'equation' && fragment.latex).map((fragment) => mathSimilarity(item.caption, fragment.latex!)));
    return { page: item.page, number: item.label, pdf: item.caption.slice(0, 70), sourceNumber: source?.number ?? null, sourceLabel: source?.label ?? null, score: Number(score.toFixed(2)), best: Number(best.toFixed(2)), attached: Boolean(item.latex) };
  }) }));
  if (id === '1706.03762') {
    for (const n of ['1', '6', '10', '11', '23']) {
      const reference = structure.references.find((entry) => entry.n === n);
      if (!reference) continue;
      const enrichment = await enrichReference(reference);
      console.log(JSON.stringify({ reference: n, raw: reference.raw.slice(0, 110), title: enrichment?.title ?? null, provider: enrichment?.provider ?? null, year: enrichment?.year ?? null }));
    }
  }
}
