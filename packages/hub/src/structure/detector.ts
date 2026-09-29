import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Block, CitationMarker, PaperStructure, ReferenceEntry, StructureBox, StructureItem } from '@fractal/shared';
import { extractPdf, textItemRegion } from '../pdf/index';

export const STRUCTURE_VERSION = 'pdfjs-structure-v1';

export interface StructureDetector {
  detect(bytes: Uint8Array, paperKey: string, blocks?: Block[]): Promise<PaperStructure>;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 20);
const captionPattern = /^(Figure|Fig\.?|그림|Table|표)\s*([A-Z]?\d+[a-z]?|[IVX]+)\s*[:.\-–—]?\s*/i;
const citationPattern = /\[((?:\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)(?:\s*[,;]\s*\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)*)\]/g;

function boxOf(block: Block): StructureBox | null {
  const regions = block.regions;
  if (regions.length === 0) return null;
  const x = Math.max(0, Math.min(...regions.map((r) => r.x)));
  const y = Math.max(0, Math.min(...regions.map((r) => r.y)));
  const right = Math.min(1, Math.max(...regions.map((r) => r.x + r.width)));
  const bottom = Math.min(1, Math.max(...regions.map((r) => r.y + r.height)));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function distance(a: StructureBox, b: StructureBox): number {
  const vertical = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
  const horizontal = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
  return vertical + horizontal * 0.5;
}

export function parseReferences(blocks: readonly Block[]): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  let current: ReferenceEntry | null = null;
  let inReferences = false;
  for (const block of blocks) {
    const text = block.sourceText.replace(/\s+/g, ' ').trim();
    const heading = text.replace(/\s+/g, '');
    if (/^(references|bibliography|참고문헌)$/i.test(heading)) {
      inReferences = true;
      continue;
    }
    if (!inReferences && block.kind !== 'reference') continue;
    if (inReferences && /^(appendix|[A-D]APPENDIX)$/i.test(heading)) break;
    if (inReferences && block.kind === 'heading') break;
    if (block.kind !== 'reference' || !text) continue;
    const numbered = /^\[(\d+)\]\s*(.*)$/.exec(text);
    if (numbered) {
      current = referenceFromRaw(numbered[1], numbered[2]);
      entries.push(current);
    } else if (inReferences && !entries.some((entry) => /^\d+$/.test(entry.n)) && /\b(?:19|20)\d{2}[a-z]?\b/.test(text) && text.length > 35) {
      current = referenceFromRaw(`author-${entries.length + 1}`, text);
      entries.push(current);
    } else if (current && /^\d+$/.test(current.n) && !/^\d+\s/.test(text)) {
      current.raw += ` ${text}`;
      Object.assign(current, referenceFromRaw(current.n, current.raw));
    } else if (!current && text.length > 20) {
      current = referenceFromRaw(String(entries.length + 1), text);
      entries.push(current);
    }
  }
  return entries;
}

function referenceFromRaw(n: string, raw: string): ReferenceEntry {
  const yearText = /\b(19\d{2}|20\d{2})\b/.exec(raw)?.[1];
  const doi = /\b10\.\d{4,9}\/[^\s,;]+/i.exec(raw)?.[0]?.replace(/[.)]+$/, '');
  const arxivId = /\barXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(raw)?.[1];
  const abbreviated = /^((?:(?:[A-Z]\.|[A-Z][a-z]+)\s+)+[A-Z][a-z]+)\.\s+(.+)$/.exec(raw);
  const authors = abbreviated?.[1] ?? raw.split(/\.\s+(?=[A-Z])/)[0]?.trim();
  const title = abbreviated?.[2]?.split(/\.\s+/)[0]?.trim();
  return { n, raw, ...(authors ? { authors } : {}), ...(title ? { title } : {}), ...(yearText ? { year: Number(yearText) } : {}), ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}) };
}

export function expandCitation(text: string): string[] {
  const result: string[] = [];
  for (const part of text.replace(/^\[|\]$/g, '').split(/[,;]/)) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part.trim());
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start <= 50) {
        for (let n = start; n <= end; n += 1) result.push(String(n));
      }
    } else if (/^\d+[a-z]?$/.test(part.trim())) {
      result.push(part.trim());
    }
  }
  return [...new Set(result)];
}

