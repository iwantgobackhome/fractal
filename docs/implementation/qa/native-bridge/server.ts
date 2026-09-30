// QA harness only: all real routes and storage come from this accepted checkout.
import { createServer, request } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { SqlitePaperStore } from '../../../../packages/hub/src/store/sqlite';
import { createApiServer } from '../../../../packages/hub/src/api';
import { JobManager } from '../../../../packages/hub/src/jobs/state';
import { TranslationPipeline, translationPromptVersion } from '../../../../packages/hub/src/translation';
import { ProviderRegistry } from '../../../../packages/hub/src/ai/registry';
import { JsonDeviceStore } from '../../../../packages/hub/src/pairing/store';
const owned = resolve('docs/implementation/qa/native-bridge');
mkdirSync(join(owned, 'runtime'), { recursive: true });
const directory = mkdtempSync(join(owned, 'runtime/http-'));
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const fixture = readFileSync('packages/hub/test/fixtures/text-layout.pdf');
const pdfSha256 = createHash('sha256').update(fixture).digest('hex');
const store = new SqlitePaperStore(directory, join(directory, 'no-legacy'));
store.ensureRoot(); store.putPreferences({ ...store.getPreferences(), uiLanguage: 'en', translationLanguage: 'en' });
const devices = new JsonDeviceStore(directory);
const e = devices.claim('E isolated bridge', 'android');
const d = devices.claim('D isolated lifecycle fixture', 'android');
const flights = new Map<string, { owner: string; release: () => void; status: string }>();
const providerCalls: any[] = [];
const provider = {
  id: 'codex' as const,
  async status() { return { id: this.id, installed: true, loggedIn: true, version: 'QA deterministic fixture' }; },
  async listModels() { return [{ id: 'gpt-6-sol', label: 'Deterministic QA' }]; },
  async usage() { return null; },
  async *complete(input: any) {
    const text = input.messages.map((m: any) => m.content).join('\n');
    const id = /[DE]-FLIGHT-[A-Za-z0-9-]+/.exec(text)?.[0] ?? `E-FLIGHT-auto-${providerCalls.length}`;
    const owner = id.startsWith('D-') ? 'D' : 'E';
    providerCalls.push({ id, model: input.modelId, at: new Date().toISOString() });
    yield { type: 'text' as const, text: `QA ${id} prefix ` };
    if (text.includes('QA_WAIT')) await new Promise<void>(release => {
      flights.set(id, { owner, release, status: 'waiting' });
      if (input.signal.aborted) release(); else input.signal.addEventListener('abort', release, { once: true });
    });
    if (flights.has(id)) flights.get(id)!.status = input.signal.aborted ? 'aborted' : 'released';
    if (input.signal.aborted) return;
    if (text.includes('QA_ERROR')) throw { code: 'NETWORK', message: 'Deterministic QA provider error', retryable: true };
    yield { type: 'text' as const, text: `QA ${id} completed $$x=1$$` };
  },
};
const jobs = new JobManager(store);
const translator: any = { async connection() { return { status: 'subscription', modelIds: ['gpt-6-sol'], defaultModelId: 'gpt-6-sol', limits: null }; } };
const api = createApiServer({ store, jobs, devices, translator,
  aiRegistry: new ProviderRegistry([provider], { async read() { return null; }, async write() {} }),
  pipeline: new TranslationPipeline({ store, jobs, translator }),
  paperChat: { async ask() { return { text: 'QA legacy', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: null } }; }, async forget() {} },
  acquirer: { async resolve() { throw Error('QA forbids acquisition'); }, async acquire() { throw Error('QA forbids acquisition'); } },
  librarySearch: { async searchLibrary() { return []; } }, log() {},
});
const internalPort = (await api.listen(0)).port;
const internalUrl = `http://127.0.0.1:${internalPort}`;
for (const [key, title, credentials] of [['qa-reader-catalog', 'Reader HTTP bridge fixture', e], ['D-reader-catalog', 'D native lifecycle fixture', d]] as const) {
  const now = new Date().toISOString();
  const auth = { Authorization: `Bearer ${credentials.deviceToken}` };
  const response = await fetch(internalUrl + '/api/library/metadata', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: key, paperKey: key, title, authors: [{ given: '', family: 'Fixture' }], year: 2026, venue: null, doi: null, arxivId: null, url: 'https://example.org/qa', abstract: null, tags: [], collections: [], addedAt: now, updatedAt: now, status: 'unread', bibtexKey: key, saved: true, deviceId: credentials.device.id }) });
  assert.equal(response.status, 201); await response.arrayBuffer();
  const linked = await fetch(internalUrl + `/api/library/${key}/pdf`, { method: 'POST', headers: { Origin: internalUrl, 'x-paperread-token': api.token, 'Content-Type': 'application/pdf' }, body: fixture });
  assert.equal(linked.status, 201); await linked.arrayBuffer();
  for (const block of store.listBlocks(key).filter(b => b.translatable)) store.saveTranslation(key, {
    blockId: block.blockId, sourceHash: block.sourceHash, modelId: 'gpt-6-sol', promptVersion: translationPromptVersion('en'),
    status: 'completed', text: `Translated QA ${key}: ${block.sourceText}`, error: null, completedAt: now,
  });
  const snapshot = await (await fetch(internalUrl + `/api/papers/${key}`, { headers: auth })).json() as any;
  assert(snapshot.data.translations.length > 0 && snapshot.data.translations.every((t: any) => t.status === 'completed'), 'Seeded translations must be exposed by the accepted snapshot route');
}
let dropNext = false, conflictNext = false;
const wire: any[] = [];
const proxy = createServer(async (incoming, outgoing) => {
  const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const path = incoming.url!;
  const body = raw.length && incoming.headers['content-type']?.includes('json') ? JSON.parse(raw.toString()) : undefined;
  const lose = dropNext && path === '/api/sync/push' && body?.papers?.some((p: any) => p.paperKey === 'qa-reader-catalog');
  if (lose) dropNext = false;
  const upstream = request(internalUrl + path, { method: incoming.method, headers: { ...incoming.headers, host: `127.0.0.1:${internalPort}` } }, response => {
    if (path.startsWith('/api/sync/') && body) wire.push({ path, body, lostResponse: lose });
    if (lose) { response.resume(); response.on('end', () => outgoing.destroy()); return; }
    if (conflictNext && path.startsWith('/api/sync/pull')) {
      conflictNext = false;
      const current = store.getLibrary('qa-reader-catalog')!;
      store.patchLibrary(current.paperKey, { tags: [...current.tags, 'remote-conflict'] }, 'E-control');
    }
    outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
  });
  upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); }); upstream.end(raw);
});
await new Promise<void>(r => proxy.listen(6174, '127.0.0.1', r));
const control = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const owner = req.url?.startsWith('/D/') ? 'D' : req.url?.startsWith('/E/') ? 'E' : null;
    assert(owner, 'Explicit owner path required');
    if (req.method === 'POST' && req.url === `/${owner}/release`) {
      assert(body.flightId?.startsWith(`${owner}-FLIGHT-`), 'Wrong owner flight');
      const flight = flights.get(body.flightId); assert(flight?.owner === owner && flight.status === 'waiting', 'Flight is not waiting'); flight.release();
    } else if (req.method === 'POST' && req.url === '/E/drop-next-push') dropNext = true;
    else if (req.method === 'POST' && req.url === '/E/conflict-next-push') conflictNext = true;
    else assert(req.method === 'GET' && req.url === `/${owner}/state`, 'Unknown QA control');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { flights: [...flights].filter(([, f]) => f.owner === owner).map(([id, f]) => ({ id, status: f.status })),
      providerCalls: providerCalls.filter(c => c.id.startsWith(owner! + '-')), library: store.getLibrary(owner === 'D' ? 'D-reader-catalog' : 'qa-reader-catalog'),
      history: store.listHistory().filter((h: any) => h.paperKey === (owner === 'D' ? 'D-reader-catalog' : 'qa-reader-catalog')) } }));
  } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })); }
});
await new Promise<void>(r => control.listen(6175, '127.0.0.1', r));
for (const [owner, paired, key] of [['E', e, 'qa-reader-catalog'], ['D', d, 'D-reader-catalog']] as const)
  writeFileSync(join(owned, `runtime/${owner}-private.json`), JSON.stringify({ port: 6174, controlPort: 6175, baseUrl: 'http://127.0.0.1:6174', deviceId: paired.device.id, deviceToken: paired.deviceToken, paperKey: key, pdfSha256 }));
writeFileSync(join(owned, 'runtime/server-identity.json'), JSON.stringify({ pid: process.pid, sourceSha, internalPort, proxyPort: 6174, controlPort: 6175, directory, started: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ ready: true, pid: process.pid, sourceSha, internalPort, proxyPort: 6174, controlPort: 6175 }));
while (!existsSync(join(owned, 'runtime/stop'))) { writeFileSync(join(owned, 'runtime/wire.json'), JSON.stringify(wire, null, 2)); await new Promise(r => setTimeout(r, 250)); }
await api.close(); proxy.close(); control.close();
writeFileSync(join(owned, 'runtime/final-state.json'), JSON.stringify({ wire, providerCalls, e: store.getLibrary('qa-reader-catalog'), d: store.getLibrary('D-reader-catalog'), folders: store.listFolders(), annotations: store.listAnnotations('qa-reader-catalog') }, null, 2));
store.db.close();
