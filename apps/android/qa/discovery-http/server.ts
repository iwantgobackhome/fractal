// D-owned disposable actual Hub/storage harness. Only outbound provider boundaries are controlled.
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
import { JsonDeviceStore } from '../../../../packages/hub/src/pairing/store';
import { FeedService } from '../../../../packages/hub/src/feed';
import { openAlexSource, crossrefSource } from '../../../../packages/hub/src/feed/scholarly-sources';
import { newsSource } from '../../../../packages/hub/src/feed/sources';

const owned = resolve('apps/android/qa/discovery-http');
mkdirSync(join(owned, 'runtime'), { recursive: true });
const resumed = process.env.FRACTAL_D_QA_RESUME;
if (resumed) assert(resolve(resumed).startsWith(join(owned, 'runtime') + '\\') && existsSync(resumed), 'Only this helper owned runtime may resume');
const directory = resumed ? resolve(resumed) : mkdtempSync(join(owned, 'runtime/http-'));
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const store = new SqlitePaperStore(directory, join(directory, 'no-legacy'));
store.ensureRoot(); store.putPreferences({ ...store.getPreferences(), uiLanguage: 'en', translationLanguage: 'en' });
const deviceStore = new JsonDeviceStore(directory);
const paired = deviceStore.claim('D stage4 isolated discovery', 'android');
const wire: any[] = [], providerCalls: any[] = [];
const nativeFetch = globalThis.fetch;
let mode = 'ready', offline = false, textUnavailable = false, dropTopic = false, articleUnavailable = false;
const now = new Date();
const attention = { id: 'W2741809807', title: 'Attention Is All You Need', year: 2017, date: '2017-06-12',
  type: 'conference-paper', venue: 'Advances in Neural Information Processing Systems 30 (NIPS 2017)',
  url: 'https://papers.nips.cc/paper/7181-attention-is-all-you-need', arxiv: '1706.03762', doi: '10.48550/arXiv.1706.03762',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit', 'Llion Jones', 'Aidan N. Gomez', 'Łukasz Kaiser', 'Illia Polosukhin'],
  abstract: 'QA paraphrase of the reported abstract: An attention-based encoder and decoder replace recurrent sequence computation. Parallel training and translation experiments motivate the architecture. The dossier retains the original publication year and conference venue rather than treating this historical work as a new release.' };
const lora = { id: 'W3189977011', title: 'LoRA: Low-Rank Adaptation of Large Language Models', year: 2021, date: '2021-06-17',
  type: 'preprint', venue: 'arXiv', url: 'https://arxiv.org/abs/2106.09685', arxiv: '2106.09685', doi: '10.48550/arXiv.2106.09685',
  authors: ['Edward J. Hu', 'Yelong Shen', 'Phillip Wallis', 'Zeyuan Allen-Zhu', 'Yuanzhi Li', 'Shean Wang', 'Lu Wang', 'Weizhu Chen'],
  abstract: 'QA paraphrase of the reported abstract: A pretrained language model keeps its original weights while trainable low-rank matrices adapt attention layers. The approach reduces the number of task-specific parameters and memory requirements. Comparative experiments examine quality, throughput and inference latency.' };
const sklearn = { id: 'W2142181572', title: 'Scikit-learn: Machine Learning in Python', year: 2011, date: null,
  type: 'article', venue: 'Journal of Machine Learning Research', url: 'https://jmlr.org/papers/v12/pedregosa11a.html', arxiv: null, doi: null,
  authors: ['Fabian Pedregosa', 'Gaël Varoquaux', 'Alexandre Gramfort', 'Vincent Michel', 'Bertrand Thirion', 'Olivier Grisel', 'Mathieu Blondel', 'Peter Prettenhofer', 'Ron Weiss', 'Vincent Dubourg', 'Jake Vanderplas', 'Alexandre Passos', 'David Cournapeau', 'Matthieu Brucher', 'Matthieu Perrot', 'Édouard Duchesnay'],
  abstract: 'QA paraphrase of the reported abstract: The Python library brings supervised and unsupervised learning methods together behind consistent interfaces. Documentation, performance and accessibility support researchers and practitioners. The article reports the package’s minimal dependencies and permissive licensing.' };
const publications = [lora, attention, sklearn];
function alex(p: any) {
  const words: Record<string, number[]> = {}; p.abstract.split(' ').forEach((w: string, i: number) => (words[w] ??= []).push(i));
  return { id: 'https://openalex.org/' + p.id, display_name: p.title, type: p.type, doi: p.doi ? 'https://doi.org/' + p.doi : null,
    publication_year: p.year, publication_date: p.date, authorships: p.authors.map((name: string) => ({ author: { display_name: name } })),
    primary_location: { source: { display_name: p.venue, type: p.type === 'article' ? 'journal' : p.type === 'conference-paper' ? 'conference' : 'repository' }, landing_page_url: p.url },
    open_access: { is_oa: true, oa_url: p.arxiv ? 'https://arxiv.org/pdf/' + p.arxiv : null }, abstract_inverted_index: words,
    related_works: ['https://openalex.org/' + lora.id], referenced_works: ['https://openalex.org/' + sklearn.id], cited_by_count: 0 };
}
function semantic(p: any) { return { paperId: p.id, title: p.title, authors: p.authors.map((name: string) => ({ name })), year: p.year, venue: p.venue,
  abstract: p.abstract, url: p.url, externalIds: { DOI: p.doi, ArXiv: p.arxiv }, citationCount: 0 }; }