export function itemsFromBlocks(blocks: readonly Block[]): StructureItem[] {
  const captions = blocks.filter((block) => captionPattern.test(block.sourceText) && block.sourceText.trim().length >= 20);
  const used = new Set<string>();
  const items: StructureItem[] = [];
  for (const block of blocks) {
    if (!['figure', 'table', 'equation'].includes(block.kind)) continue;
    let bbox = boxOf(block);
    const page = block.regions[0]?.page;
    if (!bbox || !page) continue;
    const kind = block.kind as StructureItem['kind'];
    let label = '';
    let caption = '';
    let confidence = kind === 'equation' ? 0.64 : 0.48;
    if (kind === 'equation') {
      label = /\(\d+[a-z]?\)\s*$/.exec(block.sourceText)?.[0]?.trim() ?? '';
      if (label) confidence = 0.86;
      caption = block.sourceText.trim();
      if (label && bbox.width < 0.08) {
        const adjacent = blocks.filter((candidate) => {
          if (candidate === block || candidate.regions[0]?.page !== page || candidate.kind === 'reference') return false;
          const candidateBox = boxOf(candidate);
          if (!candidateBox || Math.abs(candidateBox.y - bbox!.y) > 0.025) return false;
          return /[=+−×∑∫^]/u.test(candidate.sourceText) && candidateBox.x < bbox!.x;
        });
        if (adjacent.length) {
          const math = adjacent[0];
          const mathBox = boxOf(math)!;
          const right = bbox.x + bbox.width;
          const bottom = Math.max(bbox.y + bbox.height, mathBox.y + mathBox.height);
          bbox = { x: mathBox.x, y: Math.min(bbox.y, mathBox.y), width: right - mathBox.x, height: bottom - Math.min(bbox.y, mathBox.y) };
          caption = math.sourceText.trim();
        }
      }
    } else {
      let best: Block | undefined;
      let bestDistance = 0.15;
      for (const candidate of captions) {
        if (candidate.regions[0]?.page !== page || used.has(candidate.blockId)) continue;
        const match = captionPattern.exec(candidate.sourceText);
        if (!match || (kind === 'figure') !== /^(Figure|Fig\.?|그림)$/i.test(match[1])) continue;
        const candidateBox = boxOf(candidate);
        if (!candidateBox) continue;
        const d = distance(bbox, candidateBox);
        if (d < bestDistance) {
          best = candidate;
          bestDistance = d;
        }
      }
      if (!best) continue;
      used.add(best.blockId);
      const match = captionPattern.exec(best.sourceText)!;
      label = `${kind === 'figure' ? 'Figure' : 'Table'} ${match[2]}`;
      caption = best.sourceText.trim();
      confidence = Math.max(0.6, 0.94 - bestDistance * 2);
    }
    items.push({ id: hash(`${block.paperKey}:${kind}:${page}:${block.blockId}`), kind, page, bbox, label, caption, confidence });
  }
  for (const captionBlock of captions) {
    if (used.has(captionBlock.blockId)) continue;
    const match = captionPattern.exec(captionBlock.sourceText);
    const captionBox = boxOf(captionBlock);
    const page = captionBlock.regions[0]?.page;
    if (!match || !captionBox || !page || captionBlock.sourceText.length < 20) continue;
    const kind = /^(Table|표)$/i.test(match[1]) ? 'table' : 'figure';
    const height = Math.min(0.18, kind === 'figure' ? captionBox.y : 1 - captionBox.y - captionBox.height);
    if (height < 0.04) continue;
    const bbox = { x: Math.max(0.03, captionBox.x - 0.04), y: kind === 'figure' ? captionBox.y - height : captionBox.y + captionBox.height, width: Math.min(0.94, captionBox.width + 0.08), height };
    items.push({ id: hash(`${captionBlock.paperKey}:${kind}:${page}:${captionBlock.blockId}`), kind, page, bbox, label: `${kind === 'figure' ? 'Figure' : 'Table'} ${match[2]}`, caption: captionBlock.sourceText.trim(), confidence: 0.38 });
  }
  const best = new Map<string, StructureItem>();
  for (const item of items) {
    const key = item.label ? `${item.kind}:${item.label}` : item.id;
    const previous = best.get(key);
    if (!previous || item.confidence > previous.confidence) best.set(key, item);
  }
  return [...best.values()];
}

interface TextPiece { text: string; box: StructureBox; page: number; baseline: number; font: string }

