import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:19433');
function samplePdf(): Buffer {
  const stream = 'BT /F1 24 Tf 50 735 Td (Fractal Desktop Reader) Tj ET\nBT /F1 16 Tf 50 690 Td (A short paper for the Electron screenshot.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Title (Fractal Desktop Reader) >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
try {
  const page = browser.contexts()[0]?.pages().find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
  assert.ok(page, 'Electron app page is open');
  const url = new URL(page.url()).origin;
  const token = await page.locator('meta[name="paperread-token"]').getAttribute('content');
  assert.ok(token);
  const pdf = samplePdf();
  const response = await fetch(`${url}/api/papers/upload`, {
    method: 'POST',
    headers: { Origin: url, 'x-paperread-token': token, 'Content-Type': 'application/pdf' },
    body: new Uint8Array(pdf),
  });
  if (response.status !== 201) throw new Error(`PDF upload failed: ${response.status} ${await response.text()}`);
  const { data: { paper } } = await response.json() as { data: { paper: { paperKey: string } } };
  await page.goto(`${url}/?capture=1#/library`);
  await page.locator('.paper-row__open').first().click();
  await page.waitForURL((current) => current.hash === `#/paper/${encodeURIComponent(paper.paperKey)}`);
  await page.locator('.pdf-page[data-page="1"] canvas').waitFor();
  await page.locator('.textLayer span').first().waitFor();
  await page.screenshot({ path: resolve('docs/reports/W3-reader.png') });
  console.log(`Captured Electron reader for ${paper.paperKey}`);
} finally {
  await browser.close();
}
