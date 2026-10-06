import type { IncomingMessage } from 'node:http';
import { answerPlacementSchema } from '@fractal/shared';
import { z } from 'zod';
import type { SqlitePaperStore } from '../../store/sqlite';
import type { ChatService } from '../../chat/index';
import { cancelHistory } from '../../ai/history';
import { notFound } from '../../store/errors';
import { json, jsonBody, parseRequest, type Result } from './types';

const placementBodySchema = z.object({ placement: answerPlacementSchema });

export async function handleHistory(
  method: string,
  segments: string[],
  request: IncomingMessage,
  ctx: { store: SqlitePaperStore; chat?: ChatService },
): Promise<Result | undefined> {
  if (segments[0] !== 'api') return undefined;
  const paper = segments[1] === 'papers' && segments[3] === 'history';
  const library = segments[1] === 'library' && segments[2] === 'history';
  if (!paper && !library) return undefined;
  const base = paper ? 4 : 3;
  const key = paper ? decodeURIComponent(segments[2]!) : undefined;
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (segments.length === base && method === 'GET') {
    let entries = ctx.store.listHistory(key);
    const kind = url.searchParams.get('kind');
    const status = url.searchParams.get('status');
    if (kind) entries = entries.filter((entry) => entry.kind === kind);
    if (status) entries = entries.filter((entry) => entry.status === status);
    return json({ history: entries });
  }
  const id = decodeURIComponent(segments[base] ?? '');
  const entry = ctx.store.getHistory(id);
  if (!entry || entry.deleted || (paper && entry.paperKey !== key)) throw notFound('History not found');
  const activeConversation =
    entry.kind === 'conversation' &&
    entry.paperKey !== null &&
    ctx.store.getConversation(entry.paperKey)?.conversationId === entry.conversation?.conversationId;
  if (segments.length === base + 1 && method === 'GET') return json({ history: entry });
  if (paper && segments.length === base + 2 && segments[base + 1] === 'placement' && method === 'PUT') {
    const { placement } = parseRequest(placementBodySchema, await jsonBody(request));
    return json({ history: ctx.store.putHistory({ ...entry, placement }) });
  }
  if (segments.length === base + 2 && segments[base + 1] === 'cancel' && method === 'POST') {
    if (activeConversation && ctx.chat) {
      ctx.chat.cancel(entry.paperKey!);
      return json({ history: ctx.store.getHistory(id) });
    }
    return json({ history: cancelHistory(ctx.store, id) });
  }
  if (segments.length === base + 1 && method === 'DELETE') {
    if (activeConversation && ctx.chat) ctx.chat.clear(entry.paperKey!);
    else cancelHistory(ctx.store, id);
    return json({ history: ctx.store.deleteHistory(id) });
  }
  return undefined;
}
