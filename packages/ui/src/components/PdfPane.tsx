import { t } from '../i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Block, Highlight, Memo, PdfTextLayout } from '@fractal/shared';
import type { Size } from '../lib/geometry';
import { hitTestBlock, pageRenderSize, visiblePageWindow } from '../lib/geometry';
import { nativeSelection, orderTextSpans } from '../lib/native-selection';
import { StickyLayer } from '../reader/StickyLayer';
import { useLanguage } from '../i18n';
import { intrinsicSize, type PDFDocumentProxy } from '../lib/pdf';
import { HighlightLayer } from './HighlightLayer';
import type { PendingSelection } from '../reader/SelectionMenu';
import type { InkStroke } from '@fractal/shared';
import { InkLayer } from '../reader/InkLayer';
import type { CitationMarker, StructureItem } from '@fractal/shared';
import { StructureLayer } from '../reader/StructureLayer';

/** Recognised figures, tables, equations and citation numbers, with what choosing them does. */
export interface StructureProps {
  items: StructureItem[];
  markers: CitationMarker[];
  onExplain(item: StructureItem, anchor: DOMRect): void;
  onCitation(marker: CitationMarker, anchor: DOMRect): void;
}
import type { InkPoint } from '../reader/ink';

/** Handwriting shown over the pages, and what a desktop pen does. */
export interface InkProps {
  enabled?: boolean;
  strokes: InkStroke[];
  color: string;
  onCreate(page: number, points: InkPoint[], color: string): void;
  onErase(stroke: InkStroke): void;
}

/** Page colours for dark and sepia reading; figures and photos keep their own colours. */
export interface PageColors {
  background: string;
  foreground: string;
}

