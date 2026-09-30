import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SqlitePaperStore } from '../../../../packages/hub/src/store/sqlite';
import { createApiServer } from '../../../../packages/hub/src/api';
import { JobManager } from '../../../../packages/hub/src/jobs/state';
import { TranslationPipeline } from '../../../../packages/hub/src/translation';
import { ProviderRegistry } from '../../../../packages/hub/src/ai/registry';
import { JsonDeviceStore } from '../../../../packages/hub/src/pairing/store';
import { extractTextPage } from '../../../../packages/hub/src/pdf/text-layout';
import { selectionToRegions, sweepSelection } from '../../../../packages/ui/src/lib/highlights';
import { regionToPixels } from '../../../../packages/ui/src/lib/geometry';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { existsSync } from 'node:fs';

const owned = resolve('docs/implementation/qa/reader-prerequisite');
mkdirSync(join(owned, 'runtime'), { recursive: true });
const directory = mkdtempSync(join(owned, 'runtime/http-'));
const fixture = readFileSync('packages/hub/test/fixtures/text-layout.pdf');
const hash = createHash('sha256').update(fixture).digest('hex');
const output: any[] = [];
const record = (name: string, evidence: unknown, category = 'HTTP pass') => {
  output.push({ name, category, evidence }); console.log(JSON.stringify(output.at(-1)));
};
const layouts = [];
for (let page = 1; page <= 5; page++) layouts.push(await extractTextPage(fixture, page));
writeFileSync(join(owned, 'layouts.json'), JSON.stringify(layouts, null, 2) + '\n');
const loadingTask = getDocument({ data: new Uint8Array(fixture), useSystemFonts: false });
const doc = await loadingTask.promise;
const geometry: any[] = [];
for (const number of [1, 2, 3]) {
  const layout = layouts[number - 1].page!;
  const start = layout.text.indexOf('iii'), end = start + 3;
  const units = layout.runs.flatMap(r => r.units).filter(u => u.start >= start && u.end <= end);
  const proxy = await doc.getPage(number);
  const view = proxy.getViewport({ scale: 1 });
  const points = units.flatMap(u => u.quad!);
  const normalized = points.map(([x, y]) => [x, y]);
  const displayed = points.map(([x, y]) => {
    const px = layout.cropBox[0] + x * layout.width;
    const py = layout.cropBox[3] - y * layout.height;
    const [dx, dy] = view.convertToViewportPoint(px, py);
    return [dx / view.width, dy / view.height];
  });
  const bounds = (ps: number[][]) => ({ x: Math.min(...ps.map(p => p[0])), y: Math.min(...ps.map(p => p[1])),
    width: Math.max(...ps.map(p => p[0])) - Math.min(...ps.map(p => p[0])),
    height: Math.max(...ps.map(p => p[1])) - Math.min(...ps.map(p => p[1])) });
  const unrotated = bounds(normalized), display = bounds(displayed);
  const pageBox = { left: 0, top: 0, width: view.width, height: view.height };
  const legacy = selectionToRegions([{ left: display.x * view.width, top: display.y * view.height,
    width: display.width * view.width, height: display.height * view.height }], pageBox, number)![0];
  assert(Math.abs(legacy.x - display.x) < 1e-10);
  const wronglyRotatedLegacy = displayed.map((_, index) => {
    const [x, y] = displayed[index]; return layout.rotation === 90 ? [1 - y, x] : [x, y];
  });
  geometry.push({ page: number, cropBox: layout.cropBox, rotation: layout.rotation, utf16: [start, end],
    unrotated, display, legacyRoundTrip: legacy, directlyDrawingBQuadsPixels: regionToPixels({ ...unrotated, page: number }, view),
    doubleRotationLegacyBounds: bounds(wronglyRotatedLegacy), viewport: { width: view.width, height: view.height } });
}
await loadingTask.destroy();
writeFileSync(join(owned, 'coordinate-checks.json'), JSON.stringify({ hash, geometry,
  legacyPartialSpan: sweepSelection([{ rect: { left: 10, top: 10, width: 300, height: 10 }, text: 'WiWi iii' }], { x: 14, y: 15 }, { x: 18, y: 15 }) }, null, 2) + '\n');

