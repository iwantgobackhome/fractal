# PDF text geometry follow-up for Android API 29–34

This is a concrete follow-up task for coordinator dispatch after the data foundation. The proposed route and types below are not implemented by the foundation commit. Desktop and Android should continue using GET `/api/papers/:key` for the existing snapshot until this extraction contract is published. Whole-block `regions` and `sourceText` are insufficient to guarantee word/character selection in older Android PdfRenderer APIs.

Backend owner B should implement persistent, versioned positional source-PDF text for every downloadable paper, without requiring Android API 35 or fetching text while dragging. Android owner D should download and cache it alongside the PDF and use the same local hit-testing/selection implementation on API 29 through 34. Selecting the translated reader remains a separate native text interaction; translated-to-original annotation mapping is excluded.

Proposed shared contract for review:

```ts
interface PdfTextLayout {
  paperKey: string;
  pdfSha256: string;
  extractionVersion: string;
  pages: PdfTextPage[];
}
interface PdfTextPage {
  page: number; // one-based physical page
  rotation: 0 | 90 | 180 | 270;
  width: number; // unrotated crop-box width in PDF points
  height: number; // unrotated crop-box height in PDF points
  text: string; // original text in deterministic reading order
  spans: PdfTextSpan[];
  coverage: 'text' | 'partial' | 'unsupported';
}
interface PdfTextSpan {
  start: number; // inclusive UTF-16 offset in page.text
  end: number; // exclusive UTF-16 offset in page.text
  rect: {x:number; y:number; width:number; height:number};
  direction: 'ltr' | 'rtl' | 'ttb';
  granularity: 'glyph' | 'word' | 'run';
  certainty: 'exact' | 'approximate';
}
```

Coordinates should use the same top-left, normalized, unrotated crop-box space as current `Region`; clients apply page rotation and viewport transforms exactly once. A rotated run requires a polygon or baseline extension before final publication if its axis-aligned rectangle alone fails hit testing. Whitespace and line breaks must be deterministic and spans must reference the exact page text. `Block.pageOrdinal` is unchanged and is never a physical page number or text offset.

Proposed GET `/api/papers/:key/text-layout` returns `{layout:PdfTextLayout}` and supports PDF hash/version validation. New SQLite page-layout records should be keyed by PDF digest, extraction version and physical page, so re-extraction cannot silently serve positions from a different PDF. Return explicit partial/unsupported coverage for damaged geometry or scanned pages; do not fabricate character rectangles. Keep old PDFs, old blocks, translations and annotation geometry intact during lazy backfill. Existing clients must be able to ignore the new endpoint.

Extraction should preserve original PDF.js text-item positions as a baseline, then derive glyph/word geometry from actual font advances/operator glyph data. Splitting a run equally by character count is only approximate, and must not be marked exact. Validate ligatures, combining marks and surrogate pairs using UTF-16 offsets. Define deterministic reading order across columns, superscripts and captions using the existing block/line geometry, with confidence signaling for uncertain assignment.

Acceptance: real PDF fixtures with narrow columns, variable-width fonts, wrapped lines, ligatures, rotated pages, equations and scanned pages; no off-by-one page or rotation errors; Android API29/34 emulator drag selection and selected text match the PDF; offline cache opens with networking disabled; re-extraction invalidates layout by PDF hash/version without moving existing source annotations. Owner D's Room migration should follow the final reviewed contract, not this proposal.