const newsTitle = 'QA research field report: language models, reproducible evaluation and long-term scholarly reading across devices';
const koreanTitle = 'QA 연구 분야 소식: 언어 모델의 재현 가능한 평가와 여러 기기에서 이어지는 장기적인 학술 읽기';
const paragraph = 'This isolated QA article tests the real Hub article extraction and Android offline cache. Researchers compare language models with clearly documented evaluation procedures. Publication dates, reported venues and provider evidence remain separate from observations made by a discovery feed. The article is a test document, not a report about a real event.';
const controlledFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, init);
  providerCalls.push({ host: url.hostname, path: url.pathname, mode, at: new Date().toISOString() });
  if (['api.openalex.org', 'api.semanticscholar.org', 'api.crossref.org'].includes(url.hostname)) {
    if (mode === '429') return Response.json({ error: 'Isolated provider cooldown' }, { status: 429, headers: { 'Retry-After': '1' } });
    if (mode === 'timeout') return new Promise((_, reject) => { const signal = init?.signal; if (signal?.aborted) reject(signal.reason); else signal?.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    if (url.hostname === 'api.openalex.org') {
      const p = publications.find(p => url.href.toLowerCase().includes(p.id.toLowerCase()) || p.doi && url.href.toLowerCase().includes(p.doi.toLowerCase())) ?? attention;
      return Response.json(url.pathname === '/works' ? { results: publications.map(alex) } : alex(p));
    }
    if (url.hostname === 'api.crossref.org') return Response.json({ message: { items: [] } });
    if (url.pathname.includes('recommendations')) return Response.json({ recommendedPapers: [semantic(lora)] });
    const p = publications.find(p => p.arxiv && url.href.includes(p.arxiv)) ?? attention;
    return Response.json({ ...semantic(p), references: [semantic(sklearn)], citations: [semantic(lora)] });
  }
  if (url.hostname === 'translate.googleapis.com') {
    const text = url.searchParams.get('q') ?? '';
    const target = url.searchParams.get('tl');
    const translated = target === 'ja' ? (text === newsTitle ? 'QA研究分野ニュース：言語モデルの再現可能な評価と複数の端末で続く学術的な読書' : 'QA機械翻訳：' + text)
      : target === 'en' ? text : text === newsTitle ? koreanTitle : 'QA 기계 번역: ' + text;
    return Response.json([[[translated, text, null, null]], null, 'en']);
  }
  if (url.pathname.endsWith('/qa-fractal-field-report')) return new Response(`<html lang="en"><head><title>${newsTitle}</title><meta property="article:published_time" content="${now.toISOString()}"></head><body><article><h1>${newsTitle}</h1><p>${paragraph}</p><h2>Reproducible source context</h2><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`, { headers: { 'content-type': 'text/html' } });
  return new Response(`<rss version="2.0"><channel><title>Isolated QA news provider</title><item><title>${newsTitle}</title><link>https://jmlr.org/qa-fractal-field-report</link><description>${paragraph}</description><pubDate>${now.toUTCString()}</pubDate></item></channel></rss>`, { headers: { 'content-type': 'application/xml' } });
};
globalThis.fetch = controlledFetch;
const jobs = new JobManager(store);
const translator: any = { async connection() { return { status: 'subscription', modelIds: [], defaultModelId: null, limits: null }; } };
const acquirer: any = { async resolve() { throw Error('QA acquisition disabled; explicit PDF link only'); }, async acquire() { throw Error('QA acquisition disabled'); } };
const feed = new FeedService(store, acquirer, undefined, controlledFetch, () => now, [openAlexSource, crossrefSource, newsSource]);
feed.putInterests({ categories: ['cs.CL'], topics: [], authors: [], custom: [] });
feed.putSettings({ ...feed.settings(), sources: { arxiv: false, huggingFace: false, news: true, recommendations: false, openAlex: true, crossref: true }, digestEnabled: false, translateNewsTitles: false });
const api = createApiServer({ store, jobs, devices: deviceStore, translator, feed,
  pipeline: new TranslationPipeline({ store, jobs, translator }), acquirer,
  paperChat: { async ask() { return { text: 'QA no real AI calls', usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: null } }; }, async forget() {} },
  librarySearch: { async searchLibrary() { return []; } }, log() {},
});
const internalPort = (await api.listen(0)).port;
const internalUrl = `http://127.0.0.1:${internalPort}`;
const auth = { Authorization: `Bearer ${paired.deviceToken}` };
// Distinct immutable tuple avoids removing any previously accepted shared geometry cache row.
const fixture = Buffer.concat([readFileSync('packages/hub/test/fixtures/text-layout.pdf'), Buffer.from('\n \n')]);
const pdfSha256 = createHash('sha256').update(fixture).digest('hex');
const key = 'D-stage4-retry';
const timestamp = now.toISOString();
const metadata = store.getLibrary(key) ? undefined : await nativeFetch(internalUrl + '/api/library/metadata', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({
  id: key, paperKey: key, title: 'D mounted original text recovery fixture', authors: [], year: null, venue: null, doi: null, arxivId: null,
  url: 'https://example.org/D-stage4-retry', abstract: null, tags: [], collections: [], addedAt: timestamp, updatedAt: timestamp, status: 'unread', bibtexKey: key, saved: true,
}) }); if (metadata) assert.equal(metadata.status, 201);
const link = await nativeFetch(internalUrl + `/api/library/${key}/pdf`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/pdf' }, body: fixture }); assert.equal(link.status, 201, link.ok ? '' : await link.text());
for (const block of store.listBlocks(key).filter(b => b.translatable)) store.saveTranslation(key, { blockId: block.blockId, sourceHash: block.sourceHash, modelId: 'gpt-6-sol', promptVersion: translationPromptVersion('en'), status: 'completed', text: 'Translated QA: ' + block.sourceText, error: null, completedAt: timestamp });
await feed.refresh();
const proxy = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk); const bytes = Buffer.concat(chunks);
  const path = incoming.url!;
  wire.push({ path, method: incoming.method, at: new Date().toISOString(), bytes: bytes.length });
  if (offline || textUnavailable && path.includes('/text-layout') || articleUnavailable && path.startsWith('/api/news/article')) { outgoing.writeHead(503, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ error: { code: 'NETWORK', message: 'Isolated QA temporary outage' } })); return; }
  const lose = dropTopic && incoming.method === 'POST' && path === '/api/feed/topics'; if (lose) dropTopic = false;
  const upstream = request(internalUrl + path, { method: incoming.method, headers: { ...incoming.headers, host: `127.0.0.1:${internalPort}` } }, response => {
    if (lose) { response.resume(); response.on('end', () => outgoing.destroy()); return; }
    outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
  }); upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); }); upstream.end(bytes);
});
await new Promise<void>(r => proxy.listen(6274, '127.0.0.1', r));
const control = createServer(async (req, res) => { try {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  if (req.method === 'POST' && req.url === '/D/mode') {
    if ('offline' in body) offline = body.offline === true;
    if ('textUnavailable' in body) textUnavailable = body.textUnavailable === true;
    if ('articleUnavailable' in body) articleUnavailable = body.articleUnavailable === true;
    if ('dropTopic' in body) dropTopic = body.dropTopic === true;
    if ('provider' in body) { assert(['ready', '429', 'timeout'].includes(body.provider)); mode = body.provider;
      store.db.prepare('UPDATE related_provider_cache SET fetched_at=?').run(new Date(Date.now() - 9 * 86400000).toISOString()); }
  } else assert(req.method === 'GET' && req.url === '/D/state');
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: {
    mode, offline, textUnavailable, articleUnavailable, wire, providerCalls, topics: feed.topics.list('cs.CL'), library: store.listLibrary(),
    history: store.listHistory(), annotations: store.listAnnotations(key), pdfCount: store.listLibrary().filter(p => !!store.getPaper(p.paperKey)).length,
  } }));
} catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: String(error) })); } });
await new Promise<void>(r => control.listen(6275, '127.0.0.1', r));
writeFileSync(join(owned, 'runtime/D-private.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:6274', port: 6274, controlPort: 6275,
  deviceId: paired.device.id, deviceToken: paired.deviceToken, hubId: 'D-stage4-isolated', paperKey: key, pdfSha256 }));
writeFileSync(join(owned, 'runtime/server-identity.json'), JSON.stringify({ pid: process.pid, sourceSha, internalPort, proxyPort: 6274, controlPort: 6275, directory, started: new Date().toISOString(), command: process.argv }, null, 2));
console.log(JSON.stringify({ ready: true, pid: process.pid, sourceSha, internalPort, proxyPort: 6274, controlPort: 6275 }));
while (!existsSync(join(owned, 'runtime/stop'))) { await new Promise(r => setTimeout(r, 250)); }
await api.close(); await new Promise<void>(r => proxy.close(() => r())); await new Promise<void>(r => control.close(() => r()));
writeFileSync(join(owned, 'runtime/final-state.json'), JSON.stringify({ wire, providerCalls, library: store.listLibrary(), topics: feed.topics.list('cs.CL'), exitedAt: new Date().toISOString() }, null, 2));
store.db.close();