function supplementalEquations(pieces: readonly TextPiece[], blocks: readonly Block[], existing: readonly StructureItem[]): StructureItem[] {
  const rows = new Map<string, TextPiece[]>();
  for (const piece of pieces) {
    const key = `${piece.page}:${Math.round(piece.baseline * 350)}`;
    rows.set(key, [...(rows.get(key) ?? []), piece]);
  }
  const bibliography = blocks.find((block) => /^(references|bibliography)$/i.test(block.sourceText.replace(/\s+/g, '')));
  const appendix = blocks.find((block) => /^(appendix|[A-D]appendix)$/i.test(block.sourceText.replace(/\s+/g, '')));
  const start = bibliography?.regions[0]?.page ?? Number.POSITIVE_INFINITY;
  const end = appendix?.regions[0]?.page ?? Number.POSITIVE_INFINITY;
  const existingEquationCount = existing.filter((item) => item.kind === 'equation').length;
  const extras: StructureItem[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.box.x - b.box.x);
    const page = row[0].page;
    if (page >= start && page < end) continue;
    const text = row.map((piece) => piece.text).join(' ').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 160) continue;
    const x = Math.min(...row.map((piece) => piece.box.x));
    const y = Math.min(...row.map((piece) => piece.box.y));
    const right = Math.max(...row.map((piece) => piece.box.x + piece.box.width));
    const bottom = Math.max(...row.map((piece) => piece.box.y + piece.box.height));
    const width = right - x;
    const mathFont = row.some((piece) => /CMMI|CMSY|CMEX|STIX|CambriaMath|Symbol|Math/i.test(piece.font));
    const symbols = (text.match(/[=∑∫√≤≥±−×→∈∂α-ωΑ-Ω^_]/gu) ?? []).length;
    const words = (text.match(/[A-Za-z]{3,}/g) ?? []).length;
    const numbered = /\((\d+[a-z]?)\)\s*$/.exec(text);
    if (!numbered && existingEquationCount >= 10) continue;
    if (width < 0.04 || width > 0.8 || Math.abs(x + width / 2 - 0.5) > 0.22 || words > 8) continue;
    if (!numbered && !(mathFont && symbols >= 2) && symbols < 3) continue;
    if (existing.some((item) => item.kind === 'equation' && item.page === page && Math.abs(item.bbox.y - y) < 0.025)) continue;
    if (extras.some((item) => item.page === page && Math.abs(item.bbox.y - y) < 0.035)) continue;
    extras.push({ id: hash(`${page}:${x}:${y}:${text}`), kind: 'equation', page, bbox: { x, y, width, height: bottom - y }, label: numbered ? `(${numbered[1]})` : '', caption: text, confidence: numbered ? 0.72 : mathFont ? 0.56 : 0.46 });
  }
  return extras;
}

function markersFromPieces(pieces: TextPiece[], references: readonly ReferenceEntry[], referenceBlocks: readonly Block[]): CitationMarker[] {
  const valid = new Set(references.map((reference) => reference.n));
  const rows = new Map<string, TextPiece[]>();
  for (const piece of pieces) {
    const key = `${piece.page}:${Math.round(piece.baseline * 500)}`;
    rows.set(key, [...(rows.get(key) ?? []), piece]);
  }
  const markers: CitationMarker[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.box.x - b.box.x);
    const text = row.map((piece) => piece.text).join('');
    const offsets = row.map((_, index) => row.slice(0, index).reduce((sum, piece) => sum + piece.text.length, 0));
    for (const match of text.matchAll(citationPattern)) {
      const refs = expandCitation(match[0]).filter((n) => valid.has(n));
      if (refs.length === 0) continue;
      const start = match.index;
      const end = start + match[0].length;
      const touched = row.filter((piece, index) => offsets[index] < end && offsets[index] + piece.text.length > start);
      if (touched.length === 0) continue;
      const firstIndex = row.indexOf(touched[0]);
      const lastIndex = row.indexOf(touched[touched.length - 1]);
      const firstOffset = Math.max(0, start - offsets[firstIndex]);
      const lastOffset = Math.min(row[lastIndex].text.length, end - offsets[lastIndex]);
      const x = touched[0].box.x + touched[0].box.width * firstOffset / touched[0].text.length;
      const y = Math.min(...touched.map((piece) => piece.box.y));
      const right = row[lastIndex].box.x + row[lastIndex].box.width * lastOffset / row[lastIndex].text.length;
      const bottom = Math.max(...touched.map((piece) => piece.box.y + piece.box.height));
      const bibliography = referenceBlocks.some((block) => block.regions.some((region) => region.page === touched[0].page && y >= region.y - 0.003 && y <= region.y + region.height + 0.003));
      if (bibliography || right <= x) continue;
      markers.push({ id: hash(`${touched[0].page}:${x}:${y}:${match[0]}`), page: touched[0].page, bbox: { x, y, width: right - x, height: bottom - y }, text: match[0], references: refs });
    }
  }
  return markers;
}

export class PdfJsStructureDetector implements StructureDetector {
  async detect(bytes: Uint8Array, paperKey: string, existingBlocks?: Block[]): Promise<PaperStructure> {
    const blocks = existingBlocks ?? (await extractPdf(bytes, paperKey)).blocks;
    const references = parseReferences(blocks);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pieces: TextPiece[] = [];
    try {
      const pdf = await task.promise;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        await page.getOperatorList();
        const content = await page.getTextContent();
        const box = page.view;
        for (const item of content.items) {
          if (!('str' in item) || !('transform' in item) || !item.str) continue;
          try {
            const style = content.styles[item.fontName] ?? {};
            const region = textItemRegion(item, box, pageNumber, style);
            const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) as { name?: string } : null;
            pieces.push({ text: item.str, box: region, page: pageNumber, baseline: region.y + region.height / 2, font: font?.name ?? item.fontName });
          } catch {
            continue;
          }
        }
      }
    } finally {
      await task.destroy();
    }
    const items = itemsFromBlocks(blocks);
    items.push(...supplementalEquations(pieces, blocks, items));
    const markers = markersFromPieces(pieces, references, blocks.filter((block) => block.kind === 'reference'));
    return { version: STRUCTURE_VERSION, status: 'ready', items, references, markers };
  }
}
