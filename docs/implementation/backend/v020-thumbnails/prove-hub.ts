import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, watchFile, unwatchFile, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startService } from '../../../../packages/hub/src/main';
import { TOKEN_HEADER, type PaperAcquirer } from '../../../../packages/hub/src/api/index';
import { FeedService } from '../../../../packages/hub/src/feed/index';
import type { SqlitePaperStore } from '../../../../packages/hub/src/store/sqlite';
import type { RawItem } from '../../../../packages/hub/src/feed/sources';
import type { FeedResponse, PublicationBookmarkResult } from '@fractal/shared';

const root = resolve('docs/implementation/backend/v020-thumbnails/data');
const profile = join(root, `hub-profile-${Date.now()}`);
const stopFile = join(profile, 'stop');
mkdirSync(profile, { recursive: true });
// Sqlite legacy import is deliberately scoped to this new profile too.
process.env.PAPERREAD_DATA = join(profile, 'unused-legacy');
const service = await startService({ dataDirectory: profile, port: 0, allowRealCli: false, startBackground: false, log: () => {} });
const store = service.store as SqlitePaperStore;
const now = new Date();
const paper: RawItem = {
  id: 'arxiv:2609.40325',
  kind: 'paper',
  title: 'WorldAuditBench: Interactive 3D World Auditing with Multimodal Agents',
  authors: ['Ziyan Jiang', 'Jingbo Yang', 'Jiabao Ji', 'Yujian Liu', 'Qiucheng Wu', 'Tommi Jaakkola', 'Yang Zhang', 'Shiyu Chang'],
  abstract: 'Interactive 3D world auditing.',
  source: 'arxiv',
  url: 'https://arxiv.org/abs/2609.40325v1',
  arxivId: '2609.40325',
  doi: null,
  categories: ['cs.AI'],
  publishedAt: '2026-09-30T00:00:00.000Z',
  popularity: 0,
  image: null,
};
const news: RawItem = {
  ...paper,
  id: 'news:mit-dmd-public-probe',
  kind: 'news',
  title: 'AI generates high-quality images 30 times faster in a single step',
  authors: [],
  abstract: 'MIT CSAIL research news.',
  source: 'news.mit.edu',
  url: 'https://news.mit.edu/2024/ai-generates-high-quality-images-30-times-faster-single-step-0321',
  arxivId: null,
  categories: [],
  publishedAt: '2024-03-21T00:00:00.000Z',
};
const feed = new FeedService(store, {} as PaperAcquirer, undefined, fetch, () => now, [{ id: 'arxiv', load: async () => [paper, news] }], profile);
feed.putSettings({ ...feed.settings(), translateNewsTitles: false });
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const json = async <T>(path: string, method = 'GET'): Promise<T> => {
  const response = await fetch(service.url + path, {
    method,
    headers: { [TOKEN_HEADER]: service.token, origin: service.url, 'content-type': 'application/json' },
  });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return (await response.json()).data as T;
};
try {
  const before = JSON.stringify(store.listLibrary());
  const started = Date.now();
  await feed.refresh(); // Controlled metadata seeds; article/image downloads are actual public GETs.
  const refreshMs = Date.now() - started;
  assert.equal(JSON.stringify(store.listLibrary()), before);
  const response = await json<FeedResponse>('/api/feed');
  const selected = [response.sections.top.find((item) => item.id === paper.id)!, response.sections.news.find((item) => item.id === news.id)!];
  const images = [];
  for (const item of selected) {
    assert(item.image, `No ${item.kind} image`);
    const fetched = await fetch(service.url + item.image.url, { headers: { [TOKEN_HEADER]: service.token } });
    assert.equal(fetched.status, 200);
    const body = Buffer.from(await fetched.arrayBuffer());
    const captured = readFileSync(join(root, `${item.kind}.image`));
    assert.deepEqual(body, captured);
    const source = store.db.prepare('SELECT source_url FROM feed_images WHERE hash=?').get(item.image.url.split('/').at(-1)!) as { source_url: string };
    const publicEvidence = JSON.parse(readFileSync(join(root, `${item.kind}.json`), 'utf8'));
    assert.equal(source.source_url, publicEvidence.image.source);
    const unauthorized = await fetch(service.url + item.image.url);
    // Existing loopback GET guard allows credentialless reads; mutation routes require the token.
    assert.equal(unauthorized.status, 200);
    const repeat = await fetch(service.url + item.image.url, { headers: { [TOKEN_HEADER]: service.token } });
    assert.deepEqual(Buffer.from(await repeat.arrayBuffer()), body);
    writeFileSync(join(root, `${item.kind}.served.image`), body);
    images.push({
      kind: item.kind,
      itemId: item.id,
      article: item.url,
      image: item.image,
      source: source.source_url,
      finalURL: publicEvidence.image.finalURL,
      contentType: fetched.headers.get('content-type'),
      byteLength: body.length,
      sha256: hash(body),
      matchesCapturedPublicBytes: true,
      repeatMatches: true,
      unauthenticatedStatus: unauthorized.status,
    });
  }
  const saved = await json<PublicationBookmarkResult>(`/api/feed/items/${encodeURIComponent(paper.id)}/save`, 'POST');
  const deniedSave = await fetch(service.url + `/api/feed/items/${encodeURIComponent(paper.id)}/save`, {
    method: 'POST',
    headers: { origin: service.url, 'content-type': 'application/json' },
  });
  assert.equal(deniedSave.status, 403);
  const savedBefore = JSON.stringify(store.listLibrary());
  const again = await json<PublicationBookmarkResult>(`/api/feed/items/${encodeURIComponent(paper.id)}/save`, 'POST');
  assert.equal(again.paperKey, saved.paperKey);
  assert.equal(JSON.stringify(store.listLibrary()), savedBefore);
  assert.equal((await json<unknown[]>('/api/library?view=recent')).length, 0);
  const evidence = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    capturedAt: new Date().toISOString(),
    scope: 'controlled metadata seeds with actual public HTML/image discovery and production authenticated HTTP cache routes',
    pid: process.pid,
    executable: process.execPath,
    command: process.argv,
    profile,
    hub: service.url,
    refreshMs,
    images,
    identity: {
      refreshChangedLibrary: false,
      repeatedSaveSamePaperKey: true,
      repeatedSaveChangedLibrary: false,
      savedPaperKey: saved.paperKey,
      recentCount: 0,
      pdfDownloaded: false,
      unauthenticatedSaveStatus: deniedSave.status,
    },
  };
  writeFileSync(join(root, 'hub-evidence.json'), JSON.stringify(evidence, null, 2));
  writeFileSync(join(root, 'runtime.json'), JSON.stringify({ pid: process.pid, profile, stopFile, url: service.url }, null, 2));
  console.log(JSON.stringify(evidence));
  // Coordinator/worker records this process identity and listeners before requesting graceful stop.
  await new Promise<void>((resolve) => {
    if (existsSync(stopFile)) return resolve();
    watchFile(stopFile, { interval: 100 }, () => {
      if (existsSync(stopFile)) {
        unwatchFile(stopFile);
        resolve();
      }
    });
  });
} finally {
  await feed.stop();
  await service.stop();
}
