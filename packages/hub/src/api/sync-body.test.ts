import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startService, type Service } from '../main';

const directory = mkdtempSync(join(tmpdir(), 'fractal-sync-body-'));
let service: Service | undefined;
afterAll(async () => {
  await service?.stop();
  rmSync(directory, { recursive: true, force: true });
});

describe('sync push body limits', () => {
  it('accepts a long ink stroke but caps sync at 4 MiB and other routes at 64 KiB', async () => {
    service = await startService({ dataDirectory: directory, port: 0, log: () => {}, allowRealCli: false, startBackground: false });
    const url = service.url;
    const headers = { origin: url, 'x-paperread-token': service.token, 'content-type': 'application/json' };
    const paperKey = `pdf-${'a'.repeat(64)}-${'b'.repeat(64)}`;
    service.store.savePaper({
      paperKey, sourceKind: 'publication', arxivId: null, version: null, title: 'Ink fixture', authors: [],
      sourceUrl: 'https://example.org/ink.pdf', pdfSha256: 'b'.repeat(64), pageCount: 1,
      extractionVersion: 'fixture-v1', status: 'ready',
      coverage: { totalPages: 1, textPages: 1, unsupportedPages: [] }, createdAt: new Date().toISOString(),
    });
    const payload = {
      annotations: [{
        id: randomUUID(), paperKey, updatedAt: new Date().toISOString(), deleted: false,
        rev: 0, deviceId: 'phone', kind: 'ink', page: 1, tool: 'pen', color: '#000000', width: 1,
        points: Array.from({ length: 65000 }, (_, i) => [0.5, 0.5, 0.5, i]),
      }],
    };
    const body = JSON.stringify(payload);
    expect(Buffer.byteLength(body)).toBeGreaterThan(1024 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(2 * 1024 * 1024);
    const accepted = await fetch(`${url}/api/sync/push`, { method: 'POST', headers, body });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data.results).toEqual([{ id: payload.annotations[0]!.id, applied: true, rev: 1 }]);
    const tooLarge = JSON.stringify({ annotations: [], padding: 'x'.repeat(4 * 1024 * 1024) });
    expect((await fetch(`${url}/api/sync/push`, { method: 'POST', headers, body: tooLarge })).status).toBe(413);
    const oversizedPreferences = await fetch(`${url}/api/preferences`, {
      method: 'PUT', headers, body: JSON.stringify({ padding: 'x'.repeat(65 * 1024) }),
    });
    expect(oversizedPreferences.status).toBe(400);
    expect((await oversizedPreferences.json()).error.code).toBe('TOO_LARGE');
    expect((await fetch(`${url}/api/pairing/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(65 * 1024) }),
    })).status).toBe(413);
  });
});
