import { createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SqlitePaperStore } from '../../store/sqlite';
import { appError } from '../../store/errors';
import type { Result } from './types';

const hashes = new Map<string, Promise<string>>();
/** Validate cached identity without allocating a whole book for each PDF.js range request. */
export async function largePdfResult(store: SqlitePaperStore, key: string, request: IncomingMessage): Promise<Result | undefined> {
  const path = store.getPdfPath(key);
  if (!path) return undefined;
  const stat = statSync(path);
  if (stat.size <= 10 * 1024 * 1024) return undefined;
  const identity = `${path}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
  let digest = hashes.get(identity);
  if (!digest) {
    digest = (async () => {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return hash.digest('hex');
    })();
    hashes.set(identity, digest);
    if (hashes.size > 64) hashes.delete(hashes.keys().next().value!);
    digest.catch(() => hashes.delete(identity));
  }
  const sha = await digest;
  const paper = store.getPaper(key);
  if (paper && paper.pdfSha256 !== sha)
    throw appError('SOURCE_CHANGED', 'Stored PDF bytes no longer match this publication. The cached file was not replaced.');
  const etag = `"${sha}"`;
  const headers: Record<string, string> = { etag, 'accept-ranges': 'bytes' };
  if (request.headers['if-none-match'] === etag) return { kind: 'bytes', status: 304, body: Buffer.alloc(0), contentType: 'application/pdf', headers };
  const range = request.headers['if-range'] === undefined || request.headers['if-range'] === etag ? request.headers.range : undefined;
  let from = 0,
    to = stat.size - 1;
  if (typeof range === 'string') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = (): Result => ({
      kind: 'bytes',
      status: 416,
      body: Buffer.alloc(0),
      contentType: 'application/pdf',
      headers: { ...headers, 'content-range': `bytes */${stat.size}` },
    });
    if (!match || (!match[1] && !match[2])) return invalid();
    if (match[1]) from = Number(match[1]);
    if (match[2]) to = Number(match[2]);
    if (!match[1] && match[2]) {
      from = Math.max(0, stat.size - Number(match[2]));
      to = stat.size - 1;
    }
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to || to >= stat.size) return invalid();
    headers['content-range'] = `bytes ${from}-${to}/${stat.size}`;
  }
  return { kind: 'file', status: range ? 206 : 200, path, from, to, contentType: 'application/pdf', headers };
}
