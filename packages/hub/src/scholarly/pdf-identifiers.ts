import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeArxiv, normalizeDoi } from './metadata';

/** Conservative conflict evidence for explicit catalog linking. Incidental/cited
 * identifiers in visible page text are never authoritative own-paper identifiers.
 * Old general ingestion's text inspection remains unchanged. */
export async function ownPdfIdentifiers(bytes: Buffer): Promise<{ doi: string | null; arxivId: string | null }> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const doc = await task.promise,
      { info, metadata } = await doc.getMetadata();
    const fields = info as Record<string, unknown>,
      custom = fields.Custom as Record<string, unknown> | undefined;
    const values: unknown[] = [fields.Subject, metadata?.get('prism:doi'), metadata?.get('pdfx:doi'), metadata?.get('dc:identifier')];
    for (const [key, value] of Object.entries(custom ?? {})) if (/^(?:doi|arxiv|identifier)$/i.test(key)) values.push(value);
    const strings = values.flatMap((v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])).filter((v): v is string => typeof v === 'string');
    const dois = [...new Set(strings.map(normalizeDoi).filter((v): v is string => !!v))];
    const arxiv = [...new Set(strings.map((v) => normalizeArxiv(v.replace(/^arxiv:\s*/i, ''))).filter((v): v is string => !!v))];
    // Contradictory metadata cannot establish a reliable identity.
    return { doi: dois.length === 1 ? dois[0] : null, arxivId: arxiv.length === 1 ? arxiv[0] : null };
  } finally {
    await task.destroy();
  }
}
