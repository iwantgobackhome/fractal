import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PairedDevice, PairingClaimResponse } from '@fractal/shared';

interface StoredDevice extends PairedDevice { tokenHash: string }
interface StoredState { hubId: string; devices: StoredDevice[] }

export interface DeviceStore {
  readonly hubId: string;
  list(): PairedDevice[];
  claim(name: string, platform: string): PairingClaimResponse;
  authenticate(token: string): PairedDevice | null;
  revoke(id: string): boolean;
}

function hash(token: string): Buffer { return createHash('sha256').update(token).digest(); }
function publicDevice(device: StoredDevice): PairedDevice {
  const { id, name, platform, createdAt, lastSeen } = device;
  return { id, name, platform, createdAt, lastSeen };
}

export class JsonDeviceStore implements DeviceStore {
  private readonly path: string;
  private readonly state: StoredState;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'paired-devices.json');
    this.state = existsSync(this.path)
      ? JSON.parse(readFileSync(this.path, 'utf8')) as StoredState
      : { hubId: randomUUID(), devices: [] };
    if (!existsSync(this.path)) this.save();
  }
  get hubId(): string { return this.state.hubId; }
  list(): PairedDevice[] { return this.state.devices.map(publicDevice); }
  claim(name: string, platform: string): PairingClaimResponse {
    const deviceToken = randomBytes(32).toString('hex');
    const device: StoredDevice = {
      id: randomUUID(), name, platform, createdAt: new Date().toISOString(), lastSeen: null,
      tokenHash: hash(deviceToken).toString('hex'),
    };
    this.state.devices.push(device);
    this.save();
    return { device: publicDevice(device), deviceToken };
  }
  authenticate(token: string): PairedDevice | null {
    if (!/^[0-9a-f]{64}$/i.test(token)) return null;
    const digest = hash(token);
    const device = this.state.devices.find((item) => timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), digest));
    if (device === undefined) return null;
    device.lastSeen = new Date().toISOString();
    this.save();
    return publicDevice(device);
  }
  revoke(id: string): boolean {
    const index = this.state.devices.findIndex((device) => device.id === id);
    if (index < 0) return false;
    this.state.devices.splice(index, 1);
    this.save();
    return true;
  }
  private save(): void {
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
