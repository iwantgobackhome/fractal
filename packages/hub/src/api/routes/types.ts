import type { IncomingMessage } from 'node:http';
import type { DeviceStore } from '../../pairing/store';
import type { PairingSessions } from '../../pairing/session';
import type { NetworkManager } from '../../net/manager';
import { HttpError } from '../errors';

export type Result = { kind: 'json'; status: number; data: unknown } | { kind: 'bytes'; status: number; body: Buffer; contentType: string };
export interface RouteContext { devices?: DeviceStore; pairing?: PairingSessions; network?: NetworkManager; local: boolean; url: URL }
export function json(data: unknown, status = 200): Result { return { kind: 'json', status, data }; }
export async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > 64 * 1024) throw new HttpError(413, { code: 'TOO_LARGE', message: 'Body too large', retryable: false });
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new HttpError(400, { code: 'INVALID_INPUT', message: 'Expected JSON body', retryable: false }); }
}
