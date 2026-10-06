import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startService, type Service } from '../main';
let service: Service | undefined;
let directory: string;
afterEach(async () => {
  await service?.stop();
  rmSync(directory, { recursive: true, force: true });
});
it('notifies only the changed paper and releases disconnected subscribers', async () => {
  directory = mkdtempSync(join(tmpdir(), 'fractal-events-'));
  service = await startService({ dataDirectory: directory, port: 0, log: () => {}, allowRealCli: false, startBackground: false });
  const key = '2401.12345v1';
  service.store.savePaper({
    paperKey: key,
    arxivId: '2401.12345',
    version: 1,
    title: 'Fixture',
    authors: [],
    sourceUrl: 'https://arxiv.org/abs/2401.12345',
    pdfSha256: 'b'.repeat(64),
    pageCount: 1,
    extractionVersion: 'fixture',
    status: 'ready',
    coverage: { totalPages: 1, textPages: 1, unsupportedPages: [] },
    createdAt: new Date().toISOString(),
  });
  const headers = { origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/json' };
  const pairing = await fetch(`${service.url}/api/pairing/start`, { method: 'POST', headers, body: '{}' });
  const code = (await pairing.json()).data.payload.code;
  const claim = await fetch(`${service.url}/api/pairing/claim`, { method: 'POST', headers, body: JSON.stringify({ code, name: 'A', platform: 'android' }) });
  const deviceToken = (await claim.json()).data.deviceToken;
  const streams: AbortController[] = [];
  const open = async (paperKey: string) => {
    const controller = new AbortController();
    streams.push(controller);
    const response = await fetch(`${service!.url}/api/sync/events?paperKey=${paperKey}`, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    return reader;
  };
  try {
    const reader = await open(key);
    const other = await open('2401.54321v1');
    let otherChanged = false;
    void other
      .read()
      .then(() => {
        otherChanged = true;
      })
      .catch(() => undefined);
    const push = await fetch(`${service.url}/api/sync/push`, {
      method: 'POST',
      headers: { host: 'phone.example', authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        annotations: [
          {
            id: randomUUID(),
            paperKey: key,
            updatedAt: new Date().toISOString(),
            deleted: false,
            rev: 0,
            deviceId: 'A',
            kind: 'ink',
            page: 1,
            tool: 'pen',
            color: '#000000',
            width: 1,
            points: [[0.5, 0.5, 0.5, 0]],
          },
        ],
      }),
    });
    expect(push.status).toBe(200);
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('event: change');
    expect(frame).toContain('ink');
    expect(otherChanged).toBe(false);
    for (const controller of streams) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let i = 0; i < 4; i++) await open(key);
    expect((await fetch(`${service.url}/api/sync/events?paperKey=${key}`)).status).toBe(429);
  } finally {
    for (const controller of streams) controller.abort();
  }
});
