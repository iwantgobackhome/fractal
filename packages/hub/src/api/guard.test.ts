import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { assertLocalRequest, assertRemoteRequest, assertRemoteFailureLimit, recordRemoteFailure } from './guard';
import type { DeviceStore } from '../pairing/store';

const token = 'a'.repeat(64);
const devices: DeviceStore = {
  hubId: 'hub',
  list: () => [],
  claim: () => {
    throw new Error('unused');
  },
  revoke: () => false,
  authenticate: (value) => (value === token ? { id: 'id', name: 'Phone', platform: 'Android', createdAt: '', lastSeen: null } : null),
};
function request(ip: string, headers: Record<string, string>): IncomingMessage {
  return { socket: { remoteAddress: ip }, headers } as IncomingMessage;
}
describe('request guards', () => {
  it('admits claims during token lockout and expires a fixed failure window', () => {
    const req = request('192.168.1.245', {});
    for (let n = 0; n < 10; n++) recordRemoteFailure(req, 1000 + n * 1000);
    expect(() => assertRemoteFailureLimit(req, 11000)).toThrow(/Too many/);
    expect(() => assertRemoteRequest(req, devices, true, 11000)).not.toThrow();
    recordRemoteFailure(req, 60000);
    expect(() => assertRemoteFailureLimit(req, 61000)).not.toThrow();
    recordRemoteFailure(req, 61000);
    expect(() => assertRemoteFailureLimit(req, 61001)).not.toThrow();
  });
  it('gives bad pairing codes their own fixed-window limiter', () => {
    const req = request('192.168.1.246', { authorization: `Bearer ${token}` });
    for (let n = 0; n < 10; n++) recordRemoteFailure(req, 1000 + n * 1000, true);
    expect(() => assertRemoteFailureLimit(req, 11000, true)).toThrow(/Too many/);
    expect(() => assertRemoteFailureLimit(req, 61000, true)).not.toThrow();
  });
  it('preserves local startup-token and origin checks', () => {
    expect(() =>
      assertLocalRequest(request('127.0.0.1', { host: '127.0.0.1:7327', origin: 'http://127.0.0.1:7327', 'x-paperread-token': token }), token, true),
    ).not.toThrow();
    expect(() =>
      assertLocalRequest(request('127.0.0.1', { host: '127.0.0.1:7327', origin: 'http://evil.test', 'x-paperread-token': token }), token, true),
    ).toThrow();
    expect(() =>
      assertLocalRequest(request('192.168.1.2', { host: '127.0.0.1:7327', origin: 'http://127.0.0.1:7327', 'x-paperread-token': token }), token, true),
    ).toThrow();
  });
  it('requires bearer on remote reads and rate limits failures', () => {
    const ip = '192.168.1.244';
    expect(() => assertRemoteRequest(request(ip, {}), devices)).toThrow();
    expect(() => assertRemoteRequest(request(ip, { authorization: `Bearer ${token}` }), devices)).not.toThrow();
    for (let n = 0; n < 10; n++) expect(() => assertRemoteRequest(request(ip, {}), devices)).toThrow();
    expect(() => assertRemoteRequest(request(ip, { authorization: `Bearer ${token}` }), devices)).toThrow(/Too many/);
  });
});
