# Original coordinate provenance followup

Backend checkpoint: accepted discovery `12db751`, accepted geometry `c7b6b3a`/`3aae80d`. Independent launch evidence: root QA `a0a14a9`, worker E `6c2b1c9`, `docs/implementation/qa/reader-prerequisite/{REVIEW.md,probe.ts,http-evidence.json,coordinate-checks.json,layouts.json}` in the coordinator checkout. This change adds optional declarations only; it has **no SQLite migration**, no historical retagging, no geometry rewrite and no translated-to-original anchor mapping.

## Exact optional wire fields

Exported shared `OriginalProvenance` / `originalProvenanceSchema`:

```ts
interface OriginalProvenance {
  coordinateSpace?: 'rendered-page-normalized-v1' | 'unrotated-crop-normalized-v1';
  textSource?: 'original' | 'translated' | 'unknown';
  pdfSha256?: string; // actual PDF bytes SHA256, lowercase 64 hex
  layoutRange?: {
    page: number; // physical page, one-based, REQUIRED
    extractionVersion: string; // PdfTextLayout.extractionVersion, NOT Paper.extractionVersion
    start: number; // inclusive original page.text UTF16 offset
    end: number; // exclusive; start < end; legal page.boundaries only
  };
  blockExtractionVersion?: string; // Paper.extractionVersion when referencing extracted blocks
}
```

The optional field is named **`provenance`**, at these locations:

- Legacy `Highlight` / POST `/api/papers/:key/highlights`, carried through note/color edits and its sync projection.
- Synced `Memo` and `SyncedHighlight`, through POST `/api/papers/:key/annotations` and `/api/sync/push`; GET annotation lists and `/api/sync/pull` retain it. It applies to the annotation's page and all of its rectangles.
- `Region`, including any newly generated `AiAnswer.citations[].region`.
- POST `/api/papers/:key/ask` and `/api/papers/:key/explain`, persisted unchanged at `HistoryEntry.context.provenance`.

`layoutRange` requires `pdfSha256` and `textSource: 'original'`. It is bound to the enclosing annotation/request/region physical page; missing or different pages are invalid. Each range belongs to **one** page's original text stream. `blockExtractionVersion` also requires the actual hash. A translated or unknown quote can carry its honest `textSource` and an independently known displayed rectangle, but cannot carry `layoutRange`. The backend does not invent offsets from a quote or native Android indexes.

`ask`/`explain` additionally accept optional **`answerLanguage`**, exactly the existing preference language union: `'auto'` or a valid BCP47 `Language` (for example `ko`, `en`, `ja`, `zh-Hant`). It persists at `HistoryEntry.context.answerLanguage` and participates in the requestId fingerprint. Omission retains global preference behavior; a request override never mutates preferences. `auto` asks paper questions in the question's language; explanation `auto` retains the existing UI-language fallback. Completed retries replay their original stored answer regardless of later global language changes; changed explicit language under the same requestId returns 400.

`AiAnswer` / `aiAnswerSchema` additionally have:

```ts
citations?: { paperKey: string; page: number; region?: Region }[];
contextSourceStatus?: 'current' | 'unknown' | 'pdf_changed' |
                      'layout_changed' | 'range_invalid' | 'unavailable';
```

These travel in the existing SSE `done.answer` event and persist in **`HistoryEntry.answer`**. Existing `delta`, `error`, `historyId`, list `data.history[]`, detail `data.history`, history cancel/delete and legacy `/chat` APIs remain compatible. New completion fields survive history reopen, sync pull and restart. A failed generation retains supplied provenance in `context`; it has no completed `answer`, so consumers check that retained anchor against their current PDF/layout before use.

Page markers alone never prove a particular paragraph/figure region. A supplied figure box, untagged selected text or a later-paragraph question therefore receives a **page-only citation**. A region is emitted only for an actual validated original `layoutRange`, from the envelope of its identified units when all have quads. That newly generated region declares `unrotated-crop-normalized-v1`, actual hash and the original layoutRange. It identifies the selected source passage, not model-verified grounding of every answer claim. Neither arbitrary first-block geometry nor arbitrary text matching establishes a region. Regions remain approximate font advance/ascent/descent envelopes; no OCR or glyph-outline precision is claimed.

## Coordinate and source semantics for consumers

