import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { assertLocalRequest, assertRemoteRequest } from './guard';
import type { DeviceStore } from '../pairing/store';

const token = 'a'.repeat(64);
const devices: DeviceStore = { hubId: 'hub', list: () => [], claim: () => { throw new Error('unused'); }, revoke: () => false,
  authenticate: (value) => value === token ? { id: 'id', name: 'Phone', platform: 'Android', createdAt: '', lastSeen: null } : null };
function request(ip: string, headers: Record<string, string>): IncomingMessage {
  return { socket: { remoteAddress: ip }, headers } as IncomingMessage;
}
describe('request guards', () => {
  it('preserves local startup-token and origin checks', () => {
    expect(() => assertLocalRequest(request('127.0.0.1', { host: '127.0.0.1:7327', origin: 'http://127.0.0.1:7327', 'x-paperread-token': token }), token, true)).not.toThrow();
    expect(() => assertLocalRequest(request('127.0.0.1', { host: '127.0.0.1:7327', origin: 'http://evil.test', 'x-paperread-token': token }), token, true)).toThrow();
    expect(() => assertLocalRequest(request('192.168.1.2', { host: '127.0.0.1:7327', origin: 'http://127.0.0.1:7327', 'x-paperread-token': token }), token, true)).toThrow();
  });
  it('requires bearer on remote reads and rate limits failures', () => {
    const ip = '192.168.1.244';
    expect(() => assertRemoteRequest(request(ip, {}), devices)).toThrow();
    expect(() => assertRemoteRequest(request(ip, { authorization: `Bearer ${token}` }), devices)).not.toThrow();
    for (let n = 0; n < 10; n++) expect(() => assertRemoteRequest(request(ip, {}), devices)).toThrow();
    expect(() => assertRemoteRequest(request(ip, { authorization: `Bearer ${token}` }), devices)).toThrow(/Too many/);
  });
});
