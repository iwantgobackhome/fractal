import { z } from 'zod';

export const pairingPayloadSchema = z.object({ v: z.literal(1), name: z.string().min(1), hubId: z.uuid(), urls: z.array(z.url()), code: z.string().min(1) });
export type PairingPayload = z.infer<typeof pairingPayloadSchema>;
export const pairingClaimRequestSchema = z.object({
  code: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(100),
});
export type PairingClaimRequest = z.infer<typeof pairingClaimRequestSchema>;
export const pairedDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  platform: z.string(),
  createdAt: z.iso.datetime(),
  lastSeen: z.iso.datetime().nullable(),
});
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export const pairingClaimResponseSchema = z.object({ device: pairedDeviceSchema, deviceToken: z.string() });
export type PairingClaimResponse = z.infer<typeof pairingClaimResponseSchema>;
export const networkSettingsSchema = z.object({ lan: z.boolean(), tailscale: z.boolean() });
export type NetworkSettings = z.infer<typeof networkSettingsSchema>;
export const networkAddressSchema = z.object({ address: z.ipv4(), kind: z.enum(['loopback', 'lan', 'tailscale']), enabled: z.boolean(), url: z.url() });
export type NetworkAddress = z.infer<typeof networkAddressSchema>;
export const networkStatusSchema = z.object({ settings: networkSettingsSchema, addresses: z.array(networkAddressSchema) });
export type NetworkStatus = z.infer<typeof networkStatusSchema>;
