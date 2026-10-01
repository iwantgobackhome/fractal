import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('docs/assets/readme/v020-screens.json', 'utf8'));
assert.equal(manifest.version, '0.2.0');
assert.equal(manifest.screens.length, 5, 'four current discovery captures and the retained reader illustration are required');
const accepted = new Map();
for (const screen of manifest.screens) {
  assert.match(screen.path, /^docs\/assets\/readme\/v020-[a-z0-9-]+\.png$/);
  assert.match(screen.sourceCommit, /^[a-f0-9]{40}$/);
  assert.ok(screen.sourcePath && screen.description);
  assert.ok(!accepted.has(screen.path), 'duplicate screenshot record');
  const bytes = await readFile(screen.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), screen.sha256, screen.path);
  assert.equal(bytes.length, screen.bytes, screen.path);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.readUInt32BE(16), screen.width);
  assert.equal(bytes.readUInt32BE(20), screen.height);
  accepted.set(screen.path, screen);
}
for (const filename of ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md']) {
  const text = await readFile(filename, 'utf8');
  const images = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+\.png)\)/g)].map((match) => ({ alt: match[1], path: match[2] }));
  for (const match of text.matchAll(/<img\b[^>]*src="([^"]+\.png)"[^>]*alt="([^"]*)"[^>]*>/g)) images.push({ path: match[1], alt: match[2] });
  assert.equal(images.length, 5, filename);
  for (const image of images) {
    assert.ok(accepted.has(image.path), `unqualified screenshot in ${filename}: ${image.path}`);
    assert.ok(image.alt.trim().length > 8, `missing meaningful alt text in ${filename}`);
  }
  assert.ok(images.some((image) => accepted.get(image.path).role === 'desktop-hero'));
  assert.ok(images.some((image) => accepted.get(image.path).role === 'desktop-news'));
  assert.ok(images.some((image) => accepted.get(image.path).role === 'android-discovery'));
  assert.ok(images.some((image) => accepted.get(image.path).role === 'android-news'));
  assert.ok(images.some((image) => accepted.get(image.path).role === 'reader-original'));
  assert.ok(text.includes('Releases-Linux%20x64') && text.includes('Releases-macOS%20arm64%20%7C%20x64'), 'Linux/macOS release access must remain visible');
}
console.log(`PASS four README languages use ${accepted.size} byte-verified accepted captures with alt text and Linux/macOS release access`);
