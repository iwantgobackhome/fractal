import type { PublicationBookmark, PublicationPdfLinkResult } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { appError } from '../store/errors';
import { SourceError, normalizeArxiv as arxivIdentifier } from '../arxiv/index';
import { publicationCatalog, linkPdf } from '../scholarly/bookmarks';
import {
  crossrefPdfCandidates,
  identifiersConflict,
  normalizeArxiv,
  normalizeDoi,
  openAlexPdfCandidates,
  openAlexLandingCandidates,
  row,
} from '../scholarly/metadata';
import { loadPublication } from './index';
import { publicGet, validatePublicUrl, type PublicNetworkOptions } from './network';
import { ProviderFailure, ScholarlyClient } from '../scholarly/client';

/** Service-owned dependencies, never accepted from an HTTP request. */
export interface PublicationAcquisitionOptions extends PublicNetworkOptions {
  providerFetch?: typeof fetch;
  providerIntervalMs?: number;
}

const active = new WeakMap<SqlitePaperStore, Map<string, Promise<PublicationPdfLinkResult>>>();
export async function waitPublicationAcquisitions(store: SqlitePaperStore): Promise<void> {
  await Promise.allSettled(active.get(store)?.values() ?? []);
}
/** Explicit acquisition only: neither Saved nor Recent is changed here. */
export async function openPublication(
  store: SqlitePaperStore,
  input: PublicationBookmark,
  options: PublicationAcquisitionOptions = {},
): Promise<PublicationPdfLinkResult> {
  if (identifiersConflict(input, { doi: normalizeDoi(input.url), arxivId: normalizeArxiv(input.url) }))
    throw appError('INVALID_INPUT', 'Publication URL identifiers conflict with the supplied identifiers');
  input = { ...input, doi: input.doi ?? normalizeDoi(input.url), arxivId: input.arxivId ?? normalizeArxiv(input.url) };
  const catalog = publicationCatalog(store, input);
  const key = catalog.paperKey;
  const paper = store.getPaper(key);
  if (paper && store.getPdf(key)) return { ...catalog, paper, hasPdf: true };
  const jobs = active.get(store) ?? new Map();
  active.set(store, jobs);
  const pending = jobs.get(key);
  if (pending) return pending;
  const work = acquire(store, key, input, options).finally(() => jobs.delete(key));
  jobs.set(key, work);
  return work;
}

