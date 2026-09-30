import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../packages/hub/src/main';
import { SqlitePaperStore } from '../packages/hub/src/store/sqlite';
import { FeedService } from '../packages/hub/src/feed/index';
import type { PaperAcquirer } from '../packages/hub/src/api/index';

const mode = process.argv[2] ?? 'limits';
const root = mkdtempSync(join(tmpdir(), 'fractal-w5-live-'));
const setup = new SqlitePaperStore(root);
const feed = new FeedService(setup, {} as PaperAcquirer);
if (mode === 'feed') {
  feed.putInterests({
    categories: ['cs.LG'],
    topics: [],
    authors: [],
    custom: [{ id: 'w5-custom', label: 'Graph neural networks', query: 'graph neural networks' }],
  });
  feed.putSettings({ ...feed.settings(), sources: { arxiv: true, huggingFace: false, news: true, recommendations: false } });
} else {
  feed.putSettings({ ...feed.settings(), sources: { arxiv: false, huggingFace: false, news: false, recommendations: false } });
}
if (mode === 'related') {
  setup.savePaper({
    paperKey: '1706.03762v1',
    sourceKind: 'arxiv',
    arxivId: '1706.03762',
    version: 1,
    title: 'Attention Is All You Need',
    authors: [],
    sourceUrl: 'https://arxiv.org/abs/1706.03762',
    pdfSha256: null,
    pageCount: null,
    extractionVersion: null,
    status: 'fetching',
    coverage: null,
    createdAt: new Date().toISOString(),
  });
}
setup.db.close();

try {
  const service = await startService({ dataDirectory: root, port: 0, log: () => {} });
  try {
    const get = async (path: string) => {
      const response = await fetch(`${service.url}${path}`, { signal: AbortSignal.timeout(180000) });
      return { status: response.status, body: (await response.json()) as { data?: unknown; error?: unknown } };
    };
    if (mode === 'claude-limits') {
      const headers = { Origin: service.url, 'x-paperread-token': service.token, 'Content-Type': 'application/json' };
      const setting = await fetch(`${service.url}/api/ai/settings`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ default: { provider: 'claude', model: 'sonnet' } }),
      });
      const answer = await fetch(`${service.url}/api/library/ask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: 'Reply with one short greeting.' }),
        signal: AbortSignal.timeout(120000),
      });
      const stream = await answer.text();
      let result = await get('/api/ai/limits');
      for (let i = 0; i < 12 && (result.body.data as any)?.accounts?.some((account: any) => account.message?.startsWith('Checking')); i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        result = await get('/api/ai/limits');
      }
      process.stdout.write(
        JSON.stringify(
          {
            mode,
            setting: setting.status,
            answer: answer.status,
            events: [...stream.matchAll(/^event: (\w+)/gm)].map((match) => match[1]),
            limits: result.body.data ?? result.body.error,
          },
          null,
          2,
        ) + '\n',
      );
    } else if (mode === 'limits') {
      let result = await get('/api/ai/limits');
      for (let i = 0; i < 12 && (result.body.data as any)?.accounts?.some((account: any) => account.message?.startsWith('Checking')); i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        result = await get('/api/ai/limits');
      }
      process.stdout.write(JSON.stringify({ mode, status: result.status, limits: result.body.data ?? result.body.error }, null, 2) + '\n');
    } else if (mode === 'feed') {
      const response = await fetch(`${service.url}/api/feed/refresh`, {
        method: 'POST',
        headers: { Origin: service.url, 'x-paperread-token': service.token, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(240000),
      });
      const body = (await response.json()) as { data?: any; error?: unknown };
      const sections = body.data?.sections;
      const items = sections ? ([...sections.top, ...sections.news] as Array<{ image: unknown }>) : [];
      process.stdout.write(
        JSON.stringify(
          {
            mode,
            status: response.status,
            week: body.data?.week,
            counts: sections ? Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, (value as unknown[]).length])) : null,
            custom: sections?.byField?.find((entry: any) => entry.field === 'custom:w5-custom')?.items.length,
            newsByField: sections?.newsByField?.map((entry: any) => ({ field: entry.field, count: entry.items.length })),
            imaged: items.filter((item) => !!item.image).length,
            displayed: items.length,
            sourceStatus: body.data?.sourceStatus,
            error: body.error,
          },
          null,
          2,
        ) + '\n',
      );
    } else if (mode === 'related') {
      const result = await get('/api/papers/1706.03762v1/related');
      const data = result.body.data as any;
      process.stdout.write(
        JSON.stringify(
          {
            mode,
            status: result.status,
            source: data?.source,
            fetchedAt: data?.fetchedAt,
            count: data?.items?.length,
            relations: data?.items
              ? Object.fromEntries(
                  ['similar', 'cites', 'citedBy'].map((relation) => [relation, data.items.filter((item: any) => item.relation === relation).length]),
                )
              : null,
            error: result.body.error,
          },
          null,
          2,
        ) + '\n',
      );
    }
  } finally {
    await service.stop();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
