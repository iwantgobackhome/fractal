import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkOriginalProvenance,
  originalPointToRendered,
  type ContextSourceStatus,
  type Highlight,
  type Memo,
  type OriginalProvenance,
  type PdfTextLayout,
  type Region,
} from '@fractal/shared';
import type { PDFDocumentProxy } from '../lib/pdf';

export function renderedRegion(region: Region, provenance: OriginalProvenance | undefined, rotation: 0 | 90 | 180 | 270): Region {
  if (provenance?.coordinateSpace !== 'unrotated-crop-normalized-v1') return region;
  const points = [
    [region.x, region.y],
    [region.x + region.width, region.y],
    [region.x, region.y + region.height],
    [region.x + region.width, region.y + region.height],
  ].map((p) => originalPointToRendered(p as [number, number], provenance, rotation));
  const x = Math.min(...points.map((p) => p[0])),
    y = Math.min(...points.map((p) => p[1]));
  return { ...region, x, y, width: Math.max(...points.map((p) => p[0])) - x, height: Math.max(...points.map((p) => p[1])) - y };
}
/** Source checks are cached per loaded PDF; presentation clones never rewrite stored coordinates. */
export function useReaderProvenance(
  doc: PDFDocumentProxy | null,
  hash: Promise<string> | null,
  blockVersion: string | null,
  getLayout: (page: number) => Promise<PdfTextLayout | null>,
  highlights: Highlight[],
  memos: Memo[],
) {
  const [identity, setIdentity] = useState<{ promise: Promise<string> | null; hash: string | null }>({ promise: null, hash: null });
  const pdfSha256 = identity.promise === hash ? identity.hash : null;
  useEffect(() => {
    let live = true;
    if (hash)
      void hash
        .then((value) => {
          if (live) setIdentity({ promise: hash, hash: value });
        })
        .catch(() => {
          if (live) setIdentity({ promise: hash, hash: null });
        });
    return () => {
      live = false;
    };
  }, [hash]);
  const [recovery, setRecovery] = useState(0);
  useEffect(() => {
    const recovered = () => setRecovery((n) => n + 1);
    window.addEventListener('online', recovered);
    window.addEventListener('focus', recovered);
    window.addEventListener('fractal:retry-source', recovered);
    return () => {
      window.removeEventListener('online', recovered);
      window.removeEventListener('focus', recovered);
      window.removeEventListener('fractal:retry-source', recovered);
    };
  }, []);
  const checks = useMemo(() => new Map<string, Promise<ContextSourceStatus>>(), [hash, blockVersion, getLayout, recovery]);
  const layouts = useMemo(() => new Map<number, Promise<PdfTextLayout | null>>(), [getLayout, recovery]);
  const checkSource = useCallback(
    (provenance?: OriginalProvenance): Promise<ContextSourceStatus> => {
      const key = JSON.stringify(provenance ?? null),
        old = checks.get(key);
      if (old) return old;
      const value = (async () => {
        const actual = (await hash?.catch(() => null)) ?? null;
        const base = checkOriginalProvenance(provenance, { pdfSha256: actual, blockExtractionVersion: blockVersion });
        if (!provenance?.layoutRange || base === 'pdf_changed' || !actual) return base;
        const page = provenance.layoutRange.page;
        let pending = layouts.get(page);
        if (!pending) {
          pending = getLayout(page).catch(() => null);
          layouts.set(page, pending);
        }
        const layout = await pending;
        return checkOriginalProvenance(provenance, {
          pdfSha256: actual,
          blockExtractionVersion: blockVersion,
          ...(layout?.status === 'ready'
            ? { layout: { page: layout.page.page, extractionVersion: layout.extractionVersion, boundaries: layout.page.boundaries } }
            : {}),
        });
      })();
      checks.set(key, value);
      return value;
    },
    [checks, hash, blockVersion, getLayout, layouts],
  );
  const [display, setDisplay] = useState<{
    doc: PDFDocumentProxy | null;
    highlights: Highlight[];
    memos: Memo[];
    statuses: Record<string, ContextSourceStatus>;
    rotations: Record<string, 0 | 90 | 180 | 270>;
  }>({ doc: null, highlights: [], memos: [], statuses: {}, rotations: {} });
  useEffect(() => {
    let live = true;
    void (async () => {
      const statuses: Record<string, ContextSourceStatus> = {},
        rotations: Record<string, 0 | 90 | 180 | 270> = {},
        shownHighlights: Highlight[] = [],
        shownMemos: Memo[] = [];
      for (const annotation of [...highlights, ...memos]) {
        const id = 'highlightId' in annotation ? annotation.highlightId : annotation.id;
        const status = await checkSource(annotation.provenance);
        statuses[id] = status;
        if (status !== 'current' && status !== 'unknown') continue;
        if (doc && (annotation.page < 1 || annotation.page > doc.numPages)) {
          statuses[id] = 'range_invalid';
          continue;
        }
        let rotation: 0 | 90 | 180 | 270 = 0;
        if (annotation.provenance?.coordinateSpace === 'unrotated-crop-normalized-v1' && doc) {
          try {
            rotation = (await doc.getPage(annotation.page)).rotate as 0 | 90 | 180 | 270;
          } catch {
            statuses[id] = 'unavailable';
            continue;
          }
        }
        rotations[id] = rotation;
        if ('highlightId' in annotation)
          shownHighlights.push({ ...annotation, rects: annotation.rects.map((r) => renderedRegion(r, annotation.provenance, rotation)) });
        else
          shownMemos.push(
            annotation.rect
              ? { ...annotation, rect: renderedRegion({ ...annotation.rect, page: annotation.page }, annotation.provenance, rotation) }
              : annotation,
          );
      }
      if (live) setDisplay({ doc, highlights: shownHighlights, memos: shownMemos, statuses, rotations });
    })().catch(() => {
      /* retain list bodies; unavailable geometry is not applied */
    });
    return () => {
      live = false;
    };
  }, [doc, highlights, memos, checkSource]);
  // Editing a display clone writes back in its declared frame, preserving explicit
  // unrotated records as well as all untagged historical fields.
  const storedMemo = useCallback(
    (memo: Memo): Memo => {
      if (!memo.rect || memo.provenance?.coordinateSpace !== 'unrotated-crop-normalized-v1') return memo;
      const raw = memos.find((item) => item.id === memo.id),
        shown = display.memos.find((item) => item.id === memo.id);
      if (raw && shown && JSON.stringify(memo.rect) === JSON.stringify(shown.rect)) return { ...memo, rect: raw.rect };
      const rotation = display.rotations[memo.id] ?? 0;
      const { page: _, ...rect } = renderedRegion({ ...memo.rect, page: memo.page }, memo.provenance, ((360 - rotation) % 360) as 0 | 90 | 180 | 270);
      return { ...memo, rect };
    },
    [display.rotations, display.memos, memos],
  );
  return {
    pdfSha256,
    checkSource,
    displayHighlights: display.doc === doc ? display.highlights : [],
    displayMemos: display.doc === doc ? display.memos : [],
    statusById: display.statuses,
    storedMemo,
  };
}