Both frames are top-left, x right/y down, normalized relative to the **physical page crop**, rather than PDF media bounds or a text block. `rendered-page-normalized-v1` already includes intrinsic rotation; it matches new platform display-normalized stored annotation ratios. `unrotated-crop-normalized-v1` excludes intrinsic rotation and uses the accepted PdfTextLayout crop-relative source frame. PdfTextPage supplies the crop box, unrotated width/height, userUnit and separate intrinsic 0/90/180/270 rotation. `Block.pageOrdinal` remains a within-page ordinal, never a physical page index.

Shared `originalPointToRendered([x,y], provenance, rotation)` transforms only an explicitly declared unrotated point. Clockwise intrinsic rotation maps 0 to `(x,y)`, 90 to `(1-y,x)`, 180 to `(1-x,1-y)`, 270 to `(y,1-x)`. Transform each quad corner (or each box corner and then bound), mark resulting geometry rendered, and apply display scaling afterwards. Crop offsets have already been removed; do not subtract them again. Untagged historical points and explicitly rendered points pass through unchanged. The helper never changes stored annotation JSON or performs source checks by itself.

Call **`checkOriginalProvenance(provenance, {pdfSha256, blockExtractionVersion?, layout?: {page,extractionVersion,boundaries}})`** before using an anchor against current bytes. It reports `unknown` when no source hash was declared, `unavailable` when the declared source/layout cannot be checked, `pdf_changed`, `layout_changed` or `range_invalid` on mismatches, and `current` for a verified identity/range. The source layout physical page and enclosing physical page must also match `layoutRange.page`. Do not render/apply stale offsets. Keep the text, note, draft and declared geometry visible as retained context and request the matching PDF/layout or a fresh user selection. The helper does not reinterpret or discard data. Annotation sync stores a structurally valid stale declaration intact because it remains useful offline context; the reader owns validation at render/use time.

AI route checks use the actual local PDF bytes hash, not a guessed metadata hash. Layout checks reuse the existing bounded, deduplicated PdfTextLayoutService and its cache. Wrong layout versions do not trigger extraction. A queue/service failure can make geometry unavailable; there are no remote downloads. Stale geometry is excluded from question/explanation geometric grounding while its quote and original supplied context remain durable. New annotations are not automatically converted by the hub. Existing history/annotation raw records have no inferred source identity and keep their old display placement. Existing annotation timestamp/device tie-breaks, revision receipts, metadata CAS and sync cursors are unchanged.

## Exact HTTP defects corrected

POST **`/api/library/:key/pdf`** with `application/pdf` now passes the media-type exception for this exact route length, alongside the existing exact `/api/papers/upload`. The body still reaches the original PDF-link handler and its 50 MiB/PDF/source checks. Local loopback peer/Host, valid loopback Origin and startup token remain mandatory. Paired Bearer authentication remains mandatory on the device path. Other binary routes, suffix routes and unauthenticated callers do not gain admission. Success remains HTTP201 `{data: PublicationPdfLinkResult}`.

Optional `ask.page` and required `explain.page` must be positive physical one-based integers. When `Paper.pageCount` is known, a value beyond it is rejected **before history admission or provider generation**:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "<existing localized Invalid request message>",
    "retryable": false,
    "details": { "reason": "page_out_of_range", "page": 6, "pageCount": 5 }
  }
}
```

HTTP status is **400**. `AppError.details` is optional and specifically typed for this page error. Zero/negative/noninteger pages fail existing schema validation (400, no page-count details). An unavailable count is not invented from block ordinals; the supplied page remains unverified user context and can have a page-only citation. Supplied or fallback citation pages also cannot exceed a known count.

## Android API35 evidence limit

Checked current primary references on 2026-10-01: [PdfRenderer.Page.selectContent](<https://developer.android.com/reference/android/graphics/pdf/PdfRenderer.Page#selectContent(android.graphics.pdf.models.selection.SelectionBoundary,android.graphics.pdf.models.selection.SelectionBoundary)>) and [SelectionBoundary](https://developer.android.com/reference/android/graphics/pdf/models/selection/SelectionBoundary). API35 selection accepts point or native text-stream boundaries; returned indexes belong to that native stream. Boundary points use top-left page coordinates in points. This documentation and E's evidence do **not** establish native crop/intrinsic-rotation equivalence to B's PDF.js unrotated crop frame. No native device verification was performed here. Do not label native indexes as PdfTextLayout offsets or add an extra rotation based on an assumed equivalence. A consumer may declare a rendered frame only after its own native-to-displayed transform is established. API29–34 cached layout provenance continues to use the actual PDF hash and `pdfjs6-original-advances-v1`, separately from block `pdfjs6-lines-v4`.