let store = new SqlitePaperStore(directory, join(directory, 'no-legacy'));
store.ensureRoot(); store.putPreferences({ ...store.getPreferences(), uiLanguage: 'en' });
const devices = new JsonDeviceStore(directory);
const paired = devices.claim('Disposable QA Android shape', 'android');
let calls = 0;
let release: (() => void) | undefined;
const provider = {
  id: 'codex' as const,
  async status() { return { id: this.id, installed: true, loggedIn: true, version: 'QA fixture' }; },
  async listModels() { return [{ id: 'gpt-6-sol', label: 'Fixture' }]; },
  async usage() { return null; },
  async *complete(input: any) {
    calls++; yield { type: 'text' as const, text: 'Fixture prefix ' };
    if (input.messages[0].content.includes('WAIT')) await new Promise<void>(resolve => {
      release = resolve;
      if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    yield { type: 'text' as const, text: '$$x=1$$' };
  },
};
const translator: any = { async connection() { return { status: 'subscription', modelIds: ['gpt-6-sol'], defaultModelId: 'gpt-6-sol', limits: null }; } };
const makeServer = () => {
  const jobs = new JobManager(store);
  const registry = new ProviderRegistry([provider], { async read() { return null; }, async write() {} });
  return createApiServer({ store, jobs, aiRegistry: registry, devices,
    translator, pipeline: new TranslationPipeline({ store, jobs, translator }),
    paperChat: { async ask() { return { text: 'Legacy chat fixture', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: null } }; }, async forget() {} },
    acquirer: { async resolve() { throw new Error('Network forbidden'); }, async acquire() { throw new Error('Network forbidden'); } },
    librarySearch: { async searchLibrary() { return []; } }, log() {},
  });
};
let server = makeServer();
let port = (await server.listen(0)).port;
const req = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, local = false) => {
  const init: RequestInit = { method, headers: local ? { Origin: `http://127.0.0.1:${port}`, 'x-paperread-token': server.token, ...headers }
    : { Authorization: `Bearer ${paired.deviceToken}`, ...headers }, signal: AbortSignal.timeout(8000) };
  if (body !== undefined) {
    init.body = Buffer.isBuffer(body) ? body : JSON.stringify(body);
    init.headers = { 'Content-Type': Buffer.isBuffer(body) ? 'application/pdf' : 'application/json', ...init.headers };
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return response;
};
const json = async (path: string, method = 'GET', body?: unknown, expected = 200, local = false) => {
  const response = await req(path, method, body, {}, local);
  const value: any = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
};
const waitStatus = async (id: string, status: string) => {
  for (let n = 0; n < 100; n++) { const entry = store.getHistory(id); if (entry?.status === status) return entry; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('History did not reach ' + status);
};
try {
  record('own server', { host: '127.0.0.1', port, pid: process.pid, checkpoint: '9dea34cebe4133068b63a289b504cce141d889f1', noRealCli: true });
  const now = new Date().toISOString();
  const key = 'qa-reader-catalog';
  const metadata = { id: key, paperKey: key, title: 'Reader HTTP bridge fixture', authors: [{ given: '', family: 'Fixture' }],
    year: 2026, venue: null, doi: null, arxivId: null, url: 'https://example.org/qa', abstract: null,
    tags: [], collections: [], addedAt: now, updatedAt: now, status: 'unread', bibtexKey: 'qa', saved: true, deviceId: paired.device.id };
  const published = (await json('/api/library/metadata', 'POST', metadata, 201)).data;
  record('metadata publication + data envelope', { paperKey: published.paperKey, rev: published.rev });
  const noPdf = (await json(`/api/papers/${key}/text-layout?page=1`)).data;
  assert.equal(noPdf.reason, 'no_pdf'); record('metadata-only positions', { status: noPdf.status, reason: noPdf.reason });
  const localLink = await req(`/api/library/${key}/pdf`, 'POST', fixture, {}, true);
  const localLinkValue = await localLink.json();
  assert.equal(localLink.status, 415); record('local PDF-link rejected before handler', { status: localLink.status, body: localLinkValue }, 'HTTP reproduced defect');
  const linked = (await json(`/api/library/${key}/pdf`, 'POST', fixture, 201)).data;
  assert.equal(linked.paper.pdfSha256, hash); assert.equal(linked.paper.pageCount, 5);
  record('paired Android-style PDF-link', { hasPdf: linked.hasPdf, pageCount: linked.paper.pageCount, sourceKind: linked.paper.sourceKind, catalogKey: linked.paper.catalogKey });
  const relink = (await json(`/api/library/${key}/pdf`, 'POST', fixture, 201)).data;
  assert.equal(relink.paper.pdfSha256, hash); record('same PDF relink', { unchangedHash: true });
  const sourceChange = await json(`/api/library/${key}/pdf`, 'POST', readFileSync('packages/hub/test/fixtures/structure.pdf'), 409);
  assert.equal(sourceChange.error.code, 'SOURCE_CHANGED'); record('different PDF rejected', sourceChange);
  const layout2 = (await json(`/api/papers/${key}/text-layout?page=2`)).data;
  assert.equal(layout2.pdfSha256, hash); assert.equal(layout2.page.rotation, 90);
  record('text-layout current envelope and provenance', { outer: 'data', status: layout2.status, physicalPage: layout2.page.page, pdfSha256: layout2.pdfSha256,
    layoutVersion: layout2.extractionVersion, snapshotExtractionVersion: linked.paper.extractionVersion });
  const snapshot = (await json(`/api/papers/${key}`)).data;
  assert(snapshot.paper && snapshot.blocks); record('reader snapshot envelope', { keys: Object.keys(snapshot), pages: snapshot.paper.pageCount,
    exampleOrdinal: snapshot.blocks[0].pageOrdinal, examplePhysicalPage: snapshot.blocks[0].regions[0].page });
  await json(`/api/papers/${key}/text-layout?page=0`, 'GET', undefined, 400);
  const outside = (await json(`/api/papers/${key}/text-layout?page=6`)).data;
  assert.equal(outside.reason, 'page_out_of_range'); record('position page bounds', { zeroHttp: 400, beyondLast: outside.reason });
  const pdf = await req(`/api/papers/${key}/pdf`); const etag = pdf.headers.get('etag')!;
  assert.equal(Buffer.compare(Buffer.from(await pdf.arrayBuffer()), fixture), 0);
  const range = await req(`/api/papers/${key}/pdf`, 'GET', undefined, { Range: 'bytes=17-', 'If-Range': etag });
  assert.equal(range.status, 206); assert.equal(Buffer.compare(Buffer.from(await range.arrayBuffer()), fixture.subarray(17)), 0);
  const stale = await req(`/api/papers/${key}/pdf`, 'GET', undefined, { Range: 'bytes=17-', 'If-Range': '"stale"' });
  assert.equal(stale.status, 200); await stale.arrayBuffer();
  const fullPart = await req(`/api/papers/${key}/pdf`, 'GET', undefined, { Range: `bytes=${fixture.length}-`, 'If-Range': etag });
  assert.equal(fullPart.status, 416); await fullPart.arrayBuffer();
  const unchanged = await req(`/api/papers/${key}/pdf`, 'GET', undefined, { 'If-None-Match': etag }); assert.equal(unchanged.status, 304);
  record('Android RangePlan wire resume', { partial: 206, staleEtagFullReplace: 200, completePart: 416, unchanged: 304, etagMatchesHash: etag === `"${hash}"` });
  const push = (value: unknown, expected = 200) => json('/api/sync/push', 'POST', value, expected);
  const folder = { id: 'qa-folder', baseRev: 0, requestId: 'folder-1', deviceId: paired.device.id, patch: { name: 'QA folder', parentId: null } };
  const paperMutation = { paperKey: key, baseRev: store.getLibrary(key)!.rev, deviceId: paired.device.id, requestId: 'paper-1',
    patch: { tags: ['qa'], collections: ['qa-folder'], lastReadAt: now, readProgress: { page: 2, scrollOffset: 0.25 } } };
  const batch = { annotations: [], folders: [folder], papers: [paperMutation], history: [] };
  const first = (await push(batch)).data; assert(first.metadataResults.every((x: any) => x.applied));
  const again = (await push(batch)).data; assert.deepEqual(again.metadataResults, first.metadataResults);
  record('SyncEngine-shaped folder-before-paper CAS + retry', { kinds: first.metadataResults.map((x: any) => x.kind), unchangedReceipt: true });
  const conflict = (await push({ annotations: [], papers: [{ ...paperMutation, requestId: 'stale-paper', patch: { title: 'stale' } }] })).data;
  assert.equal(conflict.metadataResults[0].conflict, true); assert.equal(conflict.metadataResults[0].current.title, metadata.title);
  record('stale revision returns authority', conflict.metadataResults);
  await push({ annotations: [], papers: [{ ...paperMutation, patch: { title: 'requestId reused' } }] }, 400);
  record('receipt fingerprint guard', { changedRequestIdPayload: 400 });
  // These typed nullable defaults are NOT emitted by MetadataStore.read/patchPaper builders.
  const nullableProgress = await push({ annotations: [], papers: [{ ...paperMutation, baseRev: store.getLibrary(key)!.rev, requestId: 'nullable-progress',
    patch: { readProgress: { page: 2, fraction: null, blockId: null, scrollOffset: null } } }] }, 400);
  const nullableAuthor = await push({ annotations: [], papers: [{ ...paperMutation, baseRev: store.getLibrary(key)!.rev, requestId: 'nullable-author',
    patch: { authors: [{ given: '', family: 'Fixture', orcid: null }] } }] }, 400);
  record('typed Kotlin nullable defaults differ from shared schema', { nullableProgress: nullableProgress.error.code, nullableAuthor: nullableAuthor.error.code,
    actualBuildersOmitTheseNulls: true }, 'HTTP compatibility observation');
  const annotation = { id: randomUUID(), paperKey: key, page: 2, updatedAt: now, deleted: false, rev: 0, deviceId: paired.device.id,
    kind: 'memo', text: 'Historic displayed note', quote: 'iii', rect: { x: .2, y: .3, width: .1, height: .05 } };
  assert.equal((await push({ annotations: [annotation] })).data.results[0].applied, true);
  record('Android memo wire + pull unchanged geometry', { id: annotation.id, rect: store.listAnnotations(key)[0].rect });
  const askBody = { question: 'Fixture quote', page: 2, selectedText: 'iii', rect: { x: .2, y: .3, width: .1, height: .05 }, requestId: 'ask-1' };
  const ask = await req(`/api/papers/${key}/ask`, 'POST', askBody); assert.equal(ask.status, 200);
  const raw = await ask.text(); const id = /"historyId":"([^"]+)"/.exec(raw)![1];
  const asked = await waitStatus(id, 'completed'); assert.equal(asked.context.page, 2); assert(asked.text.includes('[p.2]'));
  const list = (await json(`/api/papers/${key}/history`)).data; assert(Array.isArray(list.history));
  const single = (await json(`/api/papers/${key}/history/${id}`)).data; assert.equal(single.history.id, id);
  record('ask SSE + durable history envelopes', { historyId: id, events: raw.split('\n').filter(l => l.startsWith('event:')), context: asked.context,
    collectionShape: 'data.history[]', itemShape: 'data.history', status: asked.status });
  const beforeRetry = calls; await (await req(`/api/papers/${key}/ask`, 'POST', askBody)).text(); assert.equal(calls, beforeRetry);
  await json(`/api/papers/${key}/ask`, 'POST', { ...askBody, question: 'Changed' }, 400);
  record('question requestId retry + changed payload', { duplicateGenerationCalls: 0, changedPayload: 400 });
  const explain = await req(`/api/papers/${key}/explain`, 'POST', { kind: 'equation', page: 3, bbox: { x: .1, y: .2, width: .4, height: .1 }, surroundingText: 'x=1', requestId: 'explain-1' });
  const exRaw = await explain.text(); const exId = /"historyId":"([^"]+)"/.exec(exRaw)![1]; const explained = await waitStatus(exId, 'completed');
  assert.equal(explained.context.page, 3); assert.equal(explained.latex, 'x=1');
  record('explanation durable region + latex', { status: explained.status, context: explained.context, latex: explained.latex });
  const illegal = await req(`/api/papers/${key}/ask`, 'POST', { question: 'Page outside PDF', page: 6, requestId: 'outside-ask' });
  const illegalRaw = await illegal.text(); const illegalId = /"historyId":"([^"]+)"/.exec(illegalRaw)![1]; const illegalEntry = await waitStatus(illegalId, 'completed');
  assert.equal(illegal.status, 200); assert(illegalEntry.text.includes('[p.6]'));
  record('out-of-range question physical page admitted', { actualPageCount: 5, submittedPage: 6, status: illegal.status, context: illegalEntry.context, answer: illegalEntry.text }, 'HTTP reproduced defect');
  const controller = new AbortController();
  const disconnected = await fetch(`http://127.0.0.1:${port}/api/papers/${key}/ask`, { method: 'POST', headers: { Authorization: `Bearer ${paired.deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'WAIT disconnected', page: 2, requestId: 'disconnect-1' }), signal: controller.signal });
  const reader = disconnected.body!.getReader(); const chunk = new TextDecoder().decode((await reader.read()).value); const detachedId = /"historyId":"([^"]+)"/.exec(chunk)![1];
  controller.abort(); await reader.cancel().catch(() => {});
  await waitStatus(detachedId, 'running'); release!(); const detached = await waitStatus(detachedId, 'completed');
  record('real HTTP observer disconnect retains generation', { historyId: detachedId, beforeRelease: 'running', afterRelease: detached.status });
  const cancelResponse = await req(`/api/papers/${key}/ask`, 'POST', { question: 'WAIT cancel', page: 2, requestId: 'cancel-1' });
  const cancelReader = cancelResponse.body!.getReader(); const cancelChunk = new TextDecoder().decode((await cancelReader.read()).value); const cancelId = /"historyId":"([^"]+)"/.exec(cancelChunk)![1];
  const activeEntry = store.getHistory(cancelId)!;
  const activeImport = (await push({ annotations: [], history: [{ entry: { ...activeEntry, status: 'completed', text: 'offline replacement', deviceId: paired.device.id }, baseRev: activeEntry.rev, requestId: 'active-import' }] })).data;
  assert.equal(activeImport.metadataResults[0].conflict, true);
  const canceled = (await json(`/api/papers/${key}/history/${cancelId}/cancel`, 'POST', {})).data.history; assert.equal(canceled.status, 'canceled');
  await cancelReader.cancel();
  record('active history CAS owner + explicit cancel', { activeReplacement: activeImport.metadataResults[0].applied, authoritativeStatus: activeImport.metadataResults[0].current.status, canceled: canceled.status });
  const settledImport = (await push({ annotations: [], history: [{ entry: { ...canceled, text: 'Settled offline edited', deviceId: paired.device.id }, baseRev: canceled.rev, requestId: 'settled-import' }] })).data;
  assert.equal(settledImport.metadataResults[0].applied, true); record('settled question history CAS import', { applied: true, currentStatus: settledImport.metadataResults[0].current.status });
  const deleted = (await json(`/api/papers/${key}/history/${exId}`, 'DELETE')).data.history; assert.equal(deleted.deleted, true);
  await json(`/api/papers/${key}/history/${exId}`, 'GET', undefined, 404); record('history delete returns tombstone', { deleted: true, subsequentGet: 404 });
  const folderDelete = (await push({ annotations: [], folders: [{ id: 'qa-folder', baseRev: store.getFolder('qa-folder')!.rev, deviceId: paired.device.id, requestId: 'folder-delete', deleted: true, patch: {} }] })).data;
  assert(folderDelete.metadataResults[0].applied); assert.equal(store.getLibrary(key)!.collections.length, 0);
  record('folder removal retains reader PDF/cache and notes', { membership: store.getLibrary(key)!.collections, pdfRetained: !!store.getPdf(key), annotations: store.listAnnotations(key).length });
  const orphan = store.putHistory({ ...asked, id: randomUUID(), requestId: 'restart-probe', status: 'running', text: 'Persisted crash prefix', completedAt: null, rev: 0 });
  await server.close(); store.db.close();
  store = new SqlitePaperStore(directory, join(directory, 'no-legacy')); store.ensureRoot(); server = makeServer(); port = (await server.listen(0)).port;
  const recovered = (await json(`/api/papers/${key}/history/${orphan.id}`)).data.history;
  assert.equal(recovered.status, 'failed'); assert.equal(recovered.error.code, 'NETWORK'); assert.equal(recovered.text, 'Persisted crash prefix');
  const retryCount = calls;
  await (await req(`/api/papers/${key}/ask`, 'POST', { ...askBody, question: asked.question, requestId: 'restart-probe' })).text();
  assert.equal(calls, retryCount); record('restart durable failure + same-id replay', { status: recovered.status, error: recovered.error.code, text: recovered.text, newProviderCalls: 0 });
  const restartedLayout = (await json(`/api/papers/${key}/text-layout?page=2`)).data;
  assert.equal(restartedLayout.pdfSha256, hash); record('restart text-layout + settled history', { pdfShaMatches: true, layoutVersion: restartedLayout.extractionVersion,
    settledQuestionRetained: store.getHistory(id)!.status, pullHistoryPresent: (await json('/api/sync/pull?since=0')).data.history.length });
  if (process.argv.includes('--bridge')) {
    const bridge = { port, pid: process.pid, deviceId: paired.device.id, deviceToken: paired.deviceToken };
    // Disposable secrets stay in ignored scratch; never print or commit this file.
    writeFileSync(join(owned, 'runtime/bridge-private.json'), JSON.stringify(bridge));
    console.log(JSON.stringify({ bridgeReady: true, port, pid: process.pid }));
    while (!existsSync(join(owned, 'runtime/bridge-stop'))) await new Promise(r => setTimeout(r, 250));
    const final = store.getLibrary(key)!;
    record('actual Android bridge authority after reconnect', { saved: final.saved, tags: final.tags, collections: final.collections,
      readProgress: final.readProgress, lastReadAt: final.lastReadAt, child: store.getFolder('qa-bridge-child') });
  }
} finally {
  await server.close(); store.db.close();
  writeFileSync(join(owned, 'http-evidence.json'), JSON.stringify(output, null, 2) + '\n');
}
