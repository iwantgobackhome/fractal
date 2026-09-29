import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonDeviceStore } from './store';
import { PairingSessions } from './session';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'fractal-pairing-'));
  directories.push(directory);
  return { directory, devices: new JsonDeviceStore(directory) };
}

describe('pairing', () => {
  it('uses a five minute, one-time code and stores only a token hash', () => {
    const { directory, devices } = setup();
    let now = 1_000_000;
    const sessions = new PairingSessions(devices, 'Hub', () => ['http://192.168.1.2:7327'], () => now);
    const started = sessions.start();
    expect(started.payload.urls).toEqual(['http://192.168.1.2:7327']);
    expect(sessions.payload(started.session)).toEqual(started.payload);
    const claim = sessions.claim({ code: started.payload.code, name: 'Phone', platform: 'Android' });
    expect(claim?.deviceToken).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions.claim({ code: started.payload.code, name: 'Other', platform: 'Android' })).toBeNull();
    expect(readFileSync(join(directory, 'paired-devices.json'), 'utf8')).not.toContain(claim!.deviceToken);
    expect(devices.authenticate(claim!.deviceToken)).toMatchObject({ id: claim!.device.id, name: 'Phone' });
    expect(new JsonDeviceStore(directory).list()[0]?.lastSeen).not.toBeNull();
    expect(devices.revoke(claim!.device.id)).toBe(true);
    expect(devices.authenticate(claim!.deviceToken)).toBeNull();
    const expiring = sessions.start();
    now += 300_001;
    expect(sessions.payload(expiring.session)).toBeNull();
    expect(sessions.claim({ code: expiring.payload.code, name: 'Late', platform: 'Android' })).toBeNull();
  });
});
