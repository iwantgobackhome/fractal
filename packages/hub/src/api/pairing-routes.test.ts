import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { startService, type Service } from '../main';

const directory = mkdtempSync(join(tmpdir(), 'fractal-routes-'));
let service: Service | undefined;
afterAll(async () => {
  await service?.stop();
  rmSync(directory, { recursive: true, force: true });
});

describe('pairing routes', () => {
  it('starts, renders, claims once, and revokes through the local API', async () => {
    service = await startService({ dataDirectory: directory, port: 17327, log: () => {}, allowRealCli: false, startBackground: false });
    const url = service.url;
    const headers = { origin: url, 'x-paperread-token': service.token, 'content-type': 'application/json' };
    const network = await fetch(`${url}/api/hub/network`);
    expect(network.status).toBe(200);
    expect(((await network.json()) as { data: { settings: { lan: boolean } } }).data.settings.lan).toBe(false);
    const started = await fetch(`${url}/api/pairing/start`, { method: 'POST', headers, body: '{}' });
    expect(started.status).toBe(201);
    const start = ((await started.json()) as { data: { session: string; payload: { code: string } } }).data;
    const qr = await fetch(`${url}/api/pairing/qr.svg?session=${start.session}`);
    expect(qr.headers.get('content-type')).toContain('image/svg+xml');
    expect(await qr.text()).toContain('<svg');
    const claimBody = JSON.stringify({ code: start.payload.code, name: 'Phone', platform: 'Android' });
    const claimed = await fetch(`${url}/api/pairing/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: claimBody });
    expect(claimed.status).toBe(200);
    const device = ((await claimed.json()) as { data: { device: { id: string }; deviceToken: string } }).data;
    expect(device.deviceToken).toMatch(/^[0-9a-f]{64}$/);
    expect((await fetch(`${url}/api/papers`, { headers: { host: 'phone.example', authorization: `Bearer ${device.deviceToken}` } })).status).toBe(200);
    const proxiedStatus = await new Promise<number>((resolve, reject) => {
      get(`${url}/api/papers`, { headers: { host: 'phone.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }).on('error', reject);
    });
    expect(proxiedStatus).toBe(401);
    expect((await fetch(`${url}/api/pairing/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: claimBody })).status).toBe(401);
    expect((await fetch(`${url}/api/papers`, {
      headers: { host: 'phone.example', authorization: `Bearer ${device.deviceToken}` },
    })).status).toBe(200);
    const remoteHeaders = { authorization: `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json' };
    for (let n = 0; n < 10; n++) {
      expect((await fetch(`${url}/api/papers`, { headers: remoteHeaders })).status).toBe(401);
    }
    expect((await fetch(`${url}/api/papers`, { headers: remoteHeaders })).status).toBe(429);
    const restarted = await fetch(`${url}/api/pairing/start`, { method: 'POST', headers, body: '{}' });
    const fresh = ((await restarted.json()) as { data: { payload: { code: string } } }).data;
    expect((await fetch(`${url}/api/pairing/claim`, {
      method: 'POST', headers: remoteHeaders,
      body: JSON.stringify({ code: fresh.payload.code, name: 'Recovered phone', platform: 'Android' }),
    })).status).toBe(200);
    for (let n = 0; n < 10; n++) {
      expect((await fetch(`${url}/api/pairing/claim`, {
        method: 'POST', headers: remoteHeaders, body: claimBody,
      })).status).toBe(401);
    }
    expect((await fetch(`${url}/api/pairing/claim`, {
      method: 'POST', headers: remoteHeaders, body: claimBody,
    })).status).toBe(429);
    const revoked = await fetch(`${url}/api/pairing/devices/${device.device.id}`, { method: 'DELETE', headers });
    expect(((await revoked.json()) as { data: { revoked: boolean } }).data.revoked).toBe(true);
  });
});
