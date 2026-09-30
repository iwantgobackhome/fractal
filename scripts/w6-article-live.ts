import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { startService } from '../packages/hub/src/main';
import { SqlitePaperStore } from '../packages/hub/src/store/sqlite';
import { FeedService } from '../packages/hub/src/feed/index';
import type { PaperAcquirer } from '../packages/hub/src/api/index';

const root = mkdtempSync(join(tmpdir(), 'fractal-w6-article-'));
const store = new SqlitePaperStore(root);
const feed = new FeedService(store, {} as PaperAcquirer);
feed.putSettings({ ...feed.settings(), sources: { arxiv: false, huggingFace: false, news: false, recommendations: false } });
store.db.close();
try {
  const service = await startService({ dataDirectory: root, port: 0, log: () => {} });
  try {
    const url =
      'https://news.google.com/rss/articles/CBMif0FVX3lxTE9tRjZqS3R6VW1rR1UtMU9raVlfRnR0OFNZV1dGSWhIVDZYelFabjdjWTl3cmxMcEprRDQ0bDQzb2dxQUEzWk9GMS0wNU9SdG8yczRnTzh2WUxNWDdJVkFEaGZBcTZyMVJiOFpZQkFwTlVTY00tancyb25NWlpWc3M?oc=5';
    const response = await fetch(`${service.url}/api/news/article?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000) });
    const body = (await response.json()) as { data?: any; error?: any };
    process.stdout.write(
      JSON.stringify(
        { status: response.status, title: body.data?.title, finalUrl: body.data?.finalUrl, blocks: body.data?.blocks?.length, error: body.error },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await service.stop();
  }
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('fractal-w6-article-')) throw new Error('Unsafe probe directory');
  rmSync(root, { recursive: true, force: true });
}
