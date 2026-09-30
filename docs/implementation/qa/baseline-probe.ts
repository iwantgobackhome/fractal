/** Narrow deterministic baseline observations; no real hub, credentials, network or library. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import { ProviderRegistry } from '../../../packages/hub/src/ai/registry';
import { JsonSettingsStore } from '../../../packages/hub/src/ai/settings';
import { handleAi } from '../../../packages/hub/src/api/routes/ai';
import type { AiProvider, CompleteInput, ProviderDelta } from '../../../packages/hub/src/ai/provider';
import { sweepSelection } from '../../../packages/ui/src/lib/highlights';
import { ChatService } from '../../../packages/hub/src/chat';

class FixtureProvider implements AiProvider {
  readonly id = 'codex' as const;
  async status() { return { id: this.id, installed: true, loggedIn: true, version: 'baseline-fixture' }; }
  async listModels() { return [{ id: 'gpt-6-sol', label: 'Fixture' }]; }
  async *complete(_input: CompleteInput): AsyncIterable<ProviderDelta> {
    yield { type: 'text', text: 'Fixture explanation [p.1].' };
  }
  async usage() { return null; }
}

const directory = await mkdtemp(join(tmpdir(), 'fractal-baseline-'));
const previousData = process.env.FRACTAL_DATA;
process.env.FRACTAL_DATA = directory;
let store = new SqlitePaperStore(directory, join(directory, 'empty-legacy'));
try {
  store.ensureRoot();
  const key = '0000.00000v1';
  store.savePaper({ paperKey: key, arxivId: '0000.00000', version: 1, title: 'QA fixture', authors: [],
    sourceUrl: 'https://example.invalid/fixture', pdfSha256: 'a'.repeat(64), pageCount: 1,
    extractionVersion: 'fixture', status: 'ready', coverage: { totalPages: 1, textPages: 1, unsupportedPages: [] }, createdAt: new Date().toISOString() });
  store.saveBlocks(key, [{ blockId: 'fixture-block', paperKey: key, order: 0, kind: 'paragraph',
    sourceText: 'Fixture page text.', sourceHash: 'fixture-hash', regions: [{ page: 1, x: .1, y: .1, width: .5, height: .05 }],
    alignment: 'exact', translatable: true, fontFamily: 'serif', fontWeight: 'normal', fontSize: .02, pageOrdinal: 0 }]);
  const registry = new ProviderRegistry([new FixtureProvider()], new JsonSettingsStore(directory));
  const ctx = { store, registry, librarySearch: { searchLibrary: async () => [] } };
  for (const [route, payload] of [
    ['ask', { question: 'Explain this quote', selectedText: 'selected passage', page: 1 }],
    ['explain', { kind: 'figure', page: 1, bbox: { x: .1, y: .1, width: .3, height: .3 } }],
  ] as const) {
    const request = Readable.from([Buffer.from(JSON.stringify(payload))]) as IncomingMessage;
    const result = await handleAi('POST', ['api', 'papers', key, route], request, ctx);
    const events: unknown[] = [];
    if (result?.kind === 'sse') for await (const event of result.events) events.push(event);
    console.log(JSON.stringify({ route, status: result?.status, events,
      persistedConversation: store.getConversation(key),
      conversationRows: store.db.prepare('SELECT count(*) AS n FROM conversations').get() }));
  }
  store.db.close();
  store = new SqlitePaperStore(directory, join(directory, 'empty-legacy'));
  store.ensureRoot();
  console.log(JSON.stringify({ afterStoreReopen: store.getConversation(key), papers: store.listPapers().length }));
  console.log(JSON.stringify({ implicitLibraryRecord: store.getLibrary(key) }));
  const chat = new ChatService({ store,
    connection: async () => ({ status: 'subscription', modelIds: ['gpt-6-sol'], defaultModelId: 'gpt-6-sol', limits: null }),
    chat: { ask: async () => ({ text: 'Persisted ordinary chat [p.1].', usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 1 } }), forget: async () => {} } });
  await chat.ask(key, { question: 'Ordinary chat persistence control', modelId: 'gpt-6-sol' });
  for (let count = 0; count < 20 && chat.conversation(key).answering; count++) await new Promise((resolve) => setTimeout(resolve, 10));
  if (chat.conversation(key).answering) throw new Error('Fixture chat did not settle');
  store.db.close();
  store = new SqlitePaperStore(directory, join(directory, 'empty-legacy'));
  store.ensureRoot();
  console.log(JSON.stringify({ ordinaryChatAfterStoreReopen: store.getConversation(key) }));
  console.log(JSON.stringify({ partialSpanDrag: { from: { x: 15, y: 15 }, to: { x: 35, y: 15 } },
    selected: sweepSelection([{ rect: { left: 10, top: 10, width: 300, height: 10 },
      text: 'A readable line for highlighting and notes.' }], { x: 15, y: 15 }, { x: 35, y: 15 }) }));
} finally {
  store.db.close();
  if (previousData === undefined) delete process.env.FRACTAL_DATA; else process.env.FRACTAL_DATA = previousData;
  await rm(directory, { recursive: true, force: true });
}
