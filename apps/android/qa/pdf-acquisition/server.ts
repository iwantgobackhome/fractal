// Fresh isolated real Hub. Only named error cases and response delay use a QA proxy.
import { createServer, request } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { SqlitePaperStore } from '@qa/hub/store/sqlite';
import { createApiServer } from '@qa/hub/api/index';
import { realAcquirer } from '@qa/hub/main';
import { JobManager } from '@qa/hub/jobs/state';
import { TranslationPipeline } from '@qa/hub/translation/index';
import { JsonDeviceStore } from '@qa/hub/pairing/store';
declare const QA_ACCEPTED_SHA: string;
declare const QA_HARNESS_SHA: string;
const owned = resolve('apps/android/qa/pdf-acquisition/data');
const directory = join(owned, 'hub'); mkdirSync(directory, { recursive: true });
const store = new SqlitePaperStore(directory, join(directory, 'no-legacy')); store.ensureRoot();
store.putPreferences({ ...store.getPreferences(), uiLanguage: 'en', translationLanguage: 'en' });
const devices = new JsonDeviceStore(directory); const paired = devices.claim('PDF acquisition isolated Android', 'android');
const jobs = new JobManager(store);
let loginHtml = false;
const translator: any = { async connection() { return { status: 'subscription', modelIds: [], defaultModelId: null, limits: null }; } };
const apiOptions = { store, jobs, devices, translator, acquirer: realAcquirer(directory),
  pipeline: new TranslationPipeline({ store, jobs, translator }),
  paperChat: { async ask() { throw Error('No QA AI requests'); }, async forget() {} },
  librarySearch: { async searchLibrary() { return []; } }, log() {},
};
const api = createApiServer(apiOptions);
// A second real Hub handler controls only the outbound network response for
// the explicitly named login-HTML error case; live success uses default network.
const loginApi = createApiServer({ ...apiOptions, publicationNetwork: { request: async () => ({ status: 200,
  headers: { 'content-type': 'text/html' }, body: (async function* () { yield Buffer.from('<html><title>Sign in</title><body>Sign in to view this publication</body></html>'); })() }) } });
const internalPort = (await api.listen(0)).port; const internalUrl = `http://127.0.0.1:${internalPort}`;
const loginPort = (await loginApi.listen(0)).port;
let offline = false, oldHub = false, delayOpen = false, blocked: (() => void) | null = null;
const wire: any[] = [];
const proxy = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk); const bytes = Buffer.concat(chunks);
  const path = incoming.url!;
  const event: any = { path, method: incoming.method, at: new Date().toISOString(), bytes: bytes.length,
    network: loginHtml && path === '/api/publications/open' ? 'controlled-login-html' : 'live' }; wire.push(event);
  if (offline || oldHub && path === '/api/publications/open') {
    event.status = oldHub ? 404 : 503; outgoing.writeHead(event.status, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify(oldHub ? {} : { error: { code: 'NETWORK', message: 'QA offline' } })); return;
  }
  const destination = loginHtml && path === '/api/publications/open' ? loginPort : internalPort;
  const upstream = request(`http://127.0.0.1:${destination}` + path, { method: incoming.method, headers: { ...incoming.headers, host: `127.0.0.1:${destination}` } }, response => {
    event.status = response.statusCode;
    if (delayOpen && path === '/api/publications/open') {
      const parts: Buffer[] = []; response.on('data', part => parts.push(part)); response.on('end', () => {
        blocked = () => { outgoing.writeHead(response.statusCode!, response.headers); outgoing.end(Buffer.concat(parts)); blocked = null; };
      }); return;
    }
    outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
  }); upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); }); upstream.end(bytes);
});
await new Promise<void>(r => proxy.listen(6284, '127.0.0.1', r));
function state() { return { acceptedSourceSha: QA_ACCEPTED_SHA, offline, oldHub, loginHtml, delayOpen, blocked: !!blocked, wire,
  library: store.listLibrary(), folders: store.listFolders(), history: store.listHistory(),
  pdfs: store.listLibrary().flatMap(p => { const pdf = store.getPdf(p.paperKey); return pdf ? [{ paperKey: p.paperKey,
    bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex') }] : []; }) }; }
const control = createServer(async (req, res) => { try {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  if (req.method === 'POST' && req.url === '/qa/mode') {
    if ('offline' in body) offline = body.offline === true;
    if ('oldHub' in body) oldHub = body.oldHub === true;
    if ('delayOpen' in body) delayOpen = body.delayOpen === true;
    if ('loginHtml' in body) loginHtml = body.loginHtml === true;
    if (body.release) blocked?.();
  } else if (req.method === 'GET' && req.url === '/qa/state') {} else throw Error('Unknown QA control');
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: state() }));
} catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: String(error) })); } });
await new Promise<void>(r => control.listen(6285, '127.0.0.1', r));
writeFileSync(join(owned, 'private.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:6284', controlPort: 6285,
  deviceId: paired.device.id, deviceToken: paired.deviceToken, hubId: 'pdf-acquisition-owned-5562',
  sourceSha: QA_ACCEPTED_SHA }));
writeFileSync(join(owned, 'server-identity.json'), JSON.stringify({ pid: process.pid, sourceSha: QA_ACCEPTED_SHA, harnessSha: QA_HARNESS_SHA, internalPort, loginPort,
  proxyPort: 6284, controlPort: 6285, directory, started: new Date().toISOString(), command: process.argv }, null, 2));
console.log(JSON.stringify({ ready: true, pid: process.pid, sourceSha: QA_ACCEPTED_SHA, internalPort, proxyPort: 6284, controlPort: 6285 }));
while (!existsSync(join(owned, 'stop'))) await new Promise(r => setTimeout(r, 250));
blocked?.(); await api.close(); await loginApi.close(); await new Promise<void>(r => proxy.close(() => r())); await new Promise<void>(r => control.close(() => r()));
writeFileSync(join(owned, 'final-state.json'), JSON.stringify(state(), null, 2)); store.db.close();
