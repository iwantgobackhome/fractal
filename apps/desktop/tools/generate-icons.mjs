// Raster exports from the reviewed vector master; no geometry or dependency changes.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '../../..');
const assets = resolve(root, 'apps/desktop/assets');
const master = await readFile(resolve(root, 'docs/implementation/design/assets/branch-master.svg'), 'utf8');
await writeFile(resolve(assets, 'branch.svg'), master);
const tile = master.replace('<g stroke="currentColor"', '<rect width="40" height="40" rx="4" fill="#F9F7F2"/><g stroke="#282724"');
await writeFile(resolve(assets, 'icon.svg'), tile);
const browser = await chromium.launch({
  executablePath: process.env.FRACTAL_REVIEW_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage();
  const entries = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const base64 = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg: tile, size },
    );
    const bytes = Buffer.from(base64, 'base64');
    await writeFile(resolve(assets, `icon-${size}.png`), bytes);
    entries.push({ size, bytes });
  }
  // Windows ICO supports PNG payloads. Include each native size instead of upscaling.
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, bytes }, index) => {
    const pos = 6 + index * 16;
    header[pos] = header[pos + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(bytes.length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += bytes.length;
  });
  await writeFile(resolve(assets, 'fractal.ico'), Buffer.concat([header, ...entries.map((entry) => entry.bytes)]));
} finally {
  await browser.close();
}
