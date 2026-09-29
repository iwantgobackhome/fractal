import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { detectAddresses, isLanIPv4, isTailscaleIPv4, networkStatus } from './index';
import { NetworkManager } from './manager';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const address = (ip: string, internal = false): NetworkInterfaceInfo => ({
  address: ip,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${ip}/24`,
});
describe('network detection', () => {
  it('separates LAN, Tailscale and loopback addresses', () => {
    const found = detectAddresses({ eth: [address('192.168.1.3'), address('127.0.0.1', true)], tailscale: [address('100.101.2.4')] });
    expect(found).toEqual({ lan: ['192.168.1.3'], tailscale: ['100.101.2.4'] });
    expect(isTailscaleIPv4('100.64.0.1')).toBe(true);
    expect(isTailscaleIPv4('100.127.255.255')).toBe(true);
    expect(isTailscaleIPv4('100.128.0.1')).toBe(false);
    expect(isLanIPv4('8.8.8.8')).toBe(false);
    const status = networkStatus({ lan: true, tailscale: false }, found, 7327);
    expect(status.addresses.map((item) => item.enabled)).toEqual([true, true, false]);
  });
  it('persists settings and updates listeners without restarting', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fractal-network-'));
    const bound: string[][] = [];
    const bind = async (addresses: string[]) => {
      bound.push(addresses);
    };
    const detect = async () => ({ lan: ['192.168.1.3'], tailscale: ['100.101.2.4'] });
    try {
      const manager = new NetworkManager(directory, () => 7327, bind, detect);
      expect((await manager.apply()).settings).toEqual({ lan: false, tailscale: false });
      expect((await manager.update({ lan: true, tailscale: false })).addresses[1]?.enabled).toBe(true);
      expect(bound).toEqual([['127.0.0.1'], ['127.0.0.1', '192.168.1.3']]);
      expect((await new NetworkManager(directory, () => 7327, bind, detect).status()).settings.lan).toBe(true);
      manager.configureExplicit(['127.0.0.1', '100.101.2.4']);
      expect((await manager.status()).addresses.map((entry) => entry.address)).toEqual(['127.0.0.1', '100.101.2.4']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
