// All application icons derive from these two SVGs. No runtime dependencies.
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const assets = join(root, 'apps/desktop/assets');
const res = join(root, 'apps/android/app/src/main/res');
const appSvg = await readFile(join(assets, 'brand/app-icon.svg'), 'utf8');
const traySvg = await readFile(join(assets, 'brand/tray.svg'), 'utf8');
// Windows and Linux draw icons edge to edge; only macOS reserves the icon-grid margin.
const smallSvg = await readFile(join(assets, 'brand/app-icon-small.svg'), 'utf8');
const trayColorSvg = await readFile(join(assets, 'brand/tray-color.svg'), 'utf8');
const bodyRect = /<rect\b[^>]*\bx="(\d+)"[^>]*\by="(\d+)"[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(appSvg);
if (!bodyRect) throw new Error('app-icon.svg must start with its body rect');
const fullBleedSvg = appSvg.replace(/viewBox="[^"]*"/, `viewBox="${bodyRect.slice(1).join(' ')}"`);
// Below 48 px the detailed letters blur, so the hand-drawn small mark is used instead.
const desktopSource = (size) => (size <= 32 ? smallSvg : fullBleedSvg);
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const candidates = [
  process.env.FRACTAL_REVIEW_BROWSER,
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {}
}
const browser = await chromium.launch({ executablePath, headless: true });
const temporary = await mkdtemp(join(tmpdir(), 'app-icons-'));
async function output(path, bytes) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, bytes);
}
// PNG-in-ICO avoids platform-specific encoders and retains every resolution.
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, index) => {
    const at = 6 + index * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)]);
}
try {
  const page = await browser.newPage();
  async function render(svg, size) {
    const encoded = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg, size },
    );
    return Buffer.from(encoded, 'base64');
  }
  const images = [];
  const desktop = [];
  for (const size of sizes) {
    images.push({ size, bytes: await render(appSvg, size) });
    const bytes = await render(desktopSource(size), size);
    desktop.push({ size, bytes });
    await output(join(assets, `icon-${size}.png`), bytes);
  }
  await output(join(assets, 'icon.svg'), fullBleedSvg);
  await output(join(assets, 'fractal.ico'), ico(desktop.filter(({ size }) => size <= 256)));
  const iconset = join(temporary, 'app.iconset');
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    await output(join(iconset, `icon_${size}x${size}.png`), images.find((image) => image.size === size).bytes);
    await output(join(iconset, `icon_${size}x${size}@2x.png`), images.find((image) => image.size === size * 2).bytes);
  }
  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(assets, 'fractal.icns')]);
  } else {
    // Standard PNG ICNS chunks also support regenerating on CI without iconutil.
    const chunks = [];
    for (const [size, type] of [
      [16, 'icp4'],
      [32, 'icp5'],
      [64, 'icp6'],
      [128, 'ic07'],
      [256, 'ic08'],
      [512, 'ic09'],
      [1024, 'ic10'],
    ]) {
      const bytes = images.find((image) => image.size === size).bytes;
      const header = Buffer.alloc(8);
      header.write(type);
      header.writeUInt32BE(bytes.length + 8, 4);
      chunks.push(header, bytes);
    }
    const header = Buffer.alloc(8);
    header.write('icns');
    header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
    await output(join(assets, 'fractal.icns'), Buffer.concat([header, ...chunks]));
  }
  await output(join(assets, 'trayTemplate.png'), await render(traySvg, 16));
  await output(join(assets, 'trayTemplate@2x.png'), await render(traySvg, 32));
  await output(join(assets, 'tray-color.png'), await render(trayColorSvg, 16));
  await output(join(assets, 'tray-color@2x.png'), await render(trayColorSvg, 32));
  await output(join(root, 'packages/ui/public/favicon.png'), await render(smallSvg, 32));
  // Adaptive layers are rasterized from the source SVG, so replacing the mark
  // never requires translating its paths into Android vector syntax.
  const body = /<rect\b[^>]*\bfill="([^"]+)"[^>]*\/>/.exec(appSvg);
  if (!body) throw new Error('app-icon.svg must contain a filled body rect');
  const foreground = appSvg.replace(body[0], '');
  const background = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${body[1]}"/></svg>`;
  // Android's foreground safe zone is 66/108 of the adaptive canvas.
  const adaptive = foreground
    .replace(/<svg\b[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(144 144) scale(0.71875)">')
    .replace('</svg>', '</g></svg>');
  const monochrome = adaptive.replace(/#[0-9a-fA-F]{6}/g, '#000000');
  for (const [density, legacySize, adaptiveSize] of [
    ['mdpi', 48, 108],
    ['hdpi', 72, 162],
    ['xhdpi', 96, 216],
    ['xxhdpi', 144, 324],
    ['xxxhdpi', 192, 432],
  ]) {
    await output(join(res, `mipmap-${density}/ic_launcher.png`), await render(appSvg, legacySize));
    for (const [name, svg] of [
      ['foreground', adaptive],
      ['background', background],
      ['monochrome', monochrome],
    ]) {
      await output(join(res, `drawable-${density}/ic_launcher_${name}.png`), await render(svg, adaptiveSize));
    }
  }
  // Remove old XML assets that would override the density-specific generated PNGs.
  for (const name of ['foreground', 'background', 'legacy']) await rm(join(res, `drawable/ic_launcher_${name}.xml`), { force: true });
  await rm(join(res, 'mipmap-anydpi/ic_launcher.xml'), { force: true });
  await output(
    join(res, 'mipmap-anydpi-v26/ic_launcher.xml'),
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@drawable/ic_launcher_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/><monochrome android:drawable="@drawable/ic_launcher_monochrome"/></adaptive-icon>\n',
  );
  console.log('Generated desktop, tray, web, and Android icons from assets/brand SVGs.');
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
