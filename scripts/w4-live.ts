/** Manual live smoke check against the user's Codex CLI login. No credentials are read. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../packages/hub/src/main';
import { EXTRACTION_VERSION } from '../packages/hub/src/pdf/index';
import type { Paper, Block } from '@fractal/shared';

const directory = mkdtempSync(join(tmpdir(), 'fractal-w4-live-'));
const key = '1706.03762v5';
const sourceText =
  'The Transformer follows an encoder-decoder architecture using stacked self-attention and fully connected layers. The encoder maps an input sequence to a sequence of continuous representations, and the decoder generates an output sequence one element at a time.';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const paper: Paper = {
  paperKey: key,
  arxivId: '1706.03762',
  version: 5,
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani'],
  sourceUrl: 'https://arxiv.org/pdf/1706.03762v5',
  pdfSha256: sha(sourceText),
  pageCount: 1,
  extractionVersion: EXTRACTION_VERSION,
  status: 'ready',
  coverage: { totalPages: 1, textPages: 1, unsupportedPages: [] },
  createdAt: new Date().toISOString(),
};
const block: Block = {
  blockId: 'transformer-architecture',
  paperKey: key,
  order: 0,
  kind: 'paragraph',
  sourceText,
  sourceHash: sha(sourceText),
  regions: [{ page: 1, x: 0.1, y: 0.2, width: 0.8, height: 0.15 }],
  alignment: 'exact',
  translatable: true,
  fontFamily: 'serif',
  fontWeight: 'normal',
  fontSize: 0.12,
  pageOrdinal: 1,
};
const service = await startService({ dataDirectory: directory, log: () => {} });
const headers = { Origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/json' };
try {
  service.store.savePaper(paper);
  service.store.saveBlocks(key, [block]);
  const providers = await (await fetch(`${service.url}/api/ai/providers`)).json();
  const codex = providers.data.providers.find((provider: { status: { id: string } }) => provider.status.id === 'codex');
  process.stdout.write(`providers: ${JSON.stringify({ loggedIn: codex.status.loggedIn, detail: codex.status.detail, version: codex.status.version })}\n`);
  if (!codex.status.loggedIn) throw new Error('Codex CLI is not logged in');
  const ask = await fetch(`${service.url}/api/papers/${key}/ask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question: 'Which two components form the Transformer architecture in this paper?',
      selection: { provider: 'codex', model: 'gpt-6-sol' },
    }),
  });
  const answerStream = await ask.text();
  const answer = answerStream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .find((event) => event.type === 'done');
  process.stdout.write(`ask: ${JSON.stringify({ status: ask.status, model: answer?.answer?.model, text: answer?.answer?.text?.slice(0, 350) })}\n`);
  if (!answer || answer.answer.model !== 'gpt-6-sol') throw new Error('Paper question did not complete');
  const started = await (
    await fetch(`${service.url}/api/papers/${key}/translation`, { method: 'POST', headers, body: JSON.stringify({ modelId: 'gpt-6-sol' }) })
  ).json();
  if (!started.data?.job) throw new Error(`Translation did not start: ${JSON.stringify(started.error)}`);
  let job = started.data.job;
  let translations = [];
  for (let attempt = 0; attempt < 150 && job.state === 'running'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await (await fetch(`${service.url}/api/jobs/${job.jobId}`)).json();
    job = response.data.job;
    translations = response.data.translations;
  }
  process.stdout.write(
    `translation: ${JSON.stringify({ state: job.state, model: job.modelId, result: translations[0]?.text?.slice(0, 350), error: translations[0]?.error?.code })}\n`,
  );
  if (job.state !== 'completed' || !translations[0]?.text) throw new Error('Page translation did not complete');
} finally {
  await service.stop();
  rmSync(directory, { recursive: true, force: true });
}
