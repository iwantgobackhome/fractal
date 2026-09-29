import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PairingPayload, PairingClaimRequest, PairingClaimResponse } from '@fractal/shared';
import type { DeviceStore } from './store';

interface Session { id: string; code: string; expiresAt: number; payload: PairingPayload }

export class PairingSessions {
  private current: Session | null = null;
  constructor(private readonly devices: DeviceStore, private readonly name: string, private readonly urls: () => string[], private readonly now = Date.now) {}
  start(): { session: string; expiresAt: string; payload: PairingPayload } {
    const code = randomBytes(12).toString('hex');
    const expiresAt = this.now() + 5 * 60_000;
    const payload: PairingPayload = { v: 1, name: this.name, hubId: this.devices.hubId, urls: this.urls(), code };
    const id = randomUUID();
    this.current = { id, code, expiresAt, payload };
    return { session: id, expiresAt: new Date(expiresAt).toISOString(), payload };
  }
  payload(id: string): PairingPayload | null {
    return this.current?.id === id && this.current.expiresAt > this.now() ? this.current.payload : null;
  }
  claim(request: PairingClaimRequest): PairingClaimResponse | null {
    const session = this.current;
    if (session === null || session.expiresAt <= this.now()) return null;
    const supplied = Buffer.from(request.code);
    const expected = Buffer.from(session.code);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    this.current = null;
    return this.devices.claim(request.name, request.platform);
  }
}
