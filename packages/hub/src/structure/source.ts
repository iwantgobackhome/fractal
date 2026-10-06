import { gunzipSync } from 'node:zlib';
import type { StructureItem } from '@fractal/shared';

export interface SourceFragment {
  kind: StructureItem['kind'];
  label?: string;
  caption?: string;
  latex?: string;
  number?: string;
  numberedRows?: number;
}
const MAX_ARCHIVE = 20 * 1024 * 1024;
const MAX_SOURCE = 80 * 1024 * 1024;

async function limitedBytes(response: Response): Promise<Buffer | null> {
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_ARCHIVE || !response.body) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ARCHIVE) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Reads regular .tex members only; paths are never written or executed. */
export function latexFiles(bytes: Uint8Array): string[] {
  if (Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') return [];
  let archive: Buffer;
  try {
    archive = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: MAX_SOURCE }) : Buffer.from(bytes);
  } catch {
    return [];
  }
  const files: string[] = [];
  if (archive.length < 512 || archive.toString('utf8', 257, 262) !== 'ustar') {
    return archive.length < MAX_SOURCE ? [archive.toString('utf8')] : [];
  }
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    if (!name) break;
    const size = Number.parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim(), 8);
    const type = header.toString('ascii', 156, 157);
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > archive.length) break;
    if ((type === '0' || type === '\0') && /\.tex$/i.test(name) && size <= 4 * 1024 * 1024) {
      files.push(archive.toString('utf8', offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function cleanCaption(value: string): string {
  return value
    .replace(/\\(?:textbf|emph|textit)\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?/g, '')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLatexSources(files: readonly string[]): SourceFragment[] {
  const fragments: SourceFragment[] = [];
  for (const file of files) {
    const source = file.replace(/(?<!\\)%[^\n]*/g, '');
    for (const match of source.matchAll(/\\begin\{(figure\*?|table\*?|equation\*?|align\*?)\}([\s\S]*?)\\end\{\1\}/g)) {
      const environment = match[1];
      const body = match[2];
      const label = /\\label\{([^}]+)\}/.exec(body)?.[1];
      const caption = /\\caption(?:\[[^\]]*\])?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(body)?.[1];
      const kind = environment.startsWith('figure') ? 'figure' : environment.startsWith('table') ? 'table' : 'equation';
      const numberedRows =
        kind !== 'equation' || environment.endsWith('*')
          ? 0
          : environment === 'align'
            ? body.split(/\\\\(?:\[[^\]]*\])?/g).filter((row) => row.trim() && !/\\(?:notag|nonumber)\b/.test(row)).length
            : /\\(?:notag|nonumber)\b/.test(body)
              ? 0
              : 1;
      fragments.push({
        kind,
        ...(label ? { label } : {}),
        ...(caption ? { caption: cleanCaption(caption) } : {}),
        ...(kind === 'equation' ? { latex: body.replace(/\\label\{[^}]+\}/g, '').trim(), numberedRows } : {}),
      });
    }
    for (const match of source.matchAll(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g)) {
      fragments.push({ kind: 'equation', latex: (match[1] ?? match[2]).trim() });
    }
  }
  const counts = { figure: 0, table: 0, equation: 0 };
  for (const fragment of fragments) {
    if (fragment.kind === 'equation') {
      if (!fragment.numberedRows) continue;
      const explicit = /\\tag\{(\d+)\}/.exec(fragment.latex ?? '')?.[1];
      fragment.number = explicit ?? String(counts.equation + 1);
      counts.equation += fragment.numberedRows;
      continue;
    }
    counts[fragment.kind] += 1;
    fragment.number = String(counts[fragment.kind]);
  }
  return fragments;
}

