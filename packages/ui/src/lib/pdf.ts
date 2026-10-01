import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Size } from './geometry';
import { t } from '../i18n';

// Same-origin worker asset; the document CSP allows 'self' only.
GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/**
 * Load the paper's original PDF from the local service.
 *
 * The URL carries no credential — reads need none — and the bytes never leave
 * this machine.
 */
export async function loadPdf(url: string, signal?: AbortSignal): Promise<PDFDocumentProxy> {
  const task = getDocument({ url });
  const abort = () => void task.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await task.promise;
  } catch (cause) {
    // PDF.js discards the Hub's JSON refusal and includes the request URL in
    // its HTTP error. Recover only the curated cache-identity message.
    const source = new URL(url, window.location.href);
    if (
      !signal?.aborted &&
      (cause as { status?: number })?.status === 409 &&
      source.origin === window.location.origin &&
      /^\/api\/papers\/[^/]+\/pdf$/.test(source.pathname) &&
      !source.search && !source.hash
    ) {
      const failure = await fetch(source.href, { signal })
        .then(async (response) => {
          if (response.status !== 409 || !response.headers.get('content-type')?.startsWith('application/json')) return null;
          if (Number(response.headers.get('content-length')) > 2048) return null;
          const text = await response.text();
          return text.length <= 2048 ? JSON.parse(text) : null;
        })
        .catch(() => null);
      if (
        failure?.error?.code === 'SOURCE_CHANGED' &&
        failure.error.retryable === false &&
        typeof failure.error.message === 'string' &&
        failure.error.message.length <= 240
      )
        throw new Error(failure.error.message);
      throw new Error(t('errors.request'));
    }
    throw cause;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** The page's size at scale 1, which every ratio coordinate is multiplied against. */
export function intrinsicSize(page: PDFPageProxy): Size {
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}