async function acquire(
  store: SqlitePaperStore,
  key: string,
  input: PublicationBookmark,
  options: PublicationAcquisitionOptions,
): Promise<PublicationPdfLinkResult> {
  // One total budget spans DNS, redirects, provider bodies and all candidates.
  const signal = AbortSignal.any([AbortSignal.timeout(Math.min(options.timeoutMs ?? 60_000, 60_000)), ...(options.signal ? [options.signal] : [])]);
  const network = { ...options, signal, maxBytes: Math.min(options.maxBytes ?? 50 * 1024 * 1024, 50 * 1024 * 1024) };
  const tried = new Set<string>();
  const errors: SourceError[] = [];
  const record = store.getLibrary(key)!;
  const expected = { doi: record.doi, arxivId: record.arxivId };
  const attempt = async (candidate: string | null | undefined): Promise<PublicationPdfLinkResult | undefined> => {
    if (!candidate || tried.size >= 6) return;
    let url: string;
    try {
      url = validatePublicUrl(candidate).href;
    } catch (error) {
      errors.push(error as SourceError);
      return;
    }
    if (tried.has(url)) return;
    tried.add(url);
    try {
      const loaded = await loadPublication(url, network, expected);
      // Once real PDF bytes exist, integrity/link failures are terminal. Do not
      // hide a conflicting DOI or changed revision by trying another URL.
      return await linkPdf(store, key, loaded.pdf);
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      if (error.reason === 'IDENTIFIER_CONFLICT') throw error;
      errors.push(error);
      if (signal.aborted) throw new SourceError('NETWORK', 'Publication acquisition exceeded its total time budget', true);
    }
  };
  let result = await attempt(input.publication?.oaPdfUrl ?? record.publication?.oaPdfUrl);
  if (result) return result;
  const arxiv = /^https:\/\/(?:www\.)?arxiv\.org\//i.test(input.url) ? input.url : (input.arxivId ?? record.arxivId);
  if (arxiv) {
    const id = arxivIdentifier(arxiv);
    result = await attempt(`https://arxiv.org/pdf/${id.paperKey}`);
    if (result) return result;
  }
  const doi = normalizeDoi(record.doi) ?? normalizeDoi(input.url);
  const client = new ScholarlyClient(options.providerFetch ?? fetch, {
    timeoutMs: Math.min(options.timeoutMs ?? 8000, 8000),
    intervalMs: options.providerIntervalMs,
  });
  const provider = async (url: string): Promise<Record<string, unknown> | undefined> => {
    try {
      const hostname = new URL(url).hostname;
      if (hostname === 'api.crossref.org' || hostname === 'api.openalex.org')
        return await client.json(hostname === 'api.crossref.org' ? 'crossref' : 'openAlex', url, signal);
      const response = await publicGet(url, { ...network, timeoutMs: Math.min(options.timeoutMs ?? 8000, 8000), maxBytes: 2 * 1024 * 1024 });
      try {
        return row(JSON.parse(response.bytes.toString('utf8')));
      } catch {
        throw new SourceError('NETWORK', 'Publication provider returned invalid metadata', true);
      }
    } catch (error) {
      if (error instanceof ProviderFailure) {
        const code = ['rate_limited', 'budget_exhausted'].includes(error.status.state)
          ? 'QUOTA'
          : error.status.state === 'auth_required'
            ? 'AUTH_REQUIRED'
            : error.status.state === 'not_found'
              ? 'NOT_FOUND'
              : 'NETWORK';
        errors.push(new SourceError(code, error.status.message ?? 'Publication provider unavailable', ['NETWORK', 'QUOTA'].includes(code)));
        if (signal.aborted) throw new SourceError('NETWORK', 'Publication acquisition exceeded its total time budget', true);
        return;
      }
      if (!(error instanceof SourceError)) throw error;
      errors.push(error);
      if (signal.aborted) throw new SourceError('NETWORK', 'Publication acquisition exceeded its total time budget', true);
    }
  };
  if (doi) {
    const crossref = row((await provider(`https://api.crossref.org/works/${encodeURIComponent(doi)}`))?.message);
    if (identifiersConflict(expected, { doi: typeof crossref.DOI === 'string' ? crossref.DOI : null }))
      throw appError('INVALID_INPUT', 'Crossref identifiers conflict with the requested publication');
    for (const url of crossrefPdfCandidates(crossref)) {
      result = await attempt(url);
      if (result) return result;
    }
    const oa = await provider(`https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${doi}`)}`);
    if (oa && identifiersConflict(expected, { doi: typeof oa.doi === 'string' ? oa.doi : null }))
      throw appError('INVALID_INPUT', 'OpenAlex identifiers conflict with the requested publication');
    for (const url of openAlexPdfCandidates(oa ?? {})) {
      result = await attempt(url);
      if (result) return result;
    }
    const email = process.env.FRACTAL_CONTACT_EMAIL?.trim();
    if (email && /^[^\s@]+@[^\s@]+$/.test(email)) {
      const unpaywall = await provider(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`);
      const locations = [unpaywall?.best_oa_location, ...(Array.isArray(unpaywall?.oa_locations) ? unpaywall.oa_locations.slice(0, 100) : [])];
      for (const location of locations) {
        result = await attempt(typeof row(location).url_for_pdf === 'string' ? String(row(location).url_for_pdf) : null);
        if (result) return result;
      }
    }
    // Provider links are evidence; the DOI resolver itself is also a grounded
    // landing page when providers have no usable direct PDF.
    result = await attempt(input.url);
    if (result) return result;
    for (const url of openAlexLandingCandidates(oa ?? {})) {
      result = await attempt(url);
      if (result) return result;
    }
    result = await attempt(typeof crossref.URL === 'string' ? crossref.URL : null);
    if (result) return result;
    result = await attempt(`https://doi.org/${doi}`);
    if (result) return result;
  } else {
    result = await attempt(input.url);
    if (result) return result;
  }
  // Retain actionable failure distinctions instead of converting everything to
  // "no PDF". Optional provider failures remain retryable when no source works.
  throw (
    errors.find((e) => e.code === 'TOO_LARGE') ??
    errors.find((e) => e.code === 'QUOTA') ??
    errors.find((e) => e.code === 'AUTH_REQUIRED') ??
    errors.find((e) => e.retryable) ??
    errors.at(-1) ??
    new SourceError('NOT_FOUND', 'No unambiguous publicly downloadable main PDF was found')
  );
}
