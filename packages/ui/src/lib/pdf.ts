import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Size } from './geometry';

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
    if (!signal?.aborted && (cause as { status?: number })?.status === 409) {
      const failure = await fetch(url, { signal })
        .then(async (response) => (response.status === 409 ? response.json() : null))
        .catch(() => null);
      if (
        failure?.error?.code === 'SOURCE_CHANGED' &&
        typeof failure.error.message === 'string' &&
        failure.error.message.length <= 240
      )
        throw new Error(failure.error.message);
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
