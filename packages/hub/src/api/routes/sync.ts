import type { IncomingMessage } from 'node:http';
import { syncPushSchema } from '@fractal/shared';
import { json, jsonBody, parseRequest, type Result, type LibraryRouteContext as RouteContext } from './types';
import { invalidInput } from '../../store/errors';
import { assertSafeKey } from '../../store/validate';
import { HttpError } from '../errors';
import { pushMetadata } from '../../store/metadata-sync';
const subscribers = new WeakMap<object, Map<string, number>>();

export async function handleSync(method: string, s: string[], request: IncomingMessage, ctx: RouteContext): Promise<Result | undefined> {
  if (s[0] !== 'api' || s[1] !== 'sync') return undefined;
  if (method === 'GET' && s[2] === 'events') {
    const paperKey = new URL(request.url ?? '/', 'http://localhost').searchParams.get('paperKey') ?? '';
    assertSafeKey(paperKey);
    const identity = request.headers.authorization?.replace(/^Bearer\s+/i, '').toLowerCase() ?? 'local';
    let counts = subscribers.get(ctx.store);
    if (!counts) {
      counts = new Map();
      subscribers.set(ctx.store, counts);
    }
    if ((counts.get(identity) ?? 0) >= 4) throw new HttpError(429, { code: 'QUOTA', message: 'Too many sync streams', retryable: true });
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
    return {
      kind: 'sync-sse',
      status: 200,
      start(response) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        response.write(': connected\n\n');
        const head = ctx.store.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM changes');
        const currentHead = () => Number((head.get() as { n: number }).n);
        let cursor = currentHead();
        let closed = false;
        const timer = setInterval(() => {
          if (response.writableLength > 64 * 1024) {
            response.end();
            return;
          }
          if (currentHead() === cursor) return;
          const delta = ctx.store.pull(cursor);
          cursor = Number(delta.cursor);
          const kinds = new Set<string>();
          for (const annotation of delta.annotations) if (annotation.paperKey === paperKey) kinds.add(annotation.kind);
          for (const entry of delta.history ?? []) if (entry.paperKey === paperKey) kinds.add('history');
          for (const paper of delta.papers) if (paper.paperKey === paperKey) kinds.add('paper');
          if (kinds.size) response.write(`event: change\ndata: ${JSON.stringify({ paperKey, cursor: delta.cursor, kinds: [...kinds] })}\n\n`);
        }, 100);
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 25_000);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          clearInterval(heartbeat);
          const remaining = (counts!.get(identity) ?? 1) - 1;
          if (remaining > 0) counts!.set(identity, remaining);
          else counts!.delete(identity);
        };
        response.once('close', cleanup);
        response.once('error', cleanup);
      },
    };
  }
  if (method === 'GET' && s[2] === 'pull') {
    const since = Number(new URL(request.url ?? '/', 'http://localhost').searchParams.get('since') ?? 0);
    if (!Number.isSafeInteger(since) || since < 0) throw invalidInput('동기화 커서가 올바르지 않습니다.');
    return json(ctx.store.pull(since));
  }
  if (method === 'POST' && s[2] === 'push') {
    const input = parseRequest(syncPushSchema, await jsonBody(request));
    const results = input.annotations.map((a) => ctx.store.upsertAnnotation(a));
    const metadataResults = pushMetadata(ctx.store, input);
    const cursor = ctx.store.pull(Number.MAX_SAFE_INTEGER).cursor;
    return json({ results, metadataResults, cursor, serverHead: cursor });
  }
  return undefined;
}
