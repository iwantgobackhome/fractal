import type { IncomingMessage } from 'node:http';
import { syncPushSchema } from '@fractal/shared';
import { json, jsonBody, parseRequest, type Result, type LibraryRouteContext as RouteContext } from './types';
import { invalidInput } from '../../store/errors';
import { pushMetadata } from '../../store/metadata-sync';
export async function handleSync(method: string, s: string[], request: IncomingMessage, ctx: RouteContext): Promise<Result | undefined> {
  if (s[0] !== 'api' || s[1] !== 'sync') return undefined;
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
