import type { IncomingMessage } from 'node:http';
import { ingestUrl } from '../../ingest/index';
import { invalidInput, notFound } from '../../store/errors';
import type { StructureService } from '../../structure/service';
import { json, type LibraryRouteContext, type Result } from './types';

export interface StructureRouteContext extends LibraryRouteContext {
  structure: StructureService;
}

export async function handleStructure(method: string, segments: string[], _request: IncomingMessage, ctx: StructureRouteContext): Promise<Result | undefined> {
  if (segments[0] !== 'api' || segments[1] !== 'papers' || segments.length < 4) return undefined;
  const key = segments[2];
  if (!key || !ctx.store.getPaper(key)) return undefined;
  const structure = ctx.structure;
  if (segments[3] === 'structure') {
    if (segments.length === 4 && method === 'GET') {
      const data = structure.read(key);
      if (data.status === 'pending') structure.schedule(key);
      const updated = structure.read(key);
      return json(updated, updated.status === 'ready' || updated.status === 'failed' ? 200 : 202);
    }
    if (segments.length === 5 && segments[4] === 'refresh' && method === 'POST') {
      structure.schedule(key, true);
      return json(structure.read(key), 202);
    }
  }
  if (segments[3] !== 'references' || segments.length < 5 || segments.length > 6) return undefined;
  const n = segments[4];
  if (!n || !/^(?:\d+[a-z]?|author-\d+)$/.test(n)) throw invalidInput('참고문헌 번호가 올바르지 않습니다.');
  const data = structure.read(key);
  if (data.status !== 'ready') {
    structure.schedule(key);
    return json(data, 202);
  }
  const entry = data.references.find((reference) => reference.n === n);
  if (!entry) throw notFound('참고문헌을 찾을 수 없습니다.');
  if (segments.length === 5 && method === 'GET') return json({ entry, enrichment: await structure.enrichment(entry) });
  if (segments.length === 6 && segments[5] === 'add' && method === 'POST') {
    const enrichment = await structure.enrichment(entry);
    const input = entry.doi ?? entry.arxivId ?? enrichment?.externalIds.DOI ?? enrichment?.externalIds.ArXiv ?? enrichment?.openAccessPdf;
    if (!input) throw invalidInput('추가할 수 있는 DOI, arXiv ID 또는 공개 PDF 주소가 없습니다.');
    return json({ paper: await ingestUrl(ctx.store, input, ctx.acquirer, ctx.fetcher) }, 201);
  }
  return undefined;
}
