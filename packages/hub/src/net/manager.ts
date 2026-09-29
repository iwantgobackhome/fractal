import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkSettingsSchema, type NetworkSettings, type NetworkStatus } from '@fractal/shared';
import { LOOPBACK_ADDRESS, isLanIPv4, isTailscaleIPv4, networkStatus, systemAddresses } from './index';

export class NetworkManager {
  private readonly path: string;
  private settings: NetworkSettings;
  private lastStatus: NetworkStatus | null = null;
  private explicit: { lan: string[]; tailscale: string[] } | null = null;
  constructor(directory: string, private readonly port: () => number, private readonly bind: (addresses: string[]) => Promise<void>, private readonly detect = systemAddresses) {
    this.path = join(directory, 'network-settings.json');
    this.settings = existsSync(this.path)
      ? networkSettingsSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
      : { lan: false, tailscale: false };
  }
  async status(): Promise<NetworkStatus> {
    this.lastStatus = networkStatus(this.settings, this.explicit ?? await this.detect(), this.port());
    return this.lastStatus;
  }
  configureExplicit(addresses: string[]): void {
    const remote = addresses.filter((address) => address !== LOOPBACK_ADDRESS);
    const lan = remote.filter(isLanIPv4);
    const tailscale = remote.filter(isTailscaleIPv4);
    if (lan.length + tailscale.length !== remote.length) throw new Error('Only private LAN and Tailscale IPv4 bind addresses are supported');
    this.explicit = { lan, tailscale };
    this.settings = { lan: lan.length > 0, tailscale: tailscale.length > 0 };
  }
  statusSyncUrls(port: number): string[] {
    return (this.lastStatus?.addresses ?? []).filter((entry) => entry.kind !== 'loopback' && entry.enabled)
      .map((entry) => `http://${entry.address}:${port}`);
  }
  async apply(): Promise<NetworkStatus> {
    const status = await this.status();
    await this.bind(status.addresses.filter((entry) => entry.enabled).map((entry) => entry.address));
    return status;
  }
  async update(settings: NetworkSettings): Promise<NetworkStatus> {
    const validated = networkSettingsSchema.parse(settings);
    const previous = this.settings;
    const previousExplicit = this.explicit;
    this.explicit = null;
    this.settings = validated;
    try {
      const status = await this.apply();
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(validated, null, 2));
      renameSync(temporary, this.path);
      return status;
    } catch (error) {
      this.settings = previous;
      this.explicit = previousExplicit;
      await this.apply();
      throw error;
    }
  }
}
