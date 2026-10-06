import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, openSync, closeSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { SqlitePaperStore } from '../../store/sqlite';
import { sha256 } from '../../pdf/index';
import { largePdfResult } from './large-pdf';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
it('streams book ranges without reading a whole-file Buffer and invalidates hash verification after a file change', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fractal-book-range-'));
  roots.push(root);
  const store = new SqlitePaperStore(root);
  const bytes = Buffer.alloc(11 * 1024 * 1024, 32),
    key = '2501.00001v1';
  store.savePaper(
    {
      paperKey: key,
      arxivId: '2501.00001',
      version: 1,
      title: 'Book',
      authors: [],
      sourceUrl: 'https://arxiv.org/pdf/2501.00001v1',
      pdfSha256: sha256(bytes),
      pageCount: 1232,
      extractionVersion: 'test',
      status: 'ready',
      coverage: { totalPages: 1232, textPages: 1232, unsupportedPages: [] },
      createdAt: new Date().toISOString(),
    },
    bytes,
  );
  const request = (headers: Record<string, string>) => Object.assign(Readable.from([]), { headers }) as IncomingMessage;
  vi.spyOn(store, 'getPdf').mockImplementation(() => {
    throw new Error('Whole-file allocation');
  });
  try {
    expect(await largePdfResult(store, key, request({ range: 'bytes=100-199' }))).toMatchObject({
      kind: 'file',
      status: 206,
      from: 100,
      to: 199,
      headers: { 'content-range': `bytes 100-199/${bytes.length}` },
    });
    expect(await largePdfResult(store, key, request({ 'if-none-match': `"${sha256(bytes)}"` }))).toMatchObject({ status: 304 });
    expect(await largePdfResult(store, key, request({ range: 'bytes=-100' }))).toMatchObject({ status: 206, from: bytes.length - 100, to: bytes.length - 1 });
    expect(await largePdfResult(store, key, request({ range: 'bytes=1-999999999' }))).toMatchObject({ status: 416 });
    const fd = openSync(store.getPdfPath(key)!, 'r+');
    try {
      writeSync(fd, Buffer.from('!'), 0, 1, 100);
    } finally {
      closeSync(fd);
    }
    await expect(largePdfResult(store, key, request({}))).rejects.toMatchObject({ error: { code: 'SOURCE_CHANGED' } });
  } finally {
    store.db.close();
  }
});
