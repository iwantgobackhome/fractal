import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startService } from '../packages/hub/src/main';
import { SqlitePaperStore } from '../packages/hub/src/store/sqlite';
import { FeedService } from '../packages/hub/src/feed/index';
import type { PaperAcquirer } from '../packages/hub/src/api/index';

const directory = mkdtempSync(join(tmpdir(), 'fractal-feed-live-'));
const setupStore = new SqlitePaperStore(directory);
const emptyAcquirer = {} as PaperAcquirer;
new FeedService(setupStore, emptyAcquirer).putInterests({ categories: ['cs.CL', 'cs.CV'], topics: [], authors: [] });
setupStore.db.close();

try {
  const service = await startService({ dataDirectory: directory, port: 0, indexHtml: resolve('packages/ui/dist/index.html') });
  try {
    const ui = await fetch(service.url);
    const papers = await fetch(`${service.url}/api/papers`);
    const response = await fetch(`${service.url}/api/feed/refresh`, {
      method: 'POST',
      headers: { Origin: service.url, 'x-paperread-token': service.token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const payload = (await response.json()) as { data?: { week: string; sections: Record<string, unknown[]>; sourceStatus: unknown[] }; error?: unknown };
    const feed = payload.data;
    process.stdout.write(
      `${JSON.stringify(
        {
          ui: ui.status,
          papers: papers.status,
          refresh: response.status,
          week: feed?.week,
          counts: feed ? Object.fromEntries(Object.entries(feed.sections).map(([key, value]) => [key, value.length])) : null,
          sourceStatus: feed?.sourceStatus,
          top5: (feed?.sections.top ?? []).slice(0, 5).map((item) => {
            const row = item as { title: string; reason: string };
            return { title: row.title, reason: row.reason };
          }),
          error: payload.error,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await service.stop();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
