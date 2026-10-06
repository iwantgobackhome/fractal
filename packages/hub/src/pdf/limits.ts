/** Shared limits for locally stored books and individual page geometry. */
export const PDF_LIMITS = { pages: 3000, bytes: 300 * 1024 * 1024, automaticTranslationPages: 300, translationRangePages: 30 };

/** Yield between pages even when PDF.js resolves from its in-process cache. */
export const yieldPdfPage = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Each decode has its own deadline; a large book never shares a single global timer. */
export async function decodePdfPage<T>(work: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PDF page decoding timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