export interface PageCanvasProps {
  doc: PDFDocumentProxy;
  page: number;
  zoom: number;
  /** Device pixel ratio, capped so a 4x zoom on a HiDPI screen stays affordable. */
  dpr: number;
  /** Defaults to the original-page label; a translated pane overrides it. */
  ariaLabel?: string;
  /** The page's size at this zoom when already known, held from the first render so the box
   * never shrinks to an empty canvas while the page loads. */
  size?: Size;
  onSize(page: number, size: Size): void;
  onRendered?(page: number): void;
  registerPage(page: number, element: HTMLDivElement | null): void;
  /** Whatever the caller wants absolutely-positioned over the rendered page. */
  children?: ReactNode;
  /** Forwarded onto the page container; used for drag-driven highlight creation. */
  onPointerDown?(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerUp?(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove?(event: React.PointerEvent<HTMLDivElement>): void;
  onPointerCancel?(): void;
  pageColors?: PageColors;
}

/**
 * The page background alone: draws the original page into a canvas, tracks its
 * intrinsic size, and scales it for the current zoom and device pixel ratio.
 *
 * This is the one place zoom math happens for a page. Any overlay passed as
 * `children` shares the same sized box instead of recomputing zoom on its own.
 *
 * Only pages inside the visible window are mounted, so a 40-page paper never
 * rasterises 40 canvases at once.
 */
export function PageCanvas({
  doc,
  page,
  zoom,
  dpr,
  ariaLabel,
  size,
  onSize,
  onRendered,
  registerPage,
  children,
  onPointerDown,
  onPointerUp,
  onPointerMove,
  onPointerCancel,
  pageColors,
}: PageCanvasProps): JSX.Element {
  const renderedCallback = useRef(onRendered);
  renderedCallback.current = onRendered;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderedSize, setRenderedSize] = useState<Size | null>(null);
  const box = size ?? renderedSize;

  useEffect(() => {
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    let loadedPage: { cleanup(): boolean } | null = null;

    void (async () => {
      const proxy = await doc.getPage(page);
      loadedPage = proxy;
      if (cancelled) {
        if (doc.numPages > 300) proxy.cleanup();
        return;
      }
      const intrinsic = intrinsicSize(proxy);
      const rendered = pageRenderSize(intrinsic, zoom);
      setRenderedSize(rendered);
      onSize(page, intrinsic);

      const canvas = canvasRef.current;
      if (canvas === null) return;
      const context = canvas.getContext('2d');
      if (context === null) return;

      canvas.width = Math.floor(rendered.width * dpr);
      canvas.height = Math.floor(rendered.height * dpr);
      canvas.style.width = `${rendered.width}px`;
      canvas.style.height = `${rendered.height}px`;

      const render = proxy.render({
        canvas,
        canvasContext: context,
        viewport: proxy.getViewport({ scale: zoom * dpr }),
        ...(pageColors === undefined ? {} : { pageColors }),
      });
      task = render;
      try {
        await render.promise;
        if (!cancelled) renderedCallback.current?.(page);
      } catch {
        /* superseded by a newer zoom or unmounted */
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      if (doc.numPages > 300) loadedPage?.cleanup();
    };
  }, [doc, page, zoom, dpr, onSize, pageColors?.background, pageColors?.foreground]);

  return (
    <div
      className="pdf-page"
      data-page={page}
      ref={(element) => registerPage(page, element)}
      style={box === null ? undefined : { width: box.width, height: box.height }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerCancel={onPointerCancel}
    >
      <canvas ref={canvasRef} aria-label={ariaLabel ?? t('misc.pageOriginal', { page })} />
      {children}
    </div>
  );
}

interface TextLayerOverlayProps {
  onCoverage?(page: number, hasText: boolean): void;
  getLayout?(page: number): Promise<PdfTextLayout | null>;
  doc: PDFDocumentProxy;
  page: number;
  zoom: number;
}

/**
 * A transparent, selectable text layer over the rendered page canvas.
 *
 * pdf.js positions and sizes each span itself once `--total-scale-factor` is
 * set to the same zoom the canvas rendered at, so this stays a thin wrapper:
 * mount a container, hand it to `TextLayer`, and let the browser's own
 * selection machinery do the rest.
 */
function TextLayerOverlay({ doc, page, zoom, getLayout, onCoverage }: TextLayerOverlayProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let layer: { cancel(): void } | null = null;

    void (async () => {
      const proxy = await doc.getPage(page);
      if (cancelled) return;
      const container = containerRef.current;
      if (container === null) return;
      container.replaceChildren();
      container.style.setProperty('--total-scale-factor', String(zoom * ((proxy as unknown as { userUnit?: number }).userUnit ?? 1)));
      container.style.setProperty('--scale-round-x', '1px');
      container.style.setProperty('--scale-round-y', '1px');
      container.style.setProperty('--min-font-size', '1');
      const viewport = proxy.getViewport({ scale: zoom });
      const instance = new TextLayer({ textContentSource: proxy.streamTextContent({ disableNormalization: true }), container, viewport });
      layer = instance;
      try {
        await instance.render();
        if (!cancelled) {
          orderTextSpans(container);
          onCoverage?.(page, Boolean(container.textContent?.trim()));
          const layout = await getLayout?.(page).catch(() => null);
          if (!cancelled && layout?.status === 'ready') orderTextSpans(container, layout.page);
        }
      } catch {
        /* superseded by a newer zoom or unmounted */
      }
    })();

    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [doc, page, zoom, getLayout, onCoverage]);

  return <div className="textLayer" ref={containerRef} data-testid={`text-layer-${page}`} />;
}

interface PageViewProps {
  doc: PDFDocumentProxy;
  page: number;
  zoom: number;
  dpr: number;
  size: Size;
  blocks: Block[];
  highlights: Highlight[];
  onSize(page: number, size: Size): void;
  onRendered?(page: number): void;
  registerPage(page: number, element: HTMLDivElement | null): void;
  onSelectBlock(block: Block): void;
  onSelectText(selection: PendingSelection): void;
  onOpenHighlight(highlight: Highlight): void;
  pending: PendingSelection | null;
  memos?: Memo[];
  onSaveMemo?(memo: Memo): void;
  getLayout?(page: number): Promise<PdfTextLayout | null>;
  regionMode?: boolean;
  onCoverage?(page: number, hasText: boolean): void;
  pageColors?: PageColors;
  ink?: InkProps;
  structure?: StructureProps;
}

/**
 * One rendered PDF page: the canvas background, a selectable text layer, the
 * page's saved highlights, and click-to-navigate hit-testing.
 *
 * Navigation no longer uses an overlaid click-target button (spec: it would
 * intercept the mousedown a text selection needs to start). Instead a plain
 * click — one that did not drag — is hit-tested against the page's readable
 * blocks directly, and a drag becomes a highlight of the lines it swept.
 */
function PageView({
  doc,
  page,
  zoom,
  dpr,
  size,
  blocks,
  highlights,
  onSize,
  onRendered,
  registerPage,
  onSelectBlock,
  onSelectText,
  onOpenHighlight,
  pending,
  pageColors,
  ink,
  structure,
  memos,
  onSaveMemo,
  getLayout,
  regionMode,
  onCoverage,
}: PageViewProps): JSX.Element {
  const pageHighlights = useMemo(() => highlights.filter((h) => h.page === page), [highlights, page]);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [liveRegion, setLiveRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!regionMode || !start) return;
    if (!event.buttons) {
      dragStart.current = null;
      setLiveRegion(null);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const sx = Math.max(0, Math.min(box.width, start.x - box.left));
    const sy = Math.max(0, Math.min(box.height, start.y - box.top));
    const ex = Math.max(0, Math.min(box.width, event.clientX - box.left));
    const ey = Math.max(0, Math.min(box.height, event.clientY - box.top));
    setLiveRegion({
      x: Math.min(sx, ex) / box.width,
      y: Math.min(sy, ey) / box.height,
      width: Math.abs(ex - sx) / box.width,
      height: Math.abs(ey - sy) / box.height,
    });
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,textarea,.sticky-note,.answer-popup')) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    if (regionMode) {
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    setLiveRegion(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!start || (event.target as HTMLElement).closest('button,textarea,.sticky-note,.answer-popup')) return;
    const dragged = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3;
    if (regionMode && dragged) {
      const box = event.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(start.x, event.clientX) - box.left) / box.width,
        y = Math.max(0, Math.min(start.y, event.clientY) - box.top) / box.height;
      const width = Math.min(1 - x, Math.abs(start.x - event.clientX) / box.width),
        height = Math.min(1 - y, Math.abs(start.y - event.clientY) / box.height);
      if (width > 0 && height > 0) onSelectText({ page, regions: [{ page, x, y, width, height }], text: '', anchor: { x: event.clientX, y: event.clientY } });
      return;
    }
    if (dragged || !window.getSelection()?.isCollapsed || event.detail > 1) return;
    const box = event.currentTarget.getBoundingClientRect();
    const block = hitTestBlock(blocks, page, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    const x = (event.clientX - box.left) / box.width,
      y = (event.clientY - box.top) / box.height;
    const highlight = pageHighlights.find((h) => h.rects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height));
    if (highlight) {
      onOpenHighlight(highlight);
      return;
    }
    if (block) onSelectBlock(block);
  };

  return (
    <PageCanvas
      doc={doc}
      page={page}
      zoom={zoom}
      dpr={dpr}
      size={size}
      onSize={onSize}
      onRendered={onRendered}
      registerPage={registerPage}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={() => {
        dragStart.current = null;
        setLiveRegion(null);
      }}
      pageColors={pageColors}
    >
      {liveRegion ? (
        <div
          className="selection-pending selection-live"
          aria-hidden="true"
          style={{ left: `${liveRegion.x * 100}%`, top: `${liveRegion.y * 100}%`, width: `${liveRegion.width * 100}%`, height: `${liveRegion.height * 100}%` }}
        />
      ) : null}
      <TextLayerOverlay doc={doc} page={page} zoom={zoom} getLayout={getLayout} onCoverage={onCoverage} />
      {memos && onSaveMemo ? <StickyLayer memos={memos.filter((m) => m.page === page)} onSave={onSaveMemo} /> : null}
      {structure !== undefined ? (
        <StructureLayer
          items={structure.items.filter((i) => i.page === page)}
          markers={structure.markers.filter((m) => m.page === page)}
          onExplain={structure.onExplain}
          onCitation={structure.onCitation}
        />
      ) : null}
      <HighlightLayer highlights={pageHighlights} onOpen={onOpenHighlight} />
      {ink !== undefined ? (
        <InkLayer
          page={page}
          strokes={ink.strokes.filter((s) => s.page === page && !s.deleted)}
          color={ink.color}
          enabled={ink.enabled}
          onCreate={ink.onCreate}
          onErase={ink.onErase}
        />
      ) : null}
      {pending !== null && pending.regions.some((r) => r.page === page)
        ? pending.regions
            .filter((r) => r.page === page)
            .map((r, i) => (
              <div
                key={i}
                className="selection-pending"
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}
                aria-hidden="true"
              />
            ))
        : null}
    </PageCanvas>
  );
}

export interface PdfPaneProps {
  doc: PDFDocumentProxy | null;
  pageCount: number;
  currentPage: number;
  zoom: number;
  blocks: Block[];
  highlights: Highlight[];
  /** Native PDF dimensions, known for every page up front: a page is the same size drawn or
   * not, so moving the drawn window never moves what the reader is looking at. */
  pageIntrinsicSize(page: number): Size;
  onSize(page: number, size: Size): void;
  onRendered?(page: number): void;
  registerPage(page: number, element: HTMLDivElement | null): void;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  onScroll(): void;
  onSelectBlock(block: Block): void;
  onSelectText(selection: PendingSelection): void;
  onOpenHighlight(highlight: Highlight): void;
  pending: PendingSelection | null;
  memos?: Memo[];
  onSaveMemo?(memo: Memo): void;
  getLayout?(page: number): Promise<PdfTextLayout | null>;
  regionMode?: boolean;
  onCoverage?(page: number, hasText: boolean): void;
  pageColors?: PageColors;
  ink?: InkProps;
  structure?: StructureProps;
}

/**
 * The left pane: the original PDF.
 *
 * Pages outside the window are kept as sized placeholders so the scrollbar and
 * every page offset stay correct without rendering the whole document.
 */
export function PdfPages(props: PdfPaneProps): JSX.Element {
  const {
    doc,
    pageCount,
    currentPage,
    zoom,
    blocks,
    highlights,
    pageIntrinsicSize,
    onSize,
    onRendered,
    registerPage,
    bodyRef,
    onScroll,
    onSelectBlock,
    onSelectText,
    onOpenHighlight,
    pending,
    pageColors,
    ink,
    structure,
    memos,
    onSaveMemo,
    getLayout,
  } = props;
  const dpr = useMemo(() => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1), []);
  const copiedSelection = useRef<PendingSelection | null>(null);
  type RangeSnapshot = Pick<Range, 'startContainer' | 'startOffset' | 'endContainer' | 'endOffset'>;
  const copiedRange = useRef<RangeSnapshot | null>(null);
  const ko = useLanguage() === 'ko';
  const [noTextPages, setNoTextPages] = useState<Set<number>>(() => new Set());
  useEffect(() => setNoTextPages(new Set()), [doc]);
  const coverage = useCallback(
    (page: number, hasText: boolean) =>
      setNoTextPages((previous) => {
        if (previous.has(page) === !hasText) return previous;
        const next = new Set(previous);
        if (hasText) next.delete(page);
        else next.add(page);
        return next;
      }),
    [],
  );
  const [tool, setTool] = useState<'pen' | 'text' | 'region'>('pen');
  const [anchorPage, setAnchorPage] = useState<number | null>(null);
  const live = useMemo(
    () => new Set([...visiblePageWindow(currentPage, pageCount, 1), ...(anchorPage === null ? [] : [anchorPage])]),
    [currentPage, pageCount, anchorPage],
  );
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !doc) return;
    copiedSelection.current = null;
    copiedRange.current = null;
    const sameRange = (saved: RangeSnapshot | null): boolean => {
      const selection = window.getSelection();
      if (!saved || !saved.startContainer.isConnected || !saved.endContainer.isConnected || !selection?.rangeCount || selection.isCollapsed) return false;
      const current = selection.getRangeAt(0);
      return (
        current.startContainer === saved.startContainer &&
        current.startOffset === saved.startOffset &&
        current.endContainer === saved.endContainer &&
        current.endOffset === saved.endOffset
      );
    };
    let captureGeneration = 0;
    const captureSelection = () => {
      const generation = ++captureGeneration;
      const result = nativeSelection(root, getLayout);
      const current = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
      // A DOM Range is live and shifts on virtual-page removal; retain immutable endpoints.
      const range = current
        ? { startContainer: current.startContainer, startOffset: current.startOffset, endContainer: current.endContainer, endOffset: current.endOffset }
        : null;
      void result.then((selection) => {
        if (generation !== captureGeneration || !selection || !sameRange(range)) return;
        copiedSelection.current = selection;
        copiedRange.current = range;
        onSelectText(selection);
      });
    };
    let dragging = false,
      point: { x: number; y: number } | null = null,
      frame = 0;
    let start: { x: number; y: number } | null = null,
      anchor: { node: Node; offset: number; page: number; run: string | undefined } | null = null;
    const updateRange = () => {
      if (!point || !start || !anchor || Math.hypot(point.x - start.x, point.y - start.y) < 3) return;
      const box = root.getBoundingClientRect();
      const target = document.caretRangeFromPoint(point.x, Math.max(box.top + 2, Math.min(box.bottom - 2, point.y)));
      if (!target || target.startContainer.nodeType !== Node.TEXT_NODE || !root.contains(target.startContainer)) return;
      if (!anchor.node.isConnected) {
        const replacement = root.querySelector<HTMLElement>(`[data-page="${anchor.page}"] .textLayer span[data-text-run="${anchor.run}"]`)?.firstChild;
        if (!replacement) return;
        anchor.node = replacement;
      }
      window
        .getSelection()
        ?.setBaseAndExtent(anchor.node, Math.min(anchor.offset, anchor.node.textContent?.length ?? 0), target.startContainer, target.startOffset);
    };
    const tick = () => {
      if (!dragging || !point) return;
      const box = root.getBoundingClientRect(),
        edge = 36;
      const step = point.y < box.top + edge ? -12 : point.y > box.bottom - edge ? 12 : 0;
      if (step) root.scrollTop += step;
      updateRange();
      frame = requestAnimationFrame(tick);
    };
    const down = (e: PointerEvent) => {
      if (
        tool === 'region' ||
        (e.pointerType === 'pen' && tool === 'pen') ||
        e.button !== 0 ||
        !(e.target instanceof Element) ||
        !root.contains(e.target) ||
        e.target.closest('button,textarea,.sticky-note,.answer-popup')
      )
        return;
      copiedSelection.current = null;
      copiedRange.current = null;
      ++captureGeneration;
      cancelAnimationFrame(frame);
      dragging = true;
      point = start = { x: e.clientX, y: e.clientY };
      const caret = document.caretRangeFromPoint(e.clientX, e.clientY),
        page = Number(e.target.closest<HTMLElement>('[data-page]')?.dataset.page) || 1;
      anchor =
        caret && caret.startContainer.nodeType === Node.TEXT_NODE
          ? { node: caret.startContainer, offset: caret.startOffset, page, run: caret.startContainer.parentElement?.dataset.textRun }
          : null;
      setAnchorPage(page);
      frame = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      if (dragging) point = { x: e.clientX, y: e.clientY };
    };
    const finish = (e: PointerEvent) => {
      if (!dragging) return;
      if (e.type === 'pointerup') point = { x: e.clientX, y: e.clientY };
      dragging = false;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        updateRange();
        captureSelection();
      });
    };
    const key = (e: KeyboardEvent) => {
      if (
        (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')
      )
        captureSelection();
    };
    const copy = (event: ClipboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        (document.activeElement as HTMLElement | null)?.isContentEditable
      )
        return;
      const selection = window.getSelection();
      if (copiedSelection.current && sameRange(copiedRange.current) && selection?.anchorNode && root.contains(selection.anchorNode)) {
        event.clipboardData?.setData('text/plain', copiedSelection.current.text);
        event.preventDefault();
      }
    };
    document.addEventListener('copy', copy);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    document.addEventListener('keyup', key);
    return () => {
      ++captureGeneration;
      cancelAnimationFrame(frame);
      document.removeEventListener('copy', copy);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.removeEventListener('keyup', key);
    };
  }, [doc, bodyRef, getLayout, onSelectText, tool]);

  if (doc === null) {
    return (
      <div className="pane-body" ref={bodyRef} onScroll={onScroll}>
        <p className="empty">{t('misc.loadingOriginal')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="original-tools" role="toolbar" aria-label={ko ? '원본 도구' : 'Original tools'}>
        {(['pen', 'text', 'region'] as const).map((mode) => (
          <button key={mode} aria-pressed={tool === mode} onClick={() => setTool(mode)}>
            {mode === 'text' ? 'T' : mode === 'pen' ? (ko ? '펜' : 'Pen') : ko ? '영역' : 'Region'}
          </button>
        ))}
        <span>
          {tool === 'region'
            ? ko
              ? '드래그해 원본 영역 선택'
              : 'Drag to select an original region'
            : noTextPages.has(currentPage)
              ? ko
                ? '\uc120\ud0dd\ud560 PDF \ud14d\uc2a4\ud2b8\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. \uc601\uc5ed\uc73c\ub85c \uba54\ubaa8\ud558\uac70\ub098 \uc9c8\ubb38\ud558\uc138\uc694.'
                : 'No selectable PDF text. Choose Region for notes or questions.'
              : tool === 'pen'
                ? ko
                  ? '펜으로 필기 · 마우스로 텍스트 선택'
                  : 'Pen writes · mouse selects text'
                : ko
                  ? '텍스트 선택'
                  : 'Select text'}
        </span>
      </div>
      <div className="pane-body" ref={bodyRef} onScroll={onScroll} data-testid="pdf-body">
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) =>
          live.has(page) ? (
            <PageView
              key={page}
              doc={doc}
              page={page}
              zoom={zoom}
              dpr={dpr}
              size={pageRenderSize(pageIntrinsicSize(page), zoom)}
              blocks={blocks}
              highlights={highlights}
              onSize={onSize}
              onRendered={onRendered}
              registerPage={registerPage}
              onSelectBlock={onSelectBlock}
              onSelectText={onSelectText}
              onOpenHighlight={onOpenHighlight}
              pending={pending}
              pageColors={pageColors}
              ink={ink ? { ...ink, enabled: tool === 'pen' } : undefined}
              structure={structure}
              memos={memos}
              onSaveMemo={onSaveMemo}
              getLayout={getLayout}
              regionMode={tool === 'region'}
              onCoverage={coverage}
            />
          ) : (
            <div
              key={page}
              className="pdf-page pdf-placeholder"
              data-page={page}
              ref={(element) => registerPage(page, element)}
              style={pageRenderSize(pageIntrinsicSize(page), zoom)}
            >
              {t('misc.pageLabel', { page })}
            </div>
          ),
        )}
      </div>
    </>
  );
}

export default PdfPages;
