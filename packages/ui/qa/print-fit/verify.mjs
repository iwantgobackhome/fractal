import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const directory = fileURLToPath(new URL('.', import.meta.url));
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  await mkdir(`${directory}artifacts`, { recursive: true });
  for (const [name, mode, paragraphs, continuation] of [
    ['split-fit', 'split', 5, false],
    ['translation-fit', 'translation', 5, false],
    ['split-continuation', 'split', 35, true],
  ]) {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}qa/print-fit/fixture.html?mode=${mode}&paragraphs=${paragraphs}`);
    await page.waitForSelector('body[data-print-ready="true"]');
    await page.emulateMedia({ media: 'print' });
    const sheets = await page.locator('.print-sheet').count();
    const continuations = await page.locator('[data-continuation]').count();
    if (continuation) assert.ok(continuations > 0);
    else assert.equal(sheets, 2);
    assert.equal(await page.locator('.print-continuation-label').count(), continuations);
    const scales = await page
      .locator('.print-sheet:not([data-continuation]) .print-translation-content')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transform));
    await page.pdf({ path: `${directory}artifacts/${name}.pdf`, printBackground: true, preferCSSPageSize: true });
    // Capture the print DOM as well as the PDF for quick inspection.
    await page.screenshot({ path: `${directory}artifacts/${name}.png`, fullPage: true });
    results.push({ name, sheets, continuations, scales });
    await page.close();
  }
  await writeFile(`${directory}artifacts/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await server.close();
}
