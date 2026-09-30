import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const output = path.dirname(fileURLToPath(import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return url.origin === 'http://127.0.0.1:47832' ? route.continue() : route.abort();
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const reports = [];
try {
  for (const view of [
    { name: 'desktop-library', width: 1440, height: 900 },
    { name: 'desktop-reader', width: 1440, height: 900 },
    { name: 'tablet-library', width: 1280, height: 800 },
    { name: 'tablet-reader', width: 1280, height: 800 },
    { name: 'phone', width: 360, height: 800 },
  ]) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto(`http://127.0.0.1:47832/?view=${view.name}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(output, `${view.name}.png`), fullPage: true });
    const report = await page.evaluate(() => ({
      title: document.title,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: innerWidth,
      text: document.body.innerText.slice(0, 4500),
      buttons: [...document.querySelectorAll('button')].filter(el => el.getBoundingClientRect().width > 0)
        .map(el => ({ text: el.innerText, label: el.getAttribute('aria-label'), action: el.dataset.action })),
    }));
    reports.push({ ...view, ...report });
  }
  await writeFile(path.join(output, 'prototype-render.json'), JSON.stringify({ errors, reports }, null, 2));
  console.log(JSON.stringify({ errors, reports: reports.map(({ text, buttons, ...report }) => ({ ...report, buttons: buttons.length })) }));
} finally {
  await browser.close();
}