function captionSimilarity(a: string, b: string): number {
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const left = words(a);
  const right = words(b);
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

const greek: Record<string, string> = {
  θ: 'theta',
  α: 'alpha',
  β: 'beta',
  μ: 'mu',
  σ: 'sigma',
  ϵ: 'epsilon',
  ε: 'epsilon',
  π: 'pi',
  '∑': 'sum',
  '∏': 'prod',
  '√': 'sqrt',
};

/** Compare the visible symbol sequence while ignoring TeX presentation commands. */
export function mathSimilarity(pdfText: string, latex: string): number {
  const normalize = (value: string): string =>
    value
      .replace(/\\(?:left|right|bigl|bigr|Bigl|Bigr|quad|qquad)\b/g, '')
      .replace(/\\(?:mathrm|mathbf|mathit|mathsf|text|operatorname)\s*\{/g, '{')
      .replace(/\\(?:dfrac|tfrac|frac)\b/g, 'frac')
      .replace(/\\([A-Za-z]+)/g, (_match, command: string) => command.replace(/^b(?=x|mu|epsilon)/, ''))
      .replace(/[θαβμσϵεπ∑∏√]/g, (symbol) => greek[symbol] ?? symbol)
      .toLowerCase()
      .replace(/[^a-z0-9=+\-*/]/g, '');
  const left = normalize(pdfText);
  const right = normalize(latex);
  if (left.length < 3 || right.length < 3) return 0;
  const grams = (value: string) => {
    const counts = new Map<string, number>();
    for (let index = 0; index <= value.length - 3; index += 1) {
      const gram = value.slice(index, index + 3);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };
  const a = grams(left);
  const b = grams(right);
  let overlap = 0;
  for (const [gram, count] of a) overlap += Math.min(count, b.get(gram) ?? 0);
  return (2 * overlap) / Math.max(1, left.length + right.length - 4);
}

function equationMatches(items: readonly StructureItem[], fragments: readonly SourceFragment[]): Map<string, SourceFragment> {
  const candidates: Array<{ item: StructureItem; fragment: SourceFragment; score: number }> = [];
  for (const item of items) {
    if (item.kind !== 'equation') continue;
    const number = /^\((\d+)\)$/.exec(item.label)?.[1];
    for (const fragment of fragments) {
      if (fragment.kind !== 'equation' || !fragment.latex) continue;
      const similarity = mathSimilarity(item.caption, fragment.latex);
      if (similarity < 0.34) continue;
      const numbered = number && fragment.number === number;
      const conflicting = number && fragment.number && fragment.number !== number;
      const score = similarity + (numbered ? 0.24 : 0) - (conflicting ? 0.16 : 0);
      if (score >= 0.48) candidates.push({ item, fragment, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const matches = new Map<string, SourceFragment>();
  const used = new Set<SourceFragment>();
  for (const candidate of candidates) {
    if (matches.has(candidate.item.id) || used.has(candidate.fragment)) continue;
    matches.set(candidate.item.id, candidate.fragment);
    used.add(candidate.fragment);
  }
  return matches;
}

export function matchLatex(items: StructureItem[], fragments: readonly SourceFragment[]): StructureItem[] {
  const equations = equationMatches(items, fragments);
  const used = new Set<SourceFragment>();
  return items.map((item) => {
    if (item.kind === 'equation') {
      const fragment = equations.get(item.id);
      return fragment ? { ...item, latex: fragment.latex!, ...(fragment.label ? { sourceLabel: fragment.label } : {}) } : item;
    }
    const number = /\d+/.exec(item.label)?.[0];
    let best: SourceFragment | undefined;
    let bestScore = 0;
    for (const fragment of fragments) {
      if (fragment.kind !== item.kind || used.has(fragment)) continue;
      const score = (number && fragment.number === number ? 0.6 : 0) + captionSimilarity(item.caption, fragment.caption ?? '') * 0.5;
      if (score > bestScore) {
        best = fragment;
        bestScore = score;
      }
    }
    if (!best || bestScore < 0.2) return item;
    used.add(best);
    return {
      ...item,
      ...(best.caption && best.caption.length > item.caption.length ? { caption: best.caption } : {}),
      ...(best.latex ? { latex: best.latex } : {}),
      ...(best.label ? { sourceLabel: best.label } : {}),
    };
  });
}

export async function fetchArxivSource(id: string, fetcher: typeof fetch = fetch): Promise<SourceFragment[]> {
  if (!/^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?$/i.test(id)) return [];
  try {
    const response = await fetcher(`https://arxiv.org/e-print/${id}`, {
      signal: AbortSignal.timeout(12_000),
      headers: { 'user-agent': 'News-Papers/0.1 (paper structure extraction)' },
    });
    const bytes = await limitedBytes(response);
    return bytes ? parseLatexSources(latexFiles(bytes)) : [];
  } catch {
    return [];
  }
}
