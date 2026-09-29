import type { IncomingMessage } from 'node:http';
import { networkSettingsSchema } from '@fractal/shared';
import { HttpError } from '../errors';
import { json, readJson, type Result, type RouteContext } from './types';

export async function handleHub(method: string, segments: string[], request: IncomingMessage, ctx: RouteContext): Promise<Result | undefined> {
  if (segments[0] !== 'api' || segments[1] !== 'hub') return undefined;
  if (segments.length === 3 && segments[2] === 'ping' && method === 'GET') return json({ ok: true });
  if (segments.length !== 3 || segments[2] !== 'network' || ctx.network === undefined) return undefined;
  if (!ctx.local) throw new HttpError(403, { code: 'AUTH_REQUIRED', message: 'Loopback only', retryable: false });
  if (method === 'GET') return json(await ctx.network.status());
  if (method === 'PUT') {
    const parsed = networkSettingsSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new HttpError(400, { code: 'INVALID_INPUT', message: 'Invalid network settings', retryable: false });
    return json(await ctx.network.update(parsed.data));
  }
  return undefined;
}
