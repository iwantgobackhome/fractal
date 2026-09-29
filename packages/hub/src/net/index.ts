import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import type { NetworkAddress, NetworkSettings, NetworkStatus } from '@fractal/shared';

const execFileAsync = promisify(execFile);
export const LOOPBACK_ADDRESS = '127.0.0.1';
export function isTailscaleIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}
export function isLanIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}
export function detectAddresses(interfaces: ReturnType<typeof networkInterfaces>): { lan: string[]; tailscale: string[] } {
  const lan = new Set<string>();
  const tailscale = new Set<string>();
  for (const entries of Object.values(interfaces)) for (const entry of entries ?? []) {
    if (entry.family !== 'IPv4' || entry.internal) continue;
    if (isTailscaleIPv4(entry.address)) tailscale.add(entry.address);
    else if (isLanIPv4(entry.address)) lan.add(entry.address);
  }
  return { lan: [...lan].sort(), tailscale: [...tailscale].sort() };
}
export async function systemAddresses(): Promise<{ lan: string[]; tailscale: string[] }> {
  const addresses = detectAddresses(networkInterfaces());
  try {
    const { stdout } = await execFileAsync('tailscale', ['ip', '-4'], { timeout: 1500, windowsHide: true });
    for (const address of stdout.trim().split(/\s+/)) if (isTailscaleIPv4(address) && !addresses.tailscale.includes(address)) addresses.tailscale.push(address);
  } catch { /* Tailscale is optional. */ }
  return addresses;
}
export function networkStatus(settings: NetworkSettings, addresses: { lan: string[]; tailscale: string[] }, port: number): NetworkStatus {
  const entries: NetworkAddress[] = [{ address: LOOPBACK_ADDRESS, kind: 'loopback', enabled: true, url: `http://${LOOPBACK_ADDRESS}:${port}` }];
  for (const kind of ['lan', 'tailscale'] as const) for (const address of addresses[kind])
    entries.push({ address, kind, enabled: settings[kind], url: `http://${address}:${port}` });
  return { settings, addresses: entries };
}
