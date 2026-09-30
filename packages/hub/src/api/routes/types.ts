import type { IncomingMessage } from 'node:http';
import type { ZodType } from 'zod';
import type { AiSseEvent } from '@fractal/shared';
import type { PaperAcquirer } from '../index';
import type { DeviceStore } from '../../pairing/store';
import type { PairingSessions } from '../../pairing/session';
import type { NetworkManager } from '../../net/manager';
import type { PaperStore } from '../../store/index';
import type { SqlitePaperStore } from '../../store/sqlite';
import type { ProviderRegistry } from '../../ai/registry';
import type { AccountManager } from '../../ai/accounts';
import type { ProviderInstallManager } from '../../ai/install';
import type { LibrarySearch } from '../../ai/library-search';
import { HttpError } from '../errors';
import { invalidInput } from '../../store/errors';

export type Result =
  | { kind: 'json'; status: number; data: unknown }
  | { kind: 'bytes'; status: number; body: Buffer; contentType: string; headers?: Record<string, string> }
  | { kind: 'sse'; status: 200; events: AsyncIterable<AiSseEvent> };

/** Per-request facts every route handler may use: who is asking and the parsed URL. */
export interface RouteContext {
  devices?: DeviceStore;
  pairing?: PairingSessions;
  network?: NetworkManager;
  local: boolean;
  url: URL;
}
/** Services the AI routes need. */
export interface AiRouteContext {
  store: PaperStore;
  registry: ProviderRegistry;
  librarySearch: LibrarySearch;
  accounts?: AccountManager;
  installer?: ProviderInstallManager;
}
/** Services the library, annotation and sync routes need. */
export interface LibraryRouteContext {
  store: SqlitePaperStore;
  acquirer: PaperAcquirer;
  fetcher?: typeof fetch;
}

export const json = (data: unknown, status = 200): Result => ({ kind: 'json', status, data });

export function tooLarge(message = '요청 본문이 너무 큽니다.'): HttpError {
  return new HttpError(413, { code: 'TOO_LARGE', message, retryable: false });
}

export function parseRequest<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidInput('요청 형식이 올바르지 않습니다.');
  return parsed.data;
}

/** The raw request body, refused past `max` bytes. */
export async function body(request: IncomingMessage, max = 64 * 1024, sizeMessage?: string): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) throw tooLarge(sizeMessage);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > max) throw tooLarge(sizeMessage);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** Any JSON value from the body (up to 64 KiB). */
export async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await body(request);
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw invalidInput('JSON 요청 형식이 올바르지 않습니다.');
  }
}

/** A JSON object from the body (up to 64 KiB). */
export async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parsed = await readJson(request);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidInput('JSON 객체를 보내 주세요.');
  return parsed as Record<string, unknown>;
}
