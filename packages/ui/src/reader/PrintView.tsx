import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { Block, Translation } from '@fractal/shared';
import { KoreanPageView } from '../components/KoreanPane';
import { PageCanvas } from '../components/PdfPane';
import { t } from '../i18n';
import type { Size } from '../lib/geometry';
import type { PDFDocumentProxy } from '../lib/pdf';
import { fitPrintPage, printDimensions, type PrintMode } from '../lib/print-fit';

export type { PrintMode } from '../lib/print-fit';

interface Props {
  mode: PrintMode;
  doc: PDFDocumentProxy;
  pageCount: number;
  blocks: Block[];
  translations: Translation[];
  pageIntrinsicSize(page: number): Size;
  /** Called once every page is measured, fitted and drawn. */
  onReady(): void;
}

const noop = () => undefined;

function PrintPage({ page, onFitted, ...props }: Omit<Props, 'onReady'> & { page: number; onFitted(page: number): void }): JSX.Element {
  const { mode, doc, blocks, translations, pageIntrinsicSize } = props;
  const dimensions = printDimensions(mode);
  const width = dimensions.columnWidth;
  const intrinsic = pageIntrinsicSize(page);
  const zoom = width / Math.max(1, intrinsic.width);
  const originalScale = Math.min(1, dimensions.height / Math.max(1, intrinsic.height * zoom));
  const [height, setHeight] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [originalReady, setOriginalReady] = useState(mode !== 'split');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const onHeight = useCallback((_page: number, measured: number) => {
    // Rendering Korean text can request additional font subsets after the root was mounted.
    void document.fonts.ready.then(() => {
      const node = contentRef.current?.querySelector<HTMLElement>('.kr-page');
      if (node !== null && node !== undefined) setHeight(node.scrollHeight || measured);
    });
  }, []);
  const onRendered = useCallback(() => setOriginalReady(true), []);
  const fit = height === null ? null : fitPrintPage(height, dimensions.height);

  // Reuse the fully rendered translation for continuation slices, including raster crops.
  useLayoutEffect(() => {
    if (height !== null && contentRef.current !== null) setSnapshot(contentRef.current.innerHTML);
  }, [height]);

  useEffect(() => {
    if (fit !== null && snapshot !== null && originalReady) onFitted(page);
  }, [height, snapshot, originalReady, onFitted, page]);

  const slices = fit?.slices ?? [{ offset: 0, height: dimensions.height }];
  return (
    <>
      {slices.map((slice, index) => (
        <section
          key={index}
          className="print-sheet"
          data-source-page={page}
          data-continuation={index > 0 ? index : undefined}
          style={{ height: dimensions.height }}
        >
          {mode === 'split' ? (
            <div className="print-sheet__original" style={{ width }}>
              {index === 0 ? (
                <div style={{ transform: `scale(${originalScale})`, transformOrigin: 'top left' }}>
                  <PageCanvas doc={doc} page={page} zoom={zoom} dpr={2} onSize={noop} onRendered={onRendered} registerPage={noop} />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="print-sheet__translation" style={{ width }}>
            {index > 0 ? <div className="print-continuation-label">{t('misc.printContinuation', { page })}</div> : null}
            <div className="print-translation-slice" style={{ height: slice.height }}>
              <div
                ref={index === 0 ? contentRef : undefined}
                className="print-translation-content"
                style={{ width, transform: `translateY(-${slice.offset}px) scale(${fit?.scale ?? 1})` }}
              >
                {index === 0 ? (
                  <KoreanPageView
                    doc={doc}
                    page={page}
                    zoom={zoom}
                    dpr={2}
                    blocks={blocks}
                    translations={translations}
                    placeholder={{ width, height: width * 1.4 }}
                    onHeight={onHeight}
                    onSelectBlock={noop}
                  />
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: snapshot ?? '' }} />
                )}
              </div>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

/** Print-only layout: the interactive Korean pane retains its own sizes and spacing. */
export function PrintView(props: Props): JSX.Element {
  const { mode, pageCount, onReady } = props;
  const [fontsReady, setFontsReady] = useState(false);
  const [fitted, setFitted] = useState<Set<number>>(() => new Set());
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const done = useRef(false);
  const dimensions = printDimensions(mode);
  const onFitted = useCallback((page: number) => setFitted((previous) => (previous.has(page) ? previous : new Set([...previous, page]))), []);

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!fontsReady || fitted.size < pageCount || done.current) return;
    // The fit and all continuation snapshots have committed before readiness is reported.
    const frame = window.requestAnimationFrame(() => {
      done.current = true;
      readyRef.current();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fontsReady, fitted, pageCount]);

  // A page that never finishes measuring (a failed raster) must not block the export forever;
  // well past the normal fit time, print whatever has been laid out.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (done.current) return;
      done.current = true;
      readyRef.current();
    }, 30_000 + pageCount * 1_500);
    return () => window.clearTimeout(timer);
  }, [pageCount]);

  const style = { '--print-gap': `${dimensions.gap}px` } as CSSProperties;
  return createPortal(
    <div className={`print-root print-root--${mode}`} style={style} aria-hidden="true">
      <style>{`@page { size: A4 ${mode === 'split' ? 'landscape' : 'portrait'}; margin: ${dimensions.marginMm}mm; }`}</style>
      {fontsReady ? Array.from({ length: pageCount }, (_, index) => <PrintPage key={index + 1} {...props} page={index + 1} onFitted={onFitted} />) : null}
    </div>,
    document.body,
  );
}
