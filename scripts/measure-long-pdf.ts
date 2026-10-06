import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Translator } from '@fractal/shared';
import { execFileSync } from 'node:child_process';
import { extractPdf, sha256 } from '../packages/hub/src/pdf/index';
import { SqlitePaperStore } from '../packages/hub/src/store/sqlite';
import { JobManager } from '../packages/hub/src/jobs/state';
import { TranslationPipeline } from '../packages/hub/src/translation/index';
import { createApiServer, type ApiServerOptions } from '../packages/hub/src/api/index';
import { servedAssets } from '../packages/hub/src/main';

const root = mkdtempSync(join(tmpdir(), 'fractal-1232-'));
const images = process.argv.includes('--images');
// Fixture construction is a separate process so its allocations do not count as hub RSS.
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/generate-book-pdf.ts', join(root, 'book.pdf'), ...(images ? ['--images'] : [])]);
const bytes = readFileSync(join(root, 'book.pdf'));
const store = new SqlitePaperStore(root);
const jobs = new JobManager(store);
const checkTranslation = process.argv.includes('--check-translation');
const translator = {
  connection: async () => ({
    status: checkTranslation ? 'subscription' : 'signed_out',
    modelIds: checkTranslation ? ['gpt-6-sol'] : [],
    defaultModelId: checkTranslation ? 'gpt-6-sol' : null,
    limits: null,
  }),
  translatePage: async (input: Parameters<Translator['translatePage']>[0]) => ({
    results: input.paragraphs.map((p) => ({ number: p.number, text: `Translated: ${p.block.sourceText}` })),
    usage: { inputTokens: null, outputTokens: null, limits: null, observedAt: null },
  }),
  disconnect: async () => {},
} as unknown as Translator;
const server = createApiServer({
  store,
  jobs,
  translator,
  pipeline: new TranslationPipeline({ store, jobs, translator }),
  acquirer: {} as ApiServerOptions['acquirer'],
  paperChat: {
    ask: async () => {
      throw new Error('unused');
    },
    forget: async () => {},
  },
  clientHtml: () => readFileSync(resolve('packages/ui/dist/index.html'), 'utf8'),
  clientAssets: servedAssets(resolve('packages/ui/dist/assets')),
});
const address = await server.listen(0),
  url = `http://127.0.0.1:${address.port}`;
const latencies: number[] = [];
let probing = false;
const probe = async () => {
  if (probing) return;
  probing = true;
  const start = performance.now();
  try {
    await (await fetch(`${url}/api/papers`)).text();
    latencies.push(performance.now() - start);
  } finally {
    probing = false;
  }
};
const timer = setInterval(() => void probe(), 20);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const start = performance.now();
  const extracted = await extractPdf(bytes, '2501.00001v1');
  const extractionMs = performance.now() - start;
  clearInterval(timer);
  await probe();
  const key = '2501.00001v1';
  store.savePaper(
    {
      paperKey: key,
      arxivId: '2501.00001',
      version: 1,
      title: 'Synthetic 1232-page book',
      authors: [],
      sourceUrl: 'https://arxiv.org/pdf/2501.00001v1',
      pdfSha256: sha256(bytes),
      pageCount: 1232,
      extractionVersion: extracted.extractionVersion,
      status: 'ready',
      coverage: extracted.coverage,
      createdAt: new Date().toISOString(),
    },
    bytes,
  );
  store.saveBlocks(key, extracted.blocks);
  const snapshot = await (await fetch(`${url}/api/papers/${key}`)).text();
  let desktopOpenMs: number | null = null,
    canvases: number | null = null;
  if (!process.argv.includes('--no-browser')) {
    await fetch(`${url}/api/preferences`, {
      method: 'PUT',
      headers: { Origin: url, 'x-paperread-token': server.token, 'content-type': 'application/json' },
      body: JSON.stringify({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }),
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const started = performance.now();
    page.setDefaultTimeout(30_000);
    await page.goto(`${url}/#/paper/${key}`);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLCanvasElement>('.pdf-page canvas')].some((c) => c.width > 300) &&
        document.querySelectorAll('.textLayer span').length > 0,
    );
    desktopOpenMs = performance.now() - started;
    canvases = await page.locator('.pdf-page canvas').count();
    await page.screenshot({ path: join(root, 'desktop.png') });
    if (checkTranslation) {
      await page.getByRole('button', { name: 'Translate pages', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Translate page range' });
      assert.equal(await dialog.getByLabel('From page').inputValue(), '1');
      assert.equal(await dialog.getByLabel('Through page').inputValue(), '30');
      await dialog.getByLabel('From page').fill('100');
      await dialog.getByLabel('Through page').fill('129');
      await dialog.getByRole('button', { name: 'Translate this range' }).click();
      await page.getByRole('button', { name: 'Translate next 30 pages', exact: true }).click();
      assert.equal(await dialog.getByLabel('From page').inputValue(), '130');
      assert.equal(await dialog.getByLabel('Through page').inputValue(), '159');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Translation', exact: true }).click();
      await page.getByRole('button', { name: 'Translate this section', exact: true }).first().waitFor();
      assert.equal(store.listTranslations(key).filter((t) => t.status === 'completed').length, 30);
      console.log('PASS long-book range dialog defaults, selected pages 100-129, next 30 pages, and source-page fallback');
    }
  }
  console.log(
    JSON.stringify(
      {
        kind: images ? 'images' : 'text',
        pages: 1232,
        pdfBytes: bytes.length,
        blocks: extracted.blocks.length,
        extractionMs: Math.round(extractionMs),
        peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
        maxPingMs: Math.round(Math.max(...latencies)),
        snapshotBytes: Buffer.byteLength(snapshot),
        desktopOpenMs: desktopOpenMs === null ? null : Math.round(desktopOpenMs),
        canvases,
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(timer);
  await browser?.close();
  await server.close();
  store.db.close();
  rmSync(root, { recursive: true, force: true });
}
