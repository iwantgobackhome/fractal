import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfJsStructureDetector } from '../src/structure/detector';
import { extractPdf } from '../src/pdf/index';

for (const id of ['1706.03762', '2006.11239', '2010.11929']) {
  const bytes = readFileSync(`${process.env.TEMP}\\fractal-${id}.pdf`);
  const result = await new PdfJsStructureDetector().detect(bytes, id);
  const blocks = (await extractPdf(bytes, id)).blocks;
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  const lines: string[] = [];
  const rightMarginNumbers = new Set<string>();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || !('transform' in item)) continue;
      const number = /\((\d+)\)\s*$/.exec(item.str)?.[1];
      const right = (item.transform[4] + item.width - page.view[0]) / (page.view[2] - page.view[0]);
      if (number && right > 0.7) rightMarginNumbers.add(number);
    }
    lines.push(content.items.filter((item): item is typeof item & { str: string } => 'str' in item).map((item) => item.str).join(' '));
  }
  await task.destroy();
  const full = lines.join(' ');
  const labelCount = (pattern: RegExp) => new Set([...full.matchAll(pattern)].map((match) => match[1])).size;
  console.log(JSON.stringify({
    id,
    pages: pdf.numPages,
    detected: {
      figures: result.items.filter((item) => item.kind === 'figure').length,
      tables: result.items.filter((item) => item.kind === 'table').length,
      equations: result.items.filter((item) => item.kind === 'equation').length,
      references: result.references.length,
      markers: result.markers.length,
    },
    textLabels: {
      figures: labelCount(/\b(?:Figure|Fig\.)\s*(\d+)/gi),
      tables: labelCount(/\bTable\s*(\d+)/gi),
      equationNumbers: labelCount(/\((\d+)\)/g),
      references: labelCount(/\[(\d+)\]/g),
    },
    captionLabels: {
      figures: [...new Set(blocks.filter((block) => block.kind === 'caption').map((block) => /^(?:Figure|Fig\.)\s*(\d+)/i.exec(block.sourceText)?.[1]).filter(Boolean))],
      tables: [...new Set(blocks.filter((block) => block.kind === 'caption').map((block) => /^Table\s*(\d+)/i.exec(block.sourceText)?.[1]).filter(Boolean))],
    },
    rightMarginNumbers: [...rightMarginNumbers],
    equationCandidates: blocks.filter((block) => /\(\d+\)\s*$/.test(block.sourceText) && block.sourceText.length < 120).slice(0, 30).map((block) => ({ kind: block.kind, page: block.regions[0]?.page, text: block.sourceText.slice(0, 70) })),
    examples: result.items.slice(0, 3).map(({ kind, label, page, bbox }) => ({ kind, label, page, bbox })),
  }));
}
