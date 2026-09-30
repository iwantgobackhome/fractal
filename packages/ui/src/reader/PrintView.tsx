import { useCallback, useEffect, useRef, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { Block, Translation } from '@fractal/shared';
import { KoreanPageView } from '../components/KoreanPane';
import { PageCanvas } from '../components/PdfPane';
import type { Size } from '../lib/geometry';
import type { PDFDocumentProxy } from '../lib/pdf';

export type PrintMode = 'translation' | 'split';

interface Props {
  mode: PrintMode;
  doc: PDFDocumentProxy;
  pageCount: number;
  blocks: Block[];
  translations: Translation[];
  pageIntrinsicSize(page: number): Size;
  /** Called once every page is laid out and drawn. */
  onReady(): void;
}

/** CSS pixels of an A4 page's printable width (portrait) and of half a landscape A4 sheet. */
const PORTRAIT_WIDTH = 718;
const HALF_LANDSCAPE_WIDTH = 520;
const noop = () => undefined;

/**
 * Every page of the paper laid out for paper, outside the reading view: the translated
 * pages alone, or each original page beside its translation. It lives in its own root
 * that only print media shows, and reports when the last page has been drawn.
 */
export function PrintView({ mode, doc, pageCount, blocks, translations, pageIntrinsicSize, onReady }: Props): JSX.Element {
  const reported = useRef(new Set<number>());
  // The parent re-renders while pages draw; the latest callback is kept without restarting anything.
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const done = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const width = mode === 'translation' ? PORTRAIT_WIDTH : HALF_LANDSCAPE_WIDTH;
  const zoomFor = (page: number) => width / Math.max(1, pageIntrinsicSize(page).width);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    // Canvases render after their layout is reported; give the last ones a moment.
    window.setTimeout(() => readyRef.current(), 900);
  }, []);

  const onHeight = useCallback(
    (page: number) => {
      reported.current.add(page);
      if (reported.current.size >= pageCount) finish();
    },
    [pageCount, finish],
  );

  // A page with nothing to lay out never reports; do not wait on it forever.
  useEffect(() => {
    const timer = window.setTimeout(finish, 20_000 + pageCount * 1_000);
    return () => window.clearTimeout(timer);
  }, [finish, pageCount]);

  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  const pageStyle = mode === 'translation' ? '@page { size: A4 portrait; margin: 10mm; }' : '@page { size: A4 landscape; margin: 8mm; }';

  return createPortal(
    <div ref={rootRef} className={`print-root print-root--${mode}`} aria-hidden="true">
      <style>{pageStyle}</style>
      {pages.map((page) => (
        <section key={page} className="print-sheet">
          {mode === 'split' ? (
            <div className="print-sheet__original">
              <PageCanvas doc={doc} page={page} zoom={zoomFor(page)} dpr={2} onSize={noop} registerPage={noop} />
            </div>
          ) : null}
          <div className="print-sheet__translation">
            <KoreanPageView
              doc={doc}
              page={page}
              zoom={zoomFor(page)}
              dpr={2}
              blocks={blocks}
              translations={translations}
              placeholder={{ width, height: width * 1.4 }}
              onHeight={onHeight}
              onSelectBlock={noop}
            />
          </div>
        </section>
      ))}
    </div>,
    document.body,
  );
}
