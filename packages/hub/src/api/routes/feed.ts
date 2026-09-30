import type { IncomingMessage } from 'node:http';
import { feedInterestsInputSchema, feedSettingsSchema } from '@fractal/shared';
import { invalidInput } from '../../store/errors';
import type { FeedService } from '../../feed/index';
import { json, parseRequest, readJson, type Result } from './types';

export async function handleFeed(
  method: string,
  segments: string[],
  request: IncomingMessage,
  ctx: { feed: FeedService; url: URL },
): Promise<Result | undefined> {
  if (segments[0] !== 'api' || segments[1] !== 'feed') return undefined;
  if (segments.length === 4 && segments[2] === 'images' && method === 'GET') {
    const image = await ctx.feed.image(segments[3]!);
    if (!image) throw invalidInput('Image unavailable');
    return { kind: 'bytes', status: 200, body: image.body, contentType: image.contentType, headers: { 'cache-control': 'public, max-age=86400' } };
  }
  if (segments.length === 2 && method === 'GET') return json(ctx.feed.read(ctx.url.searchParams.get('week') ?? undefined));
  if (segments.length === 3 && segments[2] === 'categories' && method === 'GET')
    return json({ items: ctx.feed.categories(ctx.url.searchParams.get('q') ?? '') });
  if (segments[2] === 'topics') {
    if (segments.length === 3 && method === 'GET') {
      const field = ctx.url.searchParams.get('field');
      if (!field) throw invalidInput('Field is required.');
      return json({ topics: ctx.feed.topics.list(field) });
    }
    if (segments.length === 3 && method === 'POST') {
      const body = await readJson(request) as { field?: unknown; label?: unknown; query?: unknown };
      if (!body || typeof body.field !== 'string' || typeof body.label !== 'string' || (body.query !== undefined && typeof body.query !== 'string')) throw invalidInput('Invalid topic.');
      return json(ctx.feed.topics.add(body.field, body.label, body.query as string | undefined), 201);
    }
    if (segments.length === 4) {
      const id = decodeURIComponent(segments[3]!);
      if (method === 'DELETE') { ctx.feed.topics.delete(id); return json({ deleted: true }); }
      if (method === 'PUT') {
        const body = await readJson(request) as { followed?: unknown };
        if (!body || typeof body.followed !== 'boolean') throw invalidInput('Invalid followed state.');
        return json(ctx.feed.topics.follow(id, body.followed));
      }
    }
  }
  if (segments.length === 3 && segments[2] === 'interests') {
    if (method === 'GET') return json({ interests: ctx.feed.interests(), suggestions: ctx.feed.suggestions() });
    if (method === 'PUT') return json(ctx.feed.putInterests(parseRequest(feedInterestsInputSchema, await readJson(request))));
  }
  if (segments.length === 3 && segments[2] === 'settings') {
    if (method === 'GET') return json(ctx.feed.settings());
    if (method === 'PUT') return json(ctx.feed.putSettings(parseRequest(feedSettingsSchema, await readJson(request))));
  }
  if (segments.length === 3 && segments[2] === 'refresh' && method === 'POST') return json(await ctx.feed.refresh());
  if (segments.length === 3 && segments[2] === 'digest' && method === 'GET') {
    const result = ctx.feed.read(ctx.url.searchParams.get('week') ?? undefined);
    return json(result.digest ?? null);
  }
  if (segments.length === 5 && segments[4] === 'save' && segments[2] === 'items' && method === 'POST') {
    let id: string;
    try {
      id = decodeURIComponent(segments[3]!);
    } catch {
      throw invalidInput('항목 ID가 올바르지 않습니다.');
    }
    return json(await ctx.feed.save(id), 201);
  }
  return undefined;
}
