// Export the accepted icon.svg without changing existing Windows/window/tray assets.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const assets = resolve(import.meta.dirname, '../assets');
const svg = await readFile(resolve(assets, 'icon.svg'), 'utf8');
const executablePath = process.env.FRACTAL_REVIEW_BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const chunks = [];
  for (const [size, type] of [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]) {
    const encoded = await page.evaluate(async ({ svg, size }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    const bytes = Buffer.from(encoded, 'base64');
    if (size === 512) await writeFile(resolve(assets, 'icon-512.png'), bytes);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(bytes.length + 8, 4);
    chunks.push(header, bytes);
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, bytes) => sum + bytes.length, 0), 4);
  await writeFile(resolve(assets, 'fractal.icns'), Buffer.concat([header, ...chunks]));
} finally {
  await browser.close();
}
