import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { startService } from '../packages/hub/dist/index.mjs';

const root = mkdtempSync(join(tmpdir(), 'fractal-packaged-book-'));
process.env.PAPERREAD_DATA = join(root, 'no-legacy-data');
const images = process.argv.includes('--images');
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/generate-book-pdf.ts', join(root, 'book.pdf'), ...(images ? ['--images'] : [])]);
const bytes = readFileSync(join(root, 'book.pdf'));
const service = await startService({
  dataDirectory: join(root, 'hub'),
  port: 0,
  indexHtml: resolve('packages/ui/dist/index.html'),
  allowRealCli: false,
  startBackground: false,
  log: () => {},
});
const pings = [];
let probing = false;
const timer = setInterval(async () => {
  if (probing) return;
  probing = true;
  const start = performance.now();
  try {
    await (await fetch(`${service.url}/api/papers`)).text();
    pings.push(performance.now() - start);
  } finally {
    probing = false;
  }
}, 20);
let browser;
try {
  const started = performance.now();
  const response = await fetch(`${service.url}/api/papers/upload`, {
    method: 'POST',
    headers: { Origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/pdf' },
    body: bytes,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  const uploadAndExtractMs = performance.now() - started;
  clearInterval(timer);
  const paper = result.data.paper;
  const extractionPeakRssMiB = Math.round(process.resourceUsage().maxRSS / 1024);
  const snapshot = await (await fetch(`${service.url}/api/papers/${paper.paperKey}`)).text();
  await fetch(`${service.url}/api/preferences`, {
    method: 'PUT',
    headers: { Origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/json' },
    body: JSON.stringify({ uiLanguage: 'en', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: true }),
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const open = performance.now();
  await page.goto(`${service.url}/#/paper/${paper.paperKey}`);
  await page.waitForFunction(
    () => [...document.querySelectorAll('.pdf-page canvas')].some((c) => c.width > 300) && document.querySelectorAll('.textLayer span').length > 0,
  );
  const desktopOpenMs = performance.now() - open;
  const canvases = await page.locator('.pdf-page canvas').count();
  const windows = [];
  page.on('request', (r) => {
    if (r.url().includes('pageStart=')) windows.push(r.url());
  });
  await page.getByTestId('pdf-body').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('[data-testid="page"]')?.textContent?.includes('1232 / 1232'));
  await page.waitForFunction(() => document.querySelector('.pdf-page[data-page="1232"] canvas')?.width > 300);
  console.log(
    JSON.stringify(
      {
        kind: images ? 'images' : 'text',
        pages: paper.pageCount,
        pdfBytes: bytes.length,
        uploadAndExtractMs: Math.round(uploadAndExtractMs),
        extractionPeakRssMiB,
        peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
        maxPingMs: Math.round(Math.max(...pings)),
        snapshotBytes: Buffer.byteLength(snapshot),
        desktopOpenMs: Math.round(desktopOpenMs),
        canvases,
        endPageCanvases: await page.locator('.pdf-page canvas').count(),
        endPageWindowRequested: windows.some((url) => url.includes('pageStart=1231')),
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(timer);
  await browser?.close();
  await service.stop();
  rmSync(root, { recursive: true, force: true });
}
