import type { PdfTextLayout } from '@fractal/shared';
import { pdfTextLayoutSchema } from '@fractal/shared';
import type { SqlitePaperStore } from '../store/sqlite';
import { busy, invalidInput, notFound } from '../store/errors';
import { sha256 } from './index';
import { extractTextPage, TEXT_LAYOUT_VERSION, TEXT_LAYOUT_LIMITS, unavailable } from './text-layout';

type Cached = { data: string };
/** One service per hub; cache survives restart. Disconnected observers do not cancel work.
 * At most two pages extract and four wait, including duplicate PDF keys shared by papers. */
export class PdfTextLayoutService {
  private readonly running = new Map<string, Promise<PdfTextLayout>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  private closing = false;
  constructor(
    readonly store: SqlitePaperStore,
    private readonly extract: typeof extractTextPage = extractTextPage,
  ) {}

  async read(key: string, page: number): Promise<PdfTextLayout> {
    if (!Number.isSafeInteger(page) || page < 1) throw invalidInput('page must be a one-based physical page integer');
    if (!this.store.getPaper(key) && !this.store.getLibrary(key)) throw notFound('Paper not found');
    if (this.closing) throw busy('Text geometry service is closing');
    const bytes = this.store.getPdf(key);
    if (!bytes) return unavailable(key, 'no_pdf', 'No local PDF; import or acquire the PDF before requesting offline text geometry');
    if (bytes.length > TEXT_LAYOUT_LIMITS.bytes) return unavailable(key, 'too_large', 'Local PDF exceeds the 300 MiB geometry limit');
    const digest = sha256(bytes),
      identity = `${digest}:${TEXT_LAYOUT_VERSION}:${page}`;
    const cached = this.store.db.prepare('SELECT data FROM pdf_text_pages WHERE pdf_hash=? AND version=? AND page=?').get(digest, TEXT_LAYOUT_VERSION, page) as
      Cached | undefined;
    if (cached) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cached.data);
      } catch {
        parsed = null;
      }
      const data = pdfTextLayoutSchema.safeParse(parsed);
      if (
        data.success &&
        data.data.status === 'ready' &&
        data.data.pdfSha256 === digest &&
        data.data.extractionVersion === TEXT_LAYOUT_VERSION &&
        data.data.page.page === page
      ) {
        this.store.db
          .prepare('UPDATE pdf_text_pages SET accessed_at=? WHERE pdf_hash=? AND version=? AND page=?')
          .run(Date.now(), digest, TEXT_LAYOUT_VERSION, page);
        return { ...data.data, paperKey: key };
      }
      this.store.db.prepare('DELETE FROM pdf_text_pages WHERE pdf_hash=? AND version=? AND page=?').run(digest, TEXT_LAYOUT_VERSION, page);
    }
    const duplicate = this.running.get(identity);
    if (duplicate) return { ...(await duplicate), paperKey: key };
    if (this.active >= 2 && this.queue.length >= 4) throw busy('Text geometry queue is full; retry this page shortly');
    const work = (async (): Promise<PdfTextLayout> => {
      if (this.active >= 2) await new Promise<void>((resolve) => this.queue.push(resolve));
      else this.active++;
      try {
        const result = await this.extract(bytes, page);
        if ('status' in result) return { ...result, paperKey: key, pdfSha256: digest };
        const data: PdfTextLayout = { status: 'ready', paperKey: key, pdfSha256: digest, extractionVersion: TEXT_LAYOUT_VERSION, ...result };
        const serialized = JSON.stringify(data);
        this.store.db
          .prepare('INSERT OR REPLACE INTO pdf_text_pages SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM papers WHERE pdf_hash=?)')
          .run(digest, TEXT_LAYOUT_VERSION, page, serialized, Buffer.byteLength(serialized), Date.now(), digest);
        // Bound persistent derived data to 128 MiB and 512 pages; oldest access is evicted.
        this.store.db.exec(`DELETE FROM pdf_text_pages WHERE rowid IN (
          SELECT rowid FROM (SELECT rowid,ROW_NUMBER() OVER(ORDER BY accessed_at DESC,rowid DESC) AS n,
          SUM(size) OVER(ORDER BY accessed_at DESC,rowid DESC) AS bytes FROM pdf_text_pages)
          WHERE n>512 OR bytes>134217728)`);
        return data;
      } finally {
        const next = this.queue.shift();
        if (next)
          next(); // transfer this reserved slot; no admission race
        else this.active--;
      }
    })();
    this.running.set(identity, work);
    try {
      return { ...(await work), paperKey: key };
    } finally {
      this.running.delete(identity);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.running.values());
  }
}
