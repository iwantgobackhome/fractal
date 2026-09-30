import { createHash } from 'node:crypto';
import {
  publicationBookmarkSchema,
  type PublicationBookmark,
  type PublicationBookmarkResult,
  type PublicationPdfLinkResult,
  type Paper,
} from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { atomic } from '../store/foundation';
import { assertSafeKey } from '../store/validate';
import { appError, busy, invalidInput, notFound } from '../store/errors';
import { extractPdf } from '../pdf/index';
import { ownPdfIdentifiers } from './pdf-identifiers';
import { identityMatches, identifiersConflict, normalizeDoi, normalizeArxiv, normalizedTitle, publicationIdentity, safePublicUrl } from './metadata';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function bookmark(store: SqlitePaperStore, input: PublicationBookmark): PublicationBookmarkResult {
  const value = publicationBookmarkSchema.parse(input);
  if (!safePublicUrl(value.url)) throw invalidInput('Use a public HTTPS publication URL');
  const doi = normalizeDoi(value.doi),
    arxivId = normalizeArxiv(value.arxivId);
  if ((value.doi && !doi) || (value.arxivId && !arxivId)) throw invalidInput('Invalid publication identifier');
  const identity =
    doi || arxivId
      ? publicationIdentity({ ...value, doi, arxivId })
      : JSON.stringify([publicationIdentity(value), value.publication?.year ?? null, value.authors.map(normalizedTitle).sort()]);
  const key = `pub-${sha(identity)}`;
  const exact = store.getLibrary(key);
  if (exact && identifiersConflict(value, exact)) throw invalidInput('Saved publication identifiers have changed; review the catalog record');
  const candidates = store
    .listLibrary()
    .filter((r) =>
      identityMatches(
        { ...value, doi, arxivId, year: value.publication?.year },
        { ...r, authors: r.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')) },
      ),
    );
  const existing = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (existing) {
    const record = existing.saved ? existing : store.patchLibrary(existing.paperKey, { saved: true });
    return { paperKey: record.paperKey, record, hasPdf: !!store.getPdf(record.paperKey) };
  }
  const now = new Date().toISOString();
  const record = store.publishMetadata({
    id: key,
    paperKey: key,
    title: value.title,
    authors: value.authors
      .filter((s) => s.trim())
      .map((name) => {
        const parts = name.trim().split(/\s+/);
        return { given: parts.slice(0, -1).join(' '), family: parts.at(-1)! };
      }),
    doi,
    arxivId,
    url: value.url,
    abstract: value.abstract ?? null,
    year: value.publication?.year ?? null,
    venue: value.publication?.venue ?? null,
    publication: value.publication,
    tags: [],
    collections: [],
    addedAt: now,
    updatedAt: now,
    status: 'unread',
    bibtexKey: `publication${sha(key).slice(0, 12)}`,
    saved: true,
  });
  return { paperKey: key, record, hasPdf: false };
}
const active = new WeakMap<SqlitePaperStore, Map<string, { hash: string; work: Promise<PublicationPdfLinkResult> }>>();
export async function linkPdf(store: SqlitePaperStore, key: string, bytes: Buffer): Promise<PublicationPdfLinkResult> {
  assertSafeKey(key);
  if (!store.getLibrary(key)) throw notFound('Save the publication metadata before linking a PDF');
  if (bytes.length > 50 * 1024 * 1024 || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw invalidInput('Upload a valid PDF of at most 50 MiB');
  const hash = sha(bytes),
    jobs = active.get(store) ?? new Map();
  active.set(store, jobs);
  const pending = jobs.get(key);
  if (pending) {
    if (pending.hash !== hash) throw busy('A different PDF is already being linked');
    return pending.work;
  }
  const work = linkOnce(store, key, bytes, hash).finally(() => jobs.delete(key));
  jobs.set(key, { hash, work });
  return work;
}
async function linkOnce(store: SqlitePaperStore, key: string, bytes: Buffer, hash: string): Promise<PublicationPdfLinkResult> {
  const existing = store.getPaper(key);
  if (existing) {
    if (existing.pdfSha256 !== hash) throw appError('SOURCE_CHANGED', 'This publication already has a different PDF');
    if (!store.getPdf(key)) store.savePdf(key, bytes);
    return { paperKey: key, paper: existing, record: store.getLibrary(key)!, hasPdf: !!store.getPdf(key) };
  }
  // Reserved reader keys keep their original identity rules. Legacy safe catalog keys
  // are accepted only through this route and persisted with explicit provenance.
  if (key.startsWith('pdf-') || /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*[._-]\d{7})(?:v\d+)?$/.test(key))
    throw invalidInput('Reserved reader identity cannot be converted into a catalog publication');
  const found = await ownPdfIdentifiers(bytes);
  const extracted = await extractPdf(bytes, key);
  return atomic(store, () => {
    const record = store.getLibrary(key);
    if (!record || store.getPaper(key)) throw busy('Publication changed while linking; retry');
    if (
      (found.doi && record.doi && normalizeDoi(found.doi) !== normalizeDoi(record.doi)) ||
      (found.arxivId && record.arxivId && normalizeArxiv(found.arxivId) !== normalizeArxiv(record.arxivId))
    )
      throw invalidInput('PDF identifiers conflict with the saved publication');
    const paper: Paper = {
      paperKey: key,
      sourceKind: 'publication',
      catalogKey: key,
      arxivId: null,
      version: null,
      title: record.title,
      authors: record.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')),
      sourceUrl: safePublicUrl(record.url) ?? `https://local.fractal.invalid/upload/${hash}`,
      pdfSha256: hash,
      pageCount: extracted.coverage.totalPages,
      extractionVersion: extracted.extractionVersion,
      coverage: extracted.coverage,
      status: !extracted.coverage.textPages ? 'unsupported' : extracted.coverage.unsupportedPages.length ? 'partial' : 'ready',
      createdAt: new Date().toISOString(),
    };
    store.savePaper(paper, bytes);
    store.saveBlocks(key, extracted.blocks);
    // savePaper's normal bibliography refresh must not change catalog/user metadata.
    const current = store.getLibrary(key)!;
    store.db
      .prepare('UPDATE bibliography SET data=? WHERE paper_key=?')
      .run(JSON.stringify({ ...record, rev: current.rev, updatedAt: current.updatedAt }), key);
    return { paperKey: key, paper, record: store.getLibrary(key)!, hasPdf: true };
  });
}
