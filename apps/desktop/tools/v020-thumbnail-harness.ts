/** Isolated layout metadata; actual public HTML/PNG bytes supplied by the backend worker. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { startService } from '@qa/hub/main';
import { SqlitePaperStore } from '@qa/hub/store/sqlite';
import { FeedImageStore } from '@qa/hub/feed/images';
import { extractArticleHtml } from '@qa/hub/feed/article';
import { isoWeek } from '@qa/hub/feed/index';
import { JsonDeviceStore } from '@qa/hub/pairing/store';

const root = resolve('.');
const owned = join(root, 'apps/android/qa/v020-thumbnails/data');
const documentation = process.env.QA_DOCUMENTATION === '1';
const suffix = documentation ? '-documentation' : '';
const metadata = documentation ? JSON.parse(readFileSync(join(root, 'docs/implementation/desktop/v020-thumbnails/publication-metadata.json'), 'utf8')) : null;
const port = documentation ? 6296 : 6294;
const controlPort = port + 1;
mkdirSync(owned, { recursive: true });
const supplyRoot = resolve(process.env.QA_IMAGE_SUPPLY!);
const backendRoot = resolve(process.env.QA_BACKEND_ROOT!);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const evidence: any = {
  clientSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  backendSha: execFileSync('git', ['-C', backendRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  metadata: documentation
    ? 'Actual publication metadata from official arXiv abstract and MIT News pages; isolated cached feed, not a live gathering claim'
    : 'Controlled layout metadata, not a gathering-success claim',
  images: [],
  wire: [],
};
function seed(directory: string) {
  const store = new SqlitePaperStore(directory, join(directory, 'no-legacy'));
  store.ensureRoot();
  store.putPreferences({ uiLanguage: 'en', translationLanguage: 'en', answerLanguage: 'auto', onboardingCompleted: true });
  const images = new FeedImageStore(store, directory);
  const registered: any = {};
  for (const name of ['paper', 'news']) {
    const supply = JSON.parse(readFileSync(join(supplyRoot, `${name}.json`), 'utf8'));
    const body = readFileSync(join(supplyRoot, `${name}.image`));
    if (sha(body) !== supply.image.sha256) throw Error('Actual public image supply hash mismatch');
    const image = {
      ...images.register(supply.image.source)!,
      ...supply.image.dimensions,
      alt: name === 'paper' ? 'WorldAuditBench Figure 1: anomaly taxonomy' : 'MIT news: diffusion image synthesis comparison',
    };
    const hash = image.url.split('/').at(-1)!;
    copyFileSync(join(supplyRoot, `${name}.image`), join(directory, 'feed-images', hash));
    store.db
      .prepare('UPDATE feed_images SET content_type=?,size=?,accessed_at=? WHERE hash=?')
      .run(supply.image.contentType, body.length, new Date().toISOString(), hash);
    registered[name] = image;
    evidence.images.push({ directory, name, publicSource: supply.image.source, contentSha: sha(body), bytes: body.length, image });
  }
  const now = new Date().toISOString(),
    week = isoWeek(new Date());
  const common = {
    authors: ['Controlled layout metadata'],
    abstract:
      'The figure and reporting images are actual public bytes selected by the backend. This isolated metadata exercises the scholarly list, dossier, and compact text fallback.',
    categories: ['cs.AI'],
    publishedAt: now,
    popularity: 0,
    topicIds: ['qa-topic'],
    dateBasis: 'observed',
  };
  const paper = {
    ...common,
    id: 'qa-paper',
    kind: 'paper',
    source: 'arxiv',
    title: 'WorldAuditBench: physical, spatial, temporal and semantic inconsistencies',
    url: 'https://arxiv.org/abs/2609.40325v1',
    arxivId: '2609.40325v1',
    image: registered.paper,
    publication: { year: 2026, venue: 'arXiv', publicationKind: 'preprint', oaAvailability: 'open', sources: ['arxiv'] },
  };
  const news = {
    ...common,
    id: 'qa-news',
    kind: 'news',
    source: 'news:MIT News',
    title: 'AI generates high-quality images 30 times faster in a single step',
    url: 'https://news.mit.edu/2024/ai-generates-high-quality-images-30-times-faster-single-step-0321',
    image: registered.news,
  };
  if (documentation) {
    Object.assign(paper, metadata.paper, { source: 'arxiv', dateBasis: 'published' });
    Object.assign(paper.publication, { publicationDate: metadata.paper.publishedAt.slice(0, 10) });
    Object.assign(news, metadata.news, { source: 'news:MIT News', dateBasis: 'published' });
  }
  const rows = documentation
    ? [paper, news]
    : [
        paper,
        {
          ...paper,
          id: 'qa-absent',
          arxivId: null,
          title: 'Text-only research remains compact and readable',
          image: null,
          url: 'https://example.org/paper-absent',
        },
        {
          ...paper,
          id: 'qa-broken',
          arxivId: null,
          title: 'Unavailable figure retains the title, metadata and controls',
          image: { url: '/api/feed/images/' + 'b'.repeat(64) },
          url: 'https://example.org/paper-broken',
        },
        news,
        {
          ...news,
          id: 'qa-news-absent',
          title: 'Text-only news stays useful without an empty picture card',
          image: null,
          url: 'https://example.org/news-absent',
        },
        {
          ...news,
          id: 'qa-news-broken',
          title: 'A failed news image leaves its headline and source available',
          image: { url: '/api/feed/images/' + 'b'.repeat(64) },
          url: 'https://example.org/news-broken',
        },
      ];
  for (const row of rows) store.db.prepare('INSERT OR REPLACE INTO feed_items VALUES(?,?,?)').run(week, row.id, JSON.stringify(row));
  for (const [key, value] of Object.entries({
    interests: { categories: ['cs.AI'], topics: [], authors: [], custom: [] },
    settings: {
      sources: { arxiv: false, huggingFace: false, news: false, recommendations: false, openAlex: false, crossref: false },
      customRssFeeds: [],
      digestEnabled: false,
      refreshIntervalHours: 24,
      translateNewsTitles: false,
    },
    [`generated:${week}`]: now,
    sourceStatus: [],
  }))
    store.db.prepare('INSERT OR REPLACE INTO feed_meta VALUES(?,?)').run(key, JSON.stringify(value));
  const article = extractArticleHtml(readFileSync(join(supplyRoot, 'news.html'), 'utf8'), news.url, news.url, images);
  if (!article?.blocks.length) throw Error('Public HTML extraction failed');
  if (documentation) Object.assign(article, { title: metadata.news.title, author: metadata.news.authors[0], publishedAt: metadata.news.publishedAt });
  store.db.prepare('INSERT OR REPLACE INTO news_articles VALUES(?,?,?)').run(news.url, JSON.stringify(article), now);
  const devices = new JsonDeviceStore(directory);
  const paired = devices.claim('Thumbnail isolated native QA', 'android');
  store.db.close();
  return paired;
}
const desktopDirectory = join(owned, 'desktop-hub' + suffix),
  directory = join(owned, 'android-hub' + suffix);
seed(desktopDirectory);
const paired = seed(directory);
const service = await startService({ dataDirectory: directory, port, allowRealCli: false, startBackground: false, log() {} });
const control = createServer(async (req, res) => {
  if (req.url === '/qa/state') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        library: service.store.listLibrary(),
        history: service.store.listHistory(),
        ...evidence,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((r) => control.listen(controlPort, '127.0.0.1', r));
writeFileSync(
  join(owned, 'private' + suffix + '.json'),
  JSON.stringify({
    baseUrl: service.url,
    controlPort,
    hubId: 'v020-thumbnails-exclusive-5572',
    deviceId: paired.device.id,
    deviceToken: paired.deviceToken,
  }),
);
writeFileSync(join(owned, 'supply-evidence' + suffix + '.json'), JSON.stringify(evidence, null, 2));
writeFileSync(
  join(owned, 'server-identity' + suffix + '.json'),
  JSON.stringify(
    {
      pid: process.pid,
      startedUtc: new Date().toISOString(),
      listeners: [port, controlPort],
      desktopDirectory,
      directory,
      command: process.argv,
      clientSha: evidence.clientSha,
      backendSha: evidence.backendSha,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ ready: true, pid: process.pid, listeners: [port, controlPort] }));
while (!existsSync(join(owned, 'stop' + suffix))) await new Promise((r) => setTimeout(r, 250));
writeFileSync(
  join(owned, 'final-state' + suffix + '.json'),
  JSON.stringify({ ...evidence, library: service.store.listLibrary(), history: service.store.listHistory() }, null, 2),
);
await service.stop();
await new Promise<void>((r) => control.close(() => r()));
