import type { IncomingMessage } from 'node:http';
import QRCode from 'qrcode';
import { pairingClaimRequestSchema } from '@fractal/shared';
import { HttpError } from '../errors';
import { clearRemoteFailures, recordRemoteFailure } from '../guard';
import { body, json, type Result, type RouteContext } from './types';

const error = (status: number, message: string) => new HttpError(status, { code: status === 400 ? 'INVALID_INPUT' : 'AUTH_REQUIRED', message, retryable: false });
export async function handlePairing(method: string, segments: string[], request: IncomingMessage, ctx: RouteContext): Promise<Result | undefined> {
  if (segments[0] !== 'api' || segments[1] !== 'pairing' || ctx.pairing === undefined || ctx.devices === undefined) return undefined;
  if (segments.length === 3 && segments[2] === 'claim' && method === 'POST') {
    const parsed = pairingClaimRequestSchema.safeParse(await body(request));
    if (!parsed.success) throw error(400, 'Invalid pairing claim');
    const claimed = ctx.pairing.claim(parsed.data);
    if (claimed === null) {
      if (!ctx.local) recordRemoteFailure(request);
      throw error(401, 'Pairing code expired or invalid');
    }
    if (!ctx.local) clearRemoteFailures(request);
    return json(claimed);
  }
  if (!ctx.local) throw error(403, 'Loopback only');
  if (segments.length === 3 && segments[2] === 'start' && method === 'POST') return json(ctx.pairing.start(), 201);
  if (segments.length === 3 && segments[2] === 'devices' && method === 'GET') return json({ devices: ctx.devices.list() });
  if (segments.length === 4 && segments[2] === 'devices' && method === 'DELETE') return json({ revoked: ctx.devices.revoke(segments[3]!) });
  if (segments.length === 3 && segments[2] === 'qr.svg' && method === 'GET') {
    const payload = ctx.pairing.payload(ctx.url.searchParams.get('session') ?? '');
    if (payload === null) throw error(400, 'Pairing session expired or invalid');
    const svg = await QRCode.toString(JSON.stringify(payload), { type: 'svg', errorCorrectionLevel: 'M' });
    return { kind: 'bytes', status: 200, body: Buffer.from(svg), contentType: 'image/svg+xml' };
  }
  return undefined;
}
