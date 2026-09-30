import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { startService } from '../packages/hub/src/main';
import { SqlitePaperStore } from '../packages/hub/src/store/sqlite';
import { FeedService } from '../packages/hub/src/feed/index';
import type { PaperAcquirer } from '../packages/hub/src/api/index';

const root = mkdtempSync(join(tmpdir(), 'fractal-w6-live-'));
const setup = new SqlitePaperStore(root);
const feed = new FeedService(setup, {} as PaperAcquirer);
feed.putInterests({ categories: ['cs.AI'], topics: [], authors: [], custom: [] });
feed.putSettings({ ...feed.settings(), sources: { arxiv: true, huggingFace: false, news: true, recommendations: false }, translateNewsTitles: true });
setup.putPreferences({ ...setup.getPreferences(), uiLanguage: 'ko' });
setup.db.close();
try {
  const service = await startService({ dataDirectory: root, port: 0, log: () => {} });
  try {
    const headers = { Origin: service.url, 'x-paperread-token': service.token, 'Content-Type': 'application/json' };
    const request = async (path: string, body?: object) => {
      const response = await fetch(`${service.url}${path}`, {
        method: body ? 'POST' : 'GET',
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(240000),
      });
      const json = (await response.json()) as { data?: any; error?: any };
      return { status: response.status, data: json.data, error: json.error };
    };
    const providers = await request('/api/ai/providers');
    const connection = await request('/api/connection');
    const refreshed = await request('/api/feed/refresh', {});
    const sections = refreshed.data?.sections;
    let topics = await request('/api/feed/topics?field=cs.AI');
    for (let i = 0; i < 12 && !(topics.data?.topics ?? []).some((topic: any) => topic.origin === 'suggested'); i++) {
      await new Promise((done) => setTimeout(done, 3000));
      topics = await request('/api/feed/topics?field=cs.AI');
    }
    const news = [
      ...(sections?.newsByTopic ?? []).flatMap((section: any) => section.items),
      ...(sections?.newsByField ?? []).flatMap((section: any) => section.items),
      ...(sections?.generalNews ?? []),
    ];
    const article = async (items: any[]) => {
      for (const item of items.slice(0, 3)) {
        const result = await request(`/api/news/article?url=${encodeURIComponent(item.url)}`);
        if (result.status === 200)
          return { source: item.source, title: result.data?.title, finalUrl: result.data?.finalUrl, blocks: result.data?.blocks?.length };
      }
      return null;
    };
    const google = await article([
      {
        source: 'Google News RSS / CBS News',
        url: 'https://news.google.com/rss/articles/CBMif0FVX3lxTE9tRjZqS3R6VW1rR1UtMU9raVlfRnR0OFNZV1dGSWhIVDZYelFabjdjWTl3cmxMcEprRDQ0bDQzb2dxQUEzWk9GMS0wNU9SdG8yczRnTzh2WUxNWDdJVkFEaGZBcTZyMVJiOFpZQkFwTlVTY00tancyb25NWlpWc3M?oc=5',
      },
      ...news.filter((item: any) => new URL(item.url).hostname === 'news.google.com'),
    ]);
    const bing = await article(news.filter((item: any) => item.source === 'www.bing.com'));
    const translation = await request('/api/translate/quick', {
      texts: ['New AI model released', 'Researchers compared the results across several studies.'],
      target: 'ko',
    });
    process.stdout.write(
      JSON.stringify(
        {
          providers: providers.data?.providers?.map((entry: any) => ({ id: entry.status?.id, loggedIn: entry.status?.loggedIn, detail: entry.status?.detail })),
          connection: connection.status,
          refresh: refreshed.status,
          sourceStatus: refreshed.data?.sourceStatus?.filter((entry: any) => entry.source === 'news'),
          topics: topics.data?.topics?.map((topic: any) => ({ label: topic.label, origin: topic.origin, followed: topic.followed, score: topic.score })),
          topicNews: sections?.newsByTopic?.map((section: any) => ({ topic: section.label, count: section.items.length })),
          newsByField: sections?.newsByField?.map((section: any) => ({ field: section.field, count: section.items.length })),
          general: sections?.generalNews?.length,
          translatedTitle: news.find((item: any) => item.titleTranslated)?.titleTranslated,
          googleArticle: google,
          bingArticle: bing,
          quick: { status: translation.status, engine: translation.data?.engine, translations: translation.data?.translations, error: translation.error },
          error: refreshed.error,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await service.stop();
  }
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('fractal-w6-live-')) throw new Error('Unsafe probe directory');
  rmSync(root, { recursive: true, force: true });
}
