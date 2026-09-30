import { createHash, randomUUID } from 'node:crypto';
import { topicSeeds, type FieldTopic, type FeedItem } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import type { ProviderRegistry } from '../ai/registry';
import { invalidInput, notFound } from '../store/errors';

const idFor = (origin: FieldTopic['origin'], field: string, label: string): string =>
  `${origin}:${field}:${createHash('sha256').update(label.toLocaleLowerCase()).digest('hex').slice(0, 12)}`;
const STOP = new Set(['The', 'This', 'These', 'New', 'Scientists', 'Researchers', 'Study', 'Science', 'Technology', 'News', 'Nature', 'Google News', 'Associated Press']);
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Count named terms once per story, avoiding outlet suffixes and generic headline words. */
export function extractTrending(items: Array<Pick<FeedItem, 'title'>>, field: string): FieldTopic[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const title = item.title.replace(/\s+-\s+[^-]+$/, '');
    const matches = [
      ...title.matchAll(/\b(?:[A-Z][a-zA-Z0-9]+|[A-Z]{2,}[a-z0-9]*)(?:[ -]+(?:[A-Z][a-zA-Z0-9]+|[A-Z]{2,}[a-z0-9]*|\d+(?:\.\d+)?)){0,3}\b/g),
      ...title.matchAll(/\b(?:GPT|Claude|Gemini|Llama|Qwen|DeepSeek|Codex)[ -]?\d+(?:\.\d+)?\b/gi),
    ];
    const unique = new Set(matches.map((match) => clean(match[0])).filter((term) => term.length >= 3 && !STOP.has(term)));
    for (const term of unique) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts].filter(([, score]) => score >= 3).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([label, score]) => ({
    id: idFor('trending', field, label), field, label, query: label, origin: 'trending', followed: false, score,
  }));
}

export class TopicService {
  constructor(private readonly store: SqlitePaperStore, private readonly registry?: ProviderRegistry) {}
  private stored(): FieldTopic[] {
    const row = this.store.db.prepare("SELECT data FROM feed_meta WHERE key='fieldTopics'").get() as { data: string } | undefined;
    return row ? JSON.parse(row.data) as FieldTopic[] : [];
  }
  private save(topics: FieldTopic[]): void {
    this.store.db.prepare("INSERT INTO feed_meta(key,data) VALUES('fieldTopics',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify(topics));
  }
  list(field: string): FieldTopic[] {
    const saved = this.stored().filter((item) => item.field === field);
    const overrides = new Map(saved.map((item) => [item.id, item]));
    const curated = (topicSeeds[field] ?? []).map((label, index): FieldTopic => {
      const id = idFor('curated', field, label);
      return { id, field, label, query: label, origin: 'curated', followed: index < 6, ...overrides.get(id) };
    });
    return [...curated, ...saved.filter((item) => item.origin !== 'curated')];
  }
  followed(fields: string[]): FieldTopic[] { return fields.flatMap((field) => this.list(field).filter((topic) => topic.followed)); }
  follow(id: string, followed: boolean): FieldTopic {
    const all = this.stored();
    const topic = all.find((item) => item.id === id) ?? [...Object.keys(topicSeeds)].flatMap((field) => this.list(field)).find((item) => item.id === id);
    if (!topic) throw notFound('Topic not found.');
    const updated = { ...topic, followed };
    this.save([...all.filter((item) => item.id !== id), updated]);
    return updated;
  }
  add(field: string, label: string, query?: string): FieldTopic {
    if (!field.trim() || !label.trim() || label.length > 100 || (query?.length ?? 0) > 200) throw invalidInput('Invalid topic.');
    const topic: FieldTopic = { id: `user:${randomUUID()}`, field, label: clean(label), query: clean(query || label), origin: 'user', followed: true };
    this.save([...this.stored(), topic]);
    return topic;
  }
  delete(id: string): void {
    const all = this.stored();
    const topic = all.find((item) => item.id === id);
    if (!topic) throw notFound('Topic not found.');
    if (topic.origin !== 'user') throw invalidInput('Only user topics can be deleted.');
    this.save(all.filter((item) => item.id !== id));
  }
  updateTrending(field: string, items: Array<Pick<FeedItem, 'title'>>): void {
    const all = this.stored();
    const previous = new Map(all.filter((topic) => topic.origin === 'trending' && topic.field === field).map((topic) => [topic.id, topic]));
    const curated = new Set(this.list(field).filter((topic) => topic.origin === 'curated').map((topic) => topic.label.toLowerCase()));
    const trending = extractTrending(items, field).filter((topic) => !curated.has(topic.label.toLowerCase())).map((topic) => ({
      ...topic, followed: previous.get(topic.id)?.followed ?? false,
    }));
    this.save([...all.filter((topic) => topic.origin !== 'trending' || topic.field !== field), ...trending]);
  }
  /** Runs after refresh without holding it open. Repeated calls in the same week are no-ops. */
  async suggest(field: string, week: string, headlines: string[]): Promise<void> {
    if (!this.registry || !headlines.length) return;
    const key = `topicSuggestions:${field}`;
    const prior = this.store.db.prepare('SELECT data FROM feed_meta WHERE key=?').get(key) as { data: string } | undefined;
    if (prior?.data === week) return;
    let response = '';
    try {
      // In particular, do not start an AI turn just to discover that no CLI is signed in.
      if (!(await this.registry.providersInfo()).some((provider) => provider.status.installed && provider.status.loggedIn)) return;
      for await (const part of this.registry.complete('digest', {
        system: 'Return only a JSON array of 8 concise current research and news topic names. No markdown. No tools.',
        messages: [{ role: 'user', content: `Field ${field}. Headlines:\n${headlines.slice(0, 20).join('\n').slice(0, 3500)}` }],
      })) if (part.type === 'text') response += part.text;
      const names = JSON.parse(response.trim()) as unknown;
      if (!Array.isArray(names)) return;
      const topics = names.filter((name): name is string => typeof name === 'string' && name.trim().length >= 3 && name.length <= 100).slice(0, 8)
        .map((label): FieldTopic => ({ id: idFor('suggested', field, label), field, label, query: label, origin: 'suggested', followed: false }));
      const all = this.stored();
      this.save([...all.filter((item) => item.origin !== 'suggested' || item.field !== field), ...topics.map((item) => ({ ...item, followed: all.find((old) => old.id === item.id)?.followed ?? false }))]);
      this.store.db.prepare('INSERT INTO feed_meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, week);
    } catch { /* Optional suggestions never block the feed. */ }
  }
}
