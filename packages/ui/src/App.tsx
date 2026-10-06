import { UpdateToast } from './updates/UpdateToast';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import type {
  AppError,
  ReadProgress,
  Block,
  Connection,
  InkStroke,
  Memo,
  PaperStructure,
  Highlight,
  Paper,
  Region,
  RestartTranslationRequest,
  Snapshot,
  OriginalProvenance,
} from '@fractal/shared';
import { useReaderProvenance } from './reader/useReaderProvenance';
import { useCatalog } from './shell/PublicationControls';
import { AnswerPopup, type AnswerAnchor } from './reader/AnswerPopup';
import { PanelResizeHandle, usePanelWidth } from './reader/PanelResizeHandle';
import { ResearchPanel, type ResearchIntent } from './reader/ResearchPanel';
import { HighlightPopover } from './components/HighlightLayer';
import { KoreanPages, type SelectVia } from './components/KoreanPane';
import { DeleteDialog, ReplacementDialog, type ReplacementRequest } from './components/ConfirmDialog';
import { PdfPages } from './components/PdfPane';
import type { InkProps, PageColors, StructureProps } from './components/PdfPane';
import { CitationCard, type CitationState } from './reader/Cards';
import { DESKTOP_PEN_WIDTH } from './reader/InkLayer';
import { NotesPanel } from './reader/NotesPanel';
import { PrintView, type PrintMode } from './reader/PrintView';
import { ReaderBar, type ViewMode } from './reader/ReaderBar';
import { SelectionMenu, type PendingSelection } from './reader/SelectionMenu';
import { SelectionQuote } from './components/SelectionQuote';
import { ApiClient, extractError, readToken } from './lib/api';
import { blockPage, type Size } from './lib/geometry';
import { koreanPageFallbackHeight, koreanPageHeight } from './lib/korean-page';
import { intrinsicSize, loadPdf, type PDFDocumentProxy } from './lib/pdf';
import { paperStatusLabel, pickDefaultModel, translationBlockedReason } from './lib/status';
import { t, useLanguage, type Language } from './i18n';
import { usePreferences } from './shell/preferences';
import { Welcome } from './shell/Welcome';
import type { InputIntent } from './shell/classify';
import { CommandPalette, type Command } from './shell/CommandPalette';
import { HomeScreen } from './shell/HomeScreen';
import { HubApi } from './shell/hub-api';
import { LibraryScreen } from './shell/LibraryScreen';
import { UsageBar } from './shell/UsageBar';
import { RelatedPanel } from './reader/RelatedPanel';
import { Masthead, type ShellView } from './shell/Masthead';
import { OmniInput } from './shell/OmniInput';
import { paperTitle } from './shell/paper-format';
import { SettingsScreen } from './shell/SettingsScreen';
import { Sidebar } from './shell/Sidebar';
import { THEME_CHOICES, nextTheme, useTheme } from './shell/theme';
import {
  beginProgrammaticScroll,
  createLinkState,
  mapScrollPosition,
  onUserScroll,
  orderedAnchors,
  pageBoundaries,
  pageTop,
  positionInPages,
  scrollTopForDescendant,
  scrollTopForPosition,
  type PageBox,
  type PagePosition,
  type Pane,
  type ScrollAnchor,
} from './lib/sync';
import { CONTROL_LIMITS, clampSplit, clampZoom, isReadable, nextPage, onePaneBesideChat, paragraphJumpDelay, shouldPoll } from './lib/view';

const POLL_MS = 1_500;
/** Widest a page is drawn by 폭 맞춤, in CSS pixels. */
const MAX_PAGE_WIDTH = 920;
const LOGIN_POLL_MS = 2_000;
const FALLBACK_INTRINSIC_SIZE: Size = { width: 640, height: 828 };
/** Where a confirmed restart waits until its answer is confirmed. Never holds login data. */
const PENDING_RESTART_KEY = 'paperread.pendingRestart';
/** Shown next to the button that performs the send; opening a paper sends nothing. */

/** The question panel's element, for the toolbar toggle's aria-controls. */
const CHAT_PANEL_ID = 'paper-chat';
/** How long the panel takes to slide open or shut (styles.css --chat-duration). */
const CHAT_TRANSITION_MS = 220;
/** Where the panel stops docking beside the reader and covers it as a sheet (styles.css). */
const CHAT_SHEET_QUERY = '(max-width: 999px)';

// The question panel (with its markdown and formula typesetting) loads the first time it opens.

const client = new ApiClient(readToken(document));
const hub = new HubApi(readToken(document));

/** Shell screens live in the URL hash (#/library, #/settings) so back/forward and links work. */
function viewFromHash(): ShellView {
  const name = window.location.hash.replace(/^#\/?/, '');
  return name === 'library' || name === 'settings' ? name : 'home';
}

/** An open paper is `#/paper/<key>`. */
function paperFromHash(): string | null {
  const match = /^#\/paper\/(.+)$/.exec(window.location.hash);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function paperHash(key: string): string {
  return `#/paper/${encodeURIComponent(key)}`;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Whether a media query matches now, kept up to date. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** A pane body the reader can see: laid out, and not the pane hidden in the one-pane layout. */
function paneVisible(body: HTMLElement | null): boolean {
  return body !== null && body.clientWidth > 0 && window.getComputedStyle(body).visibility === 'visible';
}

/** Whether text is selected inside `node`. */
function selectionWithin(node: HTMLElement | null): boolean {
  const selection = window.getSelection();
  return (
    node !== null && selection !== null && !selection.isCollapsed && selection.rangeCount > 0 && node.contains(selection.getRangeAt(0).commonAncestorContainer)
  );
}

interface PendingRestart extends RestartTranslationRequest {
  paperKey: string;
}

function readPendingRestart(): PendingRestart | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_RESTART_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<PendingRestart>;
    if (
      typeof value.paperKey !== 'string' ||
      typeof value.modelId !== 'string' ||
      typeof value.requestId !== 'string' ||
      typeof value.expectedJobId !== 'string'
    ) {
      return null;
    }
    return { paperKey: value.paperKey, modelId: value.modelId, requestId: value.requestId, expectedJobId: value.expectedJobId };
  } catch {
    return null;
  }
}

function writePendingRestart(value: PendingRestart | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(PENDING_RESTART_KEY);
    } else {
      window.sessionStorage.setItem(PENDING_RESTART_KEY, JSON.stringify(value));
    }
  } catch {
    /* storage may be unavailable; the request still goes out once */
  }
}

function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function leaderLabel(leader: Pane | null): string {
  if (leader === null) return t('reader.leaderWaiting');
  return leader === 'source' ? t('reader.leaderSource') : t('reader.leaderTranslation');
}

export function App(): JSX.Element {
  // Shell: which screen, the library search, the palette, the theme, a dragged-in PDF.
  const [view, setView] = useState<ShellView>(viewFromHash);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  // Languages and the first-run guide; the interface re-renders when its language changes.
  const language = useLanguage();
  const [preferences, updatePreferences] = usePreferences(hub);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const showWelcome = welcomeOpen || (preferences !== null && !preferences.onboardingCompleted);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const omniRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [paperKey, setPaperKey] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [modelId, setModelId] = useState<string>('');
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [openHighlightId, setOpenHighlightId] = useState<string | null>(null);

  // The question panel: open or shut, mounted from its first opening, and a passage to quote.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  const panelWidth = usePanelWidth();
  const [chatQuote, setChatQuote] = useState<ResearchIntent | null>(null);
  const [answerAnchor, setAnswerAnchor] = useState<AnswerAnchor | null>(null);
  const chatButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatDockRef = useRef<HTMLElement | null>(null);
  const quoteCount = useRef(0);
  const refitTimer = useRef<number | undefined>(undefined);
  // Below the sheet breakpoint the panel covers the reader; the covered reader is inert.
  const chatSheet = useMediaQuery(CHAT_SHEET_QUERY);
  const chatDocked = chatOpen && !chatSheet;
  const readerRef = useRef<HTMLDivElement | null>(null);
  const [readerWidth, setReaderWidth] = useState<number | null>(null);
  const onePane = onePaneBesideChat(readerWidth, chatDocked);

  // Replacement and deletion are confirmed in dialogs, never from a primary button.
  const [replacement, setReplacement] = useState<ReplacementRequest | null>(null);
  const [resetting, setResetting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);

  const resumeRead = useRef<ReadProgress | null>(null);
  const [renderedPaperKey, setRenderedPaperKey] = useState<string | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [split, setSplit] = useState(0.5);
  const [leader, setLeader] = useState<Pane | null>(null);
  const [narrowPane, setNarrowPane] = useState<Pane>('source');
  // 원문 alone until there is a translation to put beside it; the reader's own choice sticks per paper.
  const [viewMode, setViewMode] = useState<ViewMode>('source');
  const viewChosen = useRef(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  // What the hub recognised on this paper, and the card open over it.
  const [structure, setStructure] = useState<PaperStructure | null>(null);
  const [citation, setCitation] = useState<CitationState | null>(null);
  // A translated PDF being laid out for saving.
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);
  // Handwriting on this paper (from the tablet, or a desktop pen).
  const [memos, setMemos] = useState<Memo[]>([]);
  const memoQueue = useRef(new Map<string, Memo>());
  const [pdfFailure, setPdfFailure] = useState<string | null>(null);
  const [pdfRetry, setPdfRetry] = useState(0);
  const [inkStrokes, setInkStrokes] = useState<InkStroke[]>([]);
  // The side panel holds the reader's notes and the questions; one of them is in front.
  const [panelTab, setPanelTab] = useState<'notes' | 'questions' | 'history' | 'related'>('questions');

  const pdfBody = useRef<HTMLDivElement | null>(null);
  const textBody = useRef<HTMLDivElement | null>(null);
  const pageNodes = useRef(new Map<number, HTMLDivElement>());
  const intrinsic = useRef(new Map<number, Size>());
  const snapshotRef = useRef<Snapshot | null>(null);
  const paperKeyRef = useRef<string | null>(null);
  // Every paper switch and every confirmed restart moves the epoch; an answer from an
  // older epoch is dropped instead of overwriting the state it no longer describes.
  const epoch = useRef(0);
  const [intrinsicVersion, setIntrinsicVersion] = useState(0);
  const [koreanHeights, setKoreanHeights] = useState<Map<number, number>>(() => new Map());
  const link = useRef(createLinkState(true));
  // Whether the pane that follows sits where the link put it. A paragraph click moves one pane
  // to a page top on purpose; until the reader scrolls again, nothing pulls it back in line.
  const aligned = useRef(true);
  // Each pane's place (page and share of it) just before a zoom change, put back once the new
  // zoom is laid out; null when no zoom change is waiting.
  const zoomAnchor = useRef<{ source: PagePosition | null; translation: PagePosition | null } | null>(null);
  // A click on Korean text in the one-pane layout, waiting out a possible double-click.
  const koreanJump = useRef<number | undefined>(undefined);

  const paper = snapshot?.paper ?? null;
  const job = snapshot?.job ?? null;
  const readable = paper !== null && isReadable(paper.status);
  const originalAvailable = doc !== null;
  const documentHash = useMemo(
    () =>
      doc
        ? doc
            .getData()
            .then(async (bytes) =>
              Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), (b) => b.toString(16).padStart(2, '0')).join(''),
            )
        : null,
    [doc],
  );
  const getTextLayout = useCallback(
    async (page: number) => {
      if (!paperKey || !documentHash) return null;
      const [layout, hash] = await Promise.all([hub.textLayout(paperKey, page), documentHash]);
      return layout?.status === 'ready' && layout.pdfSha256 !== hash ? null : layout;
    },
    [paperKey, documentHash],
  );
  const provenanceReader = useReaderProvenance(doc, documentHash, paper?.extractionVersion ?? null, getTextLayout, highlights, memos);
  const catalog = useCatalog(hub),
    readerRecord = catalog.find((r) => r.paperKey === paperKey);
  const [savingReader, setSavingReader] = useState(false);
  const translated = (snapshot?.translations ?? []).some((t) => t.status === 'completed') || job?.state === 'running';

  // Once a translation exists it goes beside the original, unless the reader picked a view.
  useEffect(() => {
    if (translated && !viewChosen.current) setViewMode('split');
  }, [translated]);

  const chooseView = useCallback((mode: ViewMode) => {
    viewChosen.current = true;
    setViewMode(mode);
    if (mode !== 'split') setNarrowPane(mode);
  }, []);

  // Dark and sepia pages take the theme's paper and ink; light pages keep the PDF's own colours.
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolvedTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  const [pageColors, setPageColors] = useState<PageColors | undefined>(undefined);
  useEffect(() => {
    if (resolvedTheme === 'light') {
      setPageColors(undefined);
      return;
    }
    const style = getComputedStyle(document.documentElement);
    setPageColors({ background: style.getPropertyValue('--c-surface').trim(), foreground: style.getPropertyValue('--c-ink').trim() });
  }, [resolvedTheme]);
  const blockedReason = translationBlockedReason(connection, paper);
  const canTranslate = client.canMutate && blockedReason === null && !busy && !resetting;

  const fail = useCallback((cause: unknown) => setError(extractError(cause)), []);

  // ------------------------------------------------------------- connection

  const refreshConnection = useCallback(async () => {
    try {
      const value = await client.connection();
      setConnection(value);
      setModelId((current) => (current !== '' && value.modelIds.includes(current) ? current : (pickDefaultModel(value) ?? '')));
    } catch (cause) {
      fail(cause);
    }
  }, [fail]);

  const loadLibrary = useCallback(async () => {
    try {
      const { papers: stored } = await client.listPapers();
      setPapers(stored);
    } catch (cause) {
      fail(cause);
    }
  }, [fail]);

  useEffect(() => {
    void refreshConnection();
    void loadLibrary();
  }, [refreshConnection, loadLibrary]);
  useEffect(() => {
    const changed = () => void loadLibrary();
    window.addEventListener('fractal:catalog-changed', changed);
    return () => window.removeEventListener('fractal:catalog-changed', changed);
  }, [loadLibrary]);

  // Bibliography and cached reader files can arrive from another paired device.
  useEffect(() => {
    if (paperKey !== null || view !== 'library') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadLibrary();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [paperKey, view, loadLibrary]);

  // --------------------------------------------------------------- snapshot

  const applySnapshot = useCallback((next: Snapshot) => {
    const previous = snapshotRef.current;
    snapshotRef.current = next;
    setKoreanHeights((heights) => {
      return previous === null || previous.paper.paperKey !== next.paper.paperKey ? new Map() : heights;
    });
    setSnapshot(next);
  }, []);

  const refresh = useCallback(
    async (key: string) => {
      const mine = epoch.current;
      try {
        const next = await client.snapshot(key);
        // A late answer for a paper that was left, or for the epoch before a restart, is stale.
        if (epoch.current !== mine || paperKeyRef.current !== key) return;
        applySnapshot(next);
      } catch (cause) {
        if (epoch.current === mine && paperKeyRef.current === key) fail(cause);
      }
    },
    [applySnapshot, fail],
  );

  // Poll only while acquisition or a translation job is genuinely in flight.
  useEffect(() => {
    if (paperKey === null || paper === null) return;
    if (!shouldPoll(paper.status, job?.state ?? null)) return;
    const timer = window.setInterval(() => void refresh(paperKey), POLL_MS);
    return () => window.clearInterval(timer);
  }, [paperKey, paper, job?.state, refresh]);

  // The library mirrors what is stored; it changes when a paper finishes arriving.
  useEffect(() => {
    if (paper === null) return;
    void loadLibrary();
  }, [paper?.status, loadLibrary]);

  // Load the PDF once the revision's bytes exist.
  useEffect(() => {
    if (paperKey === null || paper === null || paper.status === 'fetching') return;
    const controller = new AbortController();
    let canceled = false;
    setPdfFailure(null);
    void loadPdf(client.pdfUrl(paperKey), controller.signal)
      .then((loaded) => {
        if (canceled) return;
        setDoc(loaded);
        setPageCount(loaded.numPages);
      })
      .catch((cause: unknown) => {
        if (!canceled) setPdfFailure(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      canceled = true;
      controller.abort();
    };
  }, [paperKey, paper?.status, pdfRetry]);

  // Read every page's native dimensions without rasterising it. Virtual Korean pages use
  // these same dimensions as measured pages and boundary calculations.
  useEffect(() => {
    intrinsic.current.clear();
    setKoreanHeights(new Map());
    setIntrinsicVersion((version) => version + 1);
    if (doc === null) return;
    let cancelled = false;
    void Promise.all(Array.from({ length: doc.numPages }, async (_, index) => [index + 1, intrinsicSize(await doc.getPage(index + 1))] as const)).then(
      (sizes) => {
        if (cancelled) return;
        for (const [page, size] of sizes) intrinsic.current.set(page, size);
        setIntrinsicVersion((version) => version + 1);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // ------------------------------------------------------------ enter/leave

  /** Make `key` the paper being read, dropping every answer still in flight for the old one. */
  const enterPaper = useCallback((key: string) => {
    if (window.location.hash !== paperHash(key)) window.history.pushState(null, '', paperHash(key));
    epoch.current += 1;
    paperKeyRef.current = key;
    snapshotRef.current = null;
    setPaperKey(key);
    setSnapshot(null);
    setDoc(null);
    resumeRead.current = null;
    setRenderedPaperKey(null);
    setPageCount(0);
    setCurrentPage(1);
    setHighlights([]);
    setMemos([]);
    setPdfFailure(null);
    setOpenHighlightId(null);
    setNarrowPane('source');
    setViewMode('source');
    viewChosen.current = false;
    setPendingSelection(null);
    setResetting(false);
    setReplacement(null);
    setChatOpen(false);
    setChatQuote(null);
    setAnswerAnchor(null);
    window.clearTimeout(koreanJump.current);
  }, []);

  /** Back to the library. Stored data stays; only this screen's view of it is dropped. */
  const leaveReader = useCallback(() => {
    epoch.current += 1;
    paperKeyRef.current = null;
    snapshotRef.current = null;
    setPaperKey(null);
    setSnapshot(null);
    setDoc(null);
    resumeRead.current = null;
    setRenderedPaperKey(null);
    setPageCount(0);
    setCurrentPage(1);
    setHighlights([]);
    setMemos([]);
    setPdfFailure(null);
    setOpenHighlightId(null);
    setResetting(false);
    setReplacement(null);
    setChatOpen(false);
    setChatQuote(null);
    setAnswerAnchor(null);
    window.clearTimeout(koreanJump.current);
  }, []);

  const openValue = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        // Opening a paper only downloads it; nothing is sent to the translator.
        const { paper: opened } = await client.openPaper(value);
        enterPaper(opened.paperKey);
        await refresh(opened.paperKey);
        void loadLibrary();
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    },
    [enterPaper, refresh, loadLibrary, fail],
  );

  /** Leave the reader if it is open, then show one of the shell screens. */
  const navigate = useCallback(
    (next: ShellView) => {
      if (paperKeyRef.current !== null) leaveReader();
      setView(next);
      const hash = next === 'home' ? '' : `#/${next}`;
      if (window.location.hash !== hash) window.history.pushState(null, '', hash === '' ? window.location.pathname : hash);
    },
    [leaveReader],
  );

  /** The single input: identifiers open a paper, anything else searches the library. */
  const submitIntent = useCallback(
    (intent: InputIntent) => {
      if (intent.kind === 'empty') return;
      if (intent.kind === 'search') {
        setLibraryQuery(intent.value);
        navigate('library');
        return;
      }
      void openValue(intent.value);
    },
    [navigate, openValue],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      if (file.type !== 'application/pdf' && !/.pdf$/i.test(file.name)) {
        setNotice(t('errors.pdfOnly'));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await hub.uploadPdf(file);
        if (result === null) {
          setNotice(t('errors.uploadUnsupported'));
          return;
        }
        enterPaper(result.paper.paperKey);
        await refresh(result.paper.paperKey);
        void loadLibrary();
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : t('errors.uploadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [enterPaper, refresh, loadLibrary],
  );

  /** A stored paper opens through the service: from disk when its extraction is current, or
   * re-extracted from the saved PDF when the format moved on — never re-downloaded. */
  const openStored = useCallback(
    async (key: string) => {
      setError(null);
      setBusy(true);
      try {
        const [{ paper: opened }, record] = await Promise.all([client.openPaper(key), hub.libraryRecord(key).catch(() => null)]);
        enterPaper(opened.paperKey);
        resumeRead.current = record?.readProgress ?? null;
        await refresh(opened.paperKey);
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    },
    [enterPaper, refresh, fail],
  );

  // Back/forward and links move between screens and papers; a paper link opens on load too.
  // `follow` reads the current hash each time, so the listener is registered once.
  const followHash = useRef<() => void>(() => undefined);
  followHash.current = () => {
    const key = paperFromHash();
    if (key !== null) {
      if (paperKeyRef.current !== key) void openStored(key);
      return;
    }
    if (paperKeyRef.current !== null) leaveReader();
    setView(viewFromHash());
  };
  useEffect(() => {
    const follow = () => followHash.current();
    if (paperFromHash() !== null) follow();
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await run();
        const key = paperKeyRef.current;
        if (key !== null) await refresh(key);
      } catch (cause) {
        fail(cause);
      } finally {
        setBusy(false);
      }
    },
    [refresh, fail],
  );

  const confirmDelete = useCallback(
    async (key: string) => {
      setDeleteConfirmation(null);
      await act(async () => {
        await client.deletePaper(key);
        if (paperKeyRef.current === key) leaveReader();
        await loadLibrary();
      });
    },
    [act, leaveReader, loadLibrary],
  );

  // ---------------------------------------------------------------- restart

  const sendRestart = useCallback(
    async (pending: PendingRestart) => {
      epoch.current += 1;
      const mine = epoch.current;
      setResetting(true);
      setError(null);
      // From the confirmation onwards the old Korean pages are hidden; the service's answer
      // decides what comes back — never a locally kept copy of the old translation.
      setSnapshot((current) => (current !== null && current.paper.paperKey === pending.paperKey ? { ...current, translations: [], job: null } : current));
      try {
        await client.restartTranslation(pending.paperKey, {
          modelId: pending.modelId,
          requestId: pending.requestId,
          expectedJobId: pending.expectedJobId,
        });
        writePendingRestart(null);
      } catch (cause) {
        const failure = extractError(cause);
        // A definitive refusal ends the request; a retryable one is re-sent as-is next time.
        if (!failure.retryable) writePendingRestart(null);
        setError(failure);
      } finally {
        if (epoch.current === mine) {
          setResetting(false);
          if (paperKeyRef.current === pending.paperKey) await refresh(pending.paperKey);
        }
      }
    },
    [refresh],
  );

  // A restart confirmed before a reload is finished with the same request, never a new one.
  useEffect(() => {
    const pending = readPendingRestart();
    if (pending === null) return;
    enterPaper(pending.paperKey);
    void sendRestart(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestReplacement = useCallback(() => {
    if (paperKey === null || job === null || modelId === '') return;
    const oldTranslationExists = (snapshot?.translations ?? []).some((t) => t.status === 'completed');
    setReplacement({ modelId, oldTranslationExists });
  }, [paperKey, job, modelId, snapshot]);

  const confirmReplacement = useCallback(
    (chosenModelId: string) => {
      if (paperKey === null || job === null) return;
      const pending: PendingRestart = { paperKey, modelId: chosenModelId, requestId: newRequestId(), expectedJobId: job.jobId };
      writePendingRestart(pending);
      setReplacement(null);
      void sendRestart(pending);
    },
    [paperKey, job, sendRestart],
  );

  // ------------------------------------------------------------- highlights

  // Load the highlight list once per paper; never mixed with the snapshot poll.
  useEffect(() => {
    if (paperKey === null) {
      setHighlights([]);
      setMemos([]);
      setPdfFailure(null);
      return;
    }
    let cancelled = false;
    void client
      .listHighlights(paperKey)
      .then((loaded) => {
        if (!cancelled) setHighlights(loaded);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [paperKey, fail]);

  const createHighlight = useCallback(
    async (
      page: number,
      rects: Region[],
      text: string,
      color: Highlight['color'] = 'yellow',
      selectedProvenance?: OriginalProvenance,
    ): Promise<Highlight | null> => {
      if (paperKey === null) return null;
      try {
        const hash = await documentHash;
        if (!hash) throw new Error('Original PDF identity unavailable');
        const provenance: OriginalProvenance = {
          ...selectedProvenance,
          coordinateSpace: 'rendered-page-normalized-v1',
          textSource: 'original',
          pdfSha256: hash,
        };
        if (provenance.layoutRange?.page !== page) delete provenance.layoutRange;
        const created = await client.createHighlight(paperKey, { page, rects, text, color, provenance });
        setHighlights((list) => [...list, created]);
        return created;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },
    [paperKey, fail, documentHash],
  );

  const openHighlight = useCallback((highlight: Highlight) => setOpenHighlightId(highlight.highlightId), []);

  const saveHighlight = useCallback(
    (note: string, color: Highlight['color']) => {
      if (paperKey === null || openHighlightId === null) return;
      void client
        .updateHighlight(paperKey, openHighlightId, { note: note.length === 0 ? null : note, color })
        .then((updated) => {
          setHighlights((list) => list.map((h) => (h.highlightId === updated.highlightId ? updated : h)));
          setOpenHighlightId(null);
        })
        .catch(fail);
    },
    [paperKey, openHighlightId, fail],
  );

  const removeHighlight = useCallback(() => {
    if (paperKey === null || openHighlightId === null) return;
    const id = openHighlightId;
    void client
      .deleteHighlight(paperKey, id)
      .then(() => {
        setHighlights((list) => list.filter((h) => h.highlightId !== id));
        setOpenHighlightId(null);
      })
      .catch(fail);
  }, [paperKey, openHighlightId, fail]);

  const openHighlightRecord = highlights.find((h) => h.highlightId === openHighlightId) ?? null;

  // ------------------------------------------------------- paragraph jumps

  const scrollPaneTo = useCallback((pane: Pane, top: number) => {
    const node = pane === 'source' ? pdfBody.current : textBody.current;
    if (node === null) return;
    // Mark the scroll as ours before it happens, so its echo never bounces back.
    beginProgrammaticScroll(link.current, pane, performance.now());
    node.scrollTo({ top });
  }, []);

  // ------------------------------------------------------------ scroll link

  const pageIntrinsicSize = useCallback((page: number) => intrinsic.current.get(page) ?? FALLBACK_INTRINSIC_SIZE, [intrinsicVersion]);

  const koreanPageBoundaries = useCallback(
    () =>
      pageBoundaries(pageCount, (page) => {
        return koreanPageHeight(koreanHeights.get(page), koreanPageFallbackHeight(pageIntrinsicSize(page), zoom));
      }),
    [koreanHeights, pageCount, pageIntrinsicSize, zoom],
  );

  /** Every page element of a pane, keyed by page: the source pane's from its registry, the
   * Korean pane's (drawn page or placeholder alike) from its `data-page` children. */
  const paneNodes = useCallback((pane: Pane): Map<number, HTMLElement> => {
    if (pane === 'source') return pageNodes.current;
    const nodes = new Map<number, HTMLElement>();
    for (const node of textBody.current?.querySelectorAll<HTMLElement>(':scope > [data-page]') ?? []) nodes.set(Number(node.dataset.page), node);
    return nodes;
  }, []);

  /** The page whose top has scrolled past the top of the pane. */
  const pageAtScroll = useCallback(
    (pane: Pane) => {
      const body = pane === 'source' ? pdfBody.current : textBody.current;
      if (body === null) return currentPage;
      let page = 1;
      for (const [candidate, node] of paneNodes(pane)) {
        const top = scrollTopForDescendant(node.getBoundingClientRect().top, body.getBoundingClientRect().top, body.scrollTop);
        if (top <= body.scrollTop + 1 && candidate > page) page = candidate;
      }
      return page;
    },
    [currentPage, paneNodes],
  );

  /** A Korean page's top as laid out now; the measured-height estimate only when it is not in
   * the pane at all. A stale estimate put the reader at the end of the previous page. */
  const koreanPageTop = useCallback(
    (page: number) => {
      const body = textBody.current;
      const node = paneNodes('translation').get(page);
      if (body === null || node === undefined) return pageTop(page, koreanPageBoundaries());
      return scrollTopForDescendant(node.getBoundingClientRect().top, body.getBoundingClientRect().top, body.scrollTop);
    },
    [koreanPageBoundaries, paneNodes],
  );

  const scrollKoreanToPage = useCallback((page: number) => scrollPaneTo('translation', koreanPageTop(page)), [koreanPageTop, scrollPaneTo]);

  const blocksById = useMemo(() => new Map((snapshot?.blocks ?? []).map((block) => [block.blockId, block] as const)), [snapshot?.blocks]);

  /**
   * Where the two panes show the same content right now, read from the laid-out pages: every
   * page's top and bottom edge in both panes, and on each drawn Korean page the top of every
   * paragraph and crop against where that block starts on the original page. A page shown as
   * the original image (or not drawn yet) maps edge to edge.
   */
  const scrollAnchors = useCallback((): ScrollAnchor[] => {
    const sourceBody = pdfBody.current;
    const koreanBody = textBody.current;
    if (sourceBody === null || koreanBody === null) return [];
    const sourceTop = sourceBody.getBoundingClientRect().top - sourceBody.scrollTop;
    const koreanTop = koreanBody.getBoundingClientRect().top - koreanBody.scrollTop;
    const koreanNodes = paneNodes('translation');
    const anchors: ScrollAnchor[] = [];
    for (const [page, sourceNode] of pageNodes.current) {
      const koreanNode = koreanNodes.get(page);
      if (koreanNode === undefined) continue;
      const source = sourceNode.getBoundingClientRect();
      const korean = koreanNode.getBoundingClientRect();
      const sourcePageTop = source.top - sourceTop;
      const koreanPageTopPx = korean.top - koreanTop;
      anchors.push(
        { source: sourcePageTop, translation: koreanPageTopPx },
        { source: sourcePageTop + source.height, translation: koreanPageTopPx + korean.height },
      );
      if (koreanNode.classList.contains('kr-source-only') || koreanNode.classList.contains('kr-placeholder')) continue;
      for (const element of koreanNode.querySelectorAll<HTMLElement>('[data-block-id]')) {
        const region = blocksById.get(element.dataset.blockId ?? '')?.regions.find((candidate) => candidate.page === page);
        if (region === undefined) continue;
        anchors.push({ source: sourcePageTop + region.y * source.height, translation: element.getBoundingClientRect().top - koreanTop });
      }
    }
    return orderedAnchors(anchors);
  }, [blocksById, paneNodes]);

  /**
   * Line for line: the content at the top of the pane being read is brought to the top of the
   * other pane, interpolated between the nearest shared anchors — not only when a page
   * boundary is crossed.
   */
  const alignFollower = useCallback(
    (leading: Pane) => {
      const following: Pane = leading === 'source' ? 'translation' : 'source';
      const from = leading === 'source' ? pdfBody.current : textBody.current;
      const to = following === 'source' ? pdfBody.current : textBody.current;
      if (from === null || to === null) return;
      const top = Math.max(0, mapScrollPosition(from.scrollTop, scrollAnchors(), leading));
      aligned.current = true;
      if (Math.abs(to.scrollTop - top) >= 1) scrollPaneTo(following, top);
    },
    [scrollAnchors, scrollPaneTo],
  );
  const alignFollowerRef = useRef(alignFollower);
  alignFollowerRef.current = alignFollower;

  const follow = useCallback(
    (pane: Pane) => {
      const decision = onUserScroll(link.current, pane, performance.now());
      setLeader(link.current.leader);
      if (!decision.follow || decision.target === null) return;
      setCurrentPage(pageAtScroll(pane));
      alignFollower(pane);
    },
    [alignFollower, pageAtScroll],
  );

  // Korean pages are drawn, re-measured and re-laid out as the reader moves and translations
  // arrive, and every time the shared anchors move with them. The pane that follows is brought
  // back in line at most once a frame; with nobody leading yet, the original leads.
  const realignFrame = useRef<number | null>(null);
  const realign = useCallback(() => {
    if (realignFrame.current !== null) return;
    realignFrame.current = window.requestAnimationFrame(() => {
      realignFrame.current = null;
      if (!aligned.current || !link.current.enabled) return;
      alignFollowerRef.current(link.current.leader ?? 'source');
    });
  }, []);
  useEffect(
    () => () => {
      if (realignFrame.current !== null) window.cancelAnimationFrame(realignFrame.current);
    },
    [],
  );

  // A Korean page above the reader re-measured and the pane kept its place by shifting its own
  // scroll position: that is not the reader scrolling, and must not take the lead.
  const onKoreanAdjustScroll = useCallback(() => {
    beginProgrammaticScroll(link.current, 'translation', performance.now());
  }, []);

  const onPdfScroll = useCallback(() => {
    follow('source');
  }, [follow]);

  const onTextScroll = useCallback(() => follow('translation'), [follow]);

  // ------------------------------------------------------------- registries

  const registerPage = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element === null) {
      pageNodes.current.delete(page);
    } else {
      pageNodes.current.set(page, element);
    }
  }, []);

  const recordSize = useCallback((page: number, size: Size) => {
    const previous = intrinsic.current.get(page);
    intrinsic.current.set(page, size);
    if (previous?.width !== size.width || previous.height !== size.height) setIntrinsicVersion((version) => version + 1);
  }, []);

  // The Korean page's rendered height is not known ahead of time — translated text and
  // cropped figures decide it. The pane reports it here; the next stage uses it for the
  // Korean pane's own page-boundary math.
  const recordKoreanHeight = useCallback(
    (page: number, heightPx: number) => {
      setKoreanHeights((heights) => {
        if (heights.get(page) === heightPx) return heights;
        const next = new Map(heights);
        next.set(page, heightPx);
        return next;
      });
      realign();
    },
    [realign],
  );

  /** Every page of a pane as laid out now, in the pane's scroll coordinates. */
  const paneBoxes = useCallback(
    (pane: Pane): PageBox[] => {
      const body = pane === 'source' ? pdfBody.current : textBody.current;
      if (body === null) return [];
      const bodyTop = body.getBoundingClientRect().top;
      const boxes: PageBox[] = [];
      for (const [page, node] of paneNodes(pane)) {
        const rect = node.getBoundingClientRect();
        boxes.push({ page, top: scrollTopForDescendant(rect.top, bodyTop, body.scrollTop), height: rect.height });
      }
      return boxes;
    },
    [paneNodes],
  );

  /** The page at the top of a laid-out pane and how far into it; null for a pane not laid out. */
  const panePosition = useCallback(
    (pane: Pane): PagePosition | null => {
      const body = pane === 'source' ? pdfBody.current : textBody.current;
      if (body === null || body.clientHeight === 0) return null;
      return positionInPages(paneBoxes(pane), body.scrollTop);
    },
    [paneBoxes],
  );

  const onPdfRendered = useCallback(
    (page: number) => {
      const body = pdfBody.current;
      const key = paperKeyRef.current;
      if (!body || !key || !paneVisible(body) || document.visibilityState !== 'visible') return;
      const resume = resumeRead.current;
      if (resume && pageCount > 0) {
        resumeRead.current = null;
        const targetPage = Math.min(resume.page, pageCount);
        setCurrentPage(targetPage);
        const top = scrollTopForPosition({ page: targetPage, fraction: resume.scrollOffset ?? 0 }, paneBoxes('source'));
        if (top !== null) scrollPaneTo('source', top);
        if (targetPage !== page) return;
      }
      const node = pageNodes.current.get(page);
      if (
        !node ||
        node.getBoundingClientRect().bottom <= body.getBoundingClientRect().top ||
        node.getBoundingClientRect().top >= body.getBoundingClientRect().bottom
      )
        return;
      setRenderedPaperKey(key);
    },
    [pageCount, paneBoxes, scrollPaneTo],
  );

  // An actual rendered, visible document records reading; acquisition and library browsing do not.
  useEffect(() => {
    if (!paperKey || renderedPaperKey !== paperKey || !doc || pageCount < 1) return;
    const key = paperKey;
    let timer: number | undefined;
    let latest: ReadProgress | null = null;
    let sent = '';
    const flush = () => {
      if (!latest || JSON.stringify(latest) === sent) return;
      const progress = latest;
      sent = JSON.stringify(progress);
      void hub
        .recordRead(key, progress)
        .catch(() =>
          setNotice(
            language === 'ko'
              ? '읽기 위치를 저장하지 못했습니다. 논문을 다시 열어 재시도하세요.'
              : 'Reading position could not be saved. Reopen the paper to retry.',
          ),
        );
    };
    const observe = () => {
      if (document.visibilityState !== 'visible') return;
      const pane = paneVisible(pdfBody.current) ? 'source' : 'translation';
      const body = pane === 'source' ? pdfBody.current : textBody.current;
      if (!paneVisible(body)) return;
      const position = panePosition(pane) ?? { page: 1, fraction: 0 };
      latest = {
        page: position.page,
        scrollOffset: position.fraction,
        fraction: Math.max(0, Math.min(1, (position.page - 1 + position.fraction) / pageCount)),
      };
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 500);
    };
    const source = pdfBody.current;
    const translation = textBody.current;
    source?.addEventListener('scroll', observe, { passive: true });
    translation?.addEventListener('scroll', observe, { passive: true });
    document.addEventListener('visibilitychange', observe);
    observe();
    return () => {
      window.clearTimeout(timer);
      source?.removeEventListener('scroll', observe);
      translation?.removeEventListener('scroll', observe);
      document.removeEventListener('visibilitychange', observe);
      flush();
    };
  }, [paperKey, renderedPaperKey, doc, pageCount, panePosition, language]);

  const changeZoom = useCallback(
    (delta: number) => {
      const previousZoom = zoomRef.current;
      const nextZoom = clampZoom(previousZoom + delta);
      if (nextZoom === previousZoom) return;
      // Every page grows or shrinks with the zoom while the scroll positions stay put, so the
      // reader's place is noted here (the first change of a burst counts) and put back below.
      if (zoomAnchor.current === null) zoomAnchor.current = { source: panePosition('source'), translation: panePosition('translation') };
      zoomRef.current = nextZoom;
      const scale = nextZoom / previousZoom;
      setKoreanHeights((heights) => new Map([...heights].map(([page, height]) => [page, height * scale])));
      setZoom(nextZoom);
    },
    [panePosition],
  );

  // After a zoom change, each pane goes back to the same page and the same share of it. The
  // original's pages already have their new size; the Korean pages are drawn again at the new
  // zoom and meanwhile hold their measured heights scaled with it, so their places come from
  // those. Browser scroll anchoring is off (styles.css), and no scroll event would fire for a
  // position that did not change — so the page readout and which pages are drawn are updated
  // here too.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    if (anchor === null) return;
    zoomAnchor.current = null;
    const leader = link.current.leader ?? 'source';
    const restore = (pane: Pane, position: PagePosition | null, boxes: PageBox[]) => {
      const body = pane === 'source' ? pdfBody.current : textBody.current;
      if (body === null || position === null) return;
      const top = scrollTopForPosition(position, boxes);
      if (top === null || Math.abs(body.scrollTop - top) < 1) return;
      beginProgrammaticScroll(link.current, pane, performance.now());
      body.scrollTop = top;
    };
    const koreanBoxes = () => koreanPageBoundaries().map((boundary) => ({ page: boundary.page, top: boundary.top, height: boundary.bottom - boundary.top }));
    // The leading pane last: its move is the one marked as ours while the other one's echo is
    // held back as not the leader's.
    for (const pane of leader === 'source' ? (['translation', 'source'] as const) : (['source', 'translation'] as const)) {
      restore(pane, anchor[pane], pane === 'source' ? paneBoxes('source') : koreanBoxes());
    }
    const page = anchor[leader]?.page ?? anchor.source?.page ?? anchor.translation?.page;
    if (page !== undefined) setCurrentPage(page);
  }, [zoom, koreanPageBoundaries, paneBoxes]);

  /** The zoom at which the current page's width fills the source pane, or null when unknown. */
  const fitZoom = useCallback((): number | null => {
    const body = pdfBody.current;
    if (body === null) return null;
    const size = intrinsic.current.get(currentPage) ?? intrinsic.current.get(1);
    if (size === undefined || size.width <= 0) return null;
    // Pane padding on both sides plus a hairline, so no horizontal scrollbar appears.
    // Alone on a wide screen a page would grow past a comfortable reading measure.
    const available = Math.min(body.clientWidth - 24 - 2, MAX_PAGE_WIDTH);
    return available <= 0 ? null : clampZoom(available / size.width);
  }, [currentPage]);

  /** Zoom so the current page's width fills the source pane, the usual reading default. */
  const fitWidth = useCallback(() => {
    const zoomToFit = fitZoom();
    if (zoomToFit !== null) changeZoom(zoomToFit - zoomRef.current);
  }, [changeZoom, fitZoom]);
  const fitWidthRef = useRef(fitWidth);
  fitWidthRef.current = fitWidth;

  // Handwriting arrives from the tablet through the hub; it is re-read while the paper is open.
  useEffect(() => {
    if (paperKey === null) {
      setInkStrokes([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      hub
        .annotations(paperKey)
        .then((list) => {
          if (!cancelled && list !== null) {
            setInkStrokes(list.filter((a): a is InkStroke => a.kind === 'ink' && !a.deleted));
            const remote = list.filter((a): a is Memo => a.kind === 'memo' && !a.deleted);
            const pending = [...memoQueue.current.values()].filter((m) => m.paperKey === paperKey);
            setMemos([...remote.filter((m) => !pending.some((p) => p.id === m.id)), ...pending.filter((m) => !m.deleted)]);
          }
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [paperKey]);

  // Recognition runs in the background after a paper is extracted; poll until it settles.
  useEffect(() => {
    setStructure(null);
    setCitation(null);
    if (paperKey === null) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = () => {
      hub
        .structure(paperKey)
        .then((result) => {
          if (cancelled || result === null) return;
          setStructure(result);
          if (result.status === 'running' || result.status === 'pending') timer = window.setTimeout(load, 3_000);
        })
        .catch(() => undefined);
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [paperKey]);

  const saveMemo = useCallback((memo: Memo) => {
    const next = { ...memo, updatedAt: new Date().toISOString() };
    memoQueue.current.set(next.id, next);
    try {
      localStorage.setItem(`fractal.memo-pending.${next.id}`, JSON.stringify(next));
    } catch {
      /* retry stays in memory */
    }
    if (paperKeyRef.current === next.paperKey) setMemos((rows) => [...rows.filter((m) => m.id !== next.id), ...(!next.deleted ? [next] : [])]);
    void hub
      .saveAnnotation(next)
      .then((result) => {
        if (result === null) throw new Error('Annotations unavailable');
        if (memoQueue.current.get(next.id)?.updatedAt === next.updatedAt) {
          memoQueue.current.delete(next.id);
          try {
            localStorage.removeItem(`fractal.memo-pending.${next.id}`);
          } catch {
            /* durable server copy exists */
          }
        }
        if (paperKeyRef.current === next.paperKey)
          setMemos((rows) => rows.map((m) => (m.id === next.id && m.updatedAt === next.updatedAt ? { ...m, rev: result.rev } : m)));
      })
      .catch((cause: unknown) => setNotice(String(cause)));
  }, []);
  useEffect(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('fractal.memo-pending.')) {
          const memo = JSON.parse(localStorage.getItem(key)!) as Memo;
          memoQueue.current.set(memo.id, memo);
        }
      }
    } catch {
      /* retain valid in-memory drafts */
    }
    const retry = () => {
      for (const memo of memoQueue.current.values()) saveMemo(memo);
    };
    retry();
    window.addEventListener('online', retry);
    const timer = setInterval(retry, 15000);
    return () => {
      window.removeEventListener('online', retry);
      clearInterval(timer);
    };
  }, [saveMemo]);
  const createMemo = async (page: number, position: Region | null, quote: string) => {
    if (!paperKey) return;
    const hash = await documentHash?.catch(() => null);
    if (!hash) {
      setNotice(language === 'ko' ? '원본 PDF를 확인한 후 다시 시도하세요.' : 'Wait for the original PDF to load, then retry.');
      return;
    }
    const width = 0.32,
      height = 0.25;
    const memo: Memo = {
      id: newRequestId(),
      kind: 'memo',
      paperKey,
      page,
      text: '',
      quote: quote || null,
      rect: { x: Math.min(1 - width, position?.x ?? 0.1), y: Math.min(1 - height, position?.y ?? 0.1), width, height },
      collapsed: false,
      color: 'yellow',
      updatedAt: new Date().toISOString(),
      rev: 0,
      deviceId: 'desktop',
      deleted: false,
      provenance: { coordinateSpace: 'rendered-page-normalized-v1', textSource: 'original', pdfSha256: hash },
    };
    saveMemo(memo);
    if (paperKeyRef.current === paperKey) {
      chooseView('source');
      goToPage(page);
    }
  };
  const passageAnchor = (page: number, rect?: { x: number; y: number; width: number; height: number }, point?: { x: number; y: number }): AnswerAnchor => {
    const element = pageNodes.current.get(page);
    const box = element?.getBoundingClientRect();
    return {
      element,
      rect:
        box && rect
          ? new DOMRect(box.left + rect.x * box.width, box.top + rect.y * box.height, rect.width * box.width, rect.height * box.height)
          : new DOMRect(point?.x ?? box?.left ?? 24, point?.y ?? box?.top ?? 80, 0, 0),
    };
  };
  const structureProps = useMemo<StructureProps | undefined>(() => {
    if (paperKey === null || structure === null) return undefined;
    return {
      items: structure.items,
      markers: structure.markers,
      onExplain: (item, anchor) => {
        const renderedPage = pageNodes.current.get(item.page)?.querySelector('canvas')?.getBoundingClientRect();
        const renderedBox =
          renderedPage && renderedPage.width > 0 && renderedPage.height > 0
            ? {
                x: Math.max(0, (anchor.left - renderedPage.left) / renderedPage.width),
                y: Math.max(0, (anchor.top - renderedPage.top) / renderedPage.height),
                width: Math.min(1, anchor.width / renderedPage.width),
                height: Math.min(1, anchor.height / renderedPage.height),
              }
            : null;
        quoteCount.current += 1;
        const surrounding = (snapshotRef.current?.blocks ?? [])
          .filter((b) => b.regions.some((r) => r.page === item.page))
          .map((b) => b.sourceText)
          .join('\n')
          .slice(0, 6000);
        setChatQuote({
          id: quoteCount.current,
          text: [item.label, item.caption, item.latex, surrounding].filter(Boolean).join('\n'),
          page: item.page,
          from: 'source',
          rect: renderedBox ?? item.bbox,
          kind: item.kind,
          ...(provenanceReader.pdfSha256
            ? {
                provenance: {
                  ...(renderedBox ? { coordinateSpace: 'rendered-page-normalized-v1' as const } : {}),
                  textSource: 'original',
                  pdfSha256: provenanceReader.pdfSha256,
                  blockExtractionVersion: paper?.extractionVersion ?? undefined,
                },
              }
            : {}),
        });
        setAnswerAnchor(null);
        setChatMounted(true);
        setChatOpen(true);
        setPanelTab('questions');
        setCitation(null);
      },
      onCitation: (marker, anchor) => {
        setCitation({ anchor, entries: null, error: null, added: new Set() });
        Promise.all(marker.references.slice(0, 4).map((n) => hub.reference(paperKey, n)))
          .then((results) => setCitation((s) => (s === null ? s : { ...s, entries: results.filter((r) => r !== null) })))
          .catch((cause: unknown) =>
            setCitation((s) => (s === null ? s : { ...s, error: cause instanceof Error ? cause.message : t('reader.referenceFailed') })),
          );
      },
    };
  }, [paperKey, structure, provenanceReader.pdfSha256, paper?.extractionVersion]);

  const ink = useMemo<InkProps | undefined>(() => {
    if (paperKey === null) return undefined;
    return {
      strokes: inkStrokes,
      // Stored as an absolute colour so every device draws the same ink; dark themes invert it on screen.
      color: '#1C1B19',
      onCreate: (page, points, color) => {
        const stroke: InkStroke = {
          kind: 'ink',
          id: newRequestId(),
          paperKey,
          page,
          tool: 'pen',
          color,
          width: DESKTOP_PEN_WIDTH,
          points: points.map(([x, y, p, t]) => [x, y, Math.min(1, Math.max(0, p)), Math.max(0, t)]),
          updatedAt: new Date().toISOString(),
          deleted: false,
          rev: 0,
          deviceId: 'desktop',
        };
        setInkStrokes((list) => [...list, stroke]);
        void hub.saveAnnotation(stroke).catch(fail);
      },
      onErase: (stroke) => {
        setInkStrokes((list) => list.filter((s) => s.id !== stroke.id));
        void hub.saveAnnotation({ ...stroke, deleted: true, updatedAt: new Date().toISOString(), deviceId: 'desktop' }).catch(fail);
      },
    };
  }, [paperKey, inkStrokes, fail]);

  // One pane or two: the page width changes, so the page is fitted again.
  useEffect(() => {
    const timer = window.setTimeout(() => fitWidthRef.current(), 60);
    return () => window.clearTimeout(timer);
  }, [viewMode]);

  // The first time a document's page sizes are known, start at fit-width rather than 100%.
  const fittedDoc = useRef<PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (doc === null || fittedDoc.current === doc || intrinsic.current.size === 0) return;
    fittedDoc.current = doc;
    fitWidth();
  }, [doc, intrinsicVersion, fitWidth]);

  const selectKoreanBlock = useCallback(
    (block: Block, via: SelectVia) => {
      const page = blockPage(block);
      if (page === null) return;
      window.clearTimeout(koreanJump.current);
      const jump = () => {
        aligned.current = false;
        setCurrentPage(page);
        setNarrowPane('source');
        window.requestAnimationFrame(() => {
          const node = pageNodes.current.get(page);
          const body = pdfBody.current;
          if (node !== undefined && body !== null) {
            scrollPaneTo('source', scrollTopForDescendant(node.getBoundingClientRect().top, body.getBoundingClientRect().top, body.scrollTop));
          }
        });
      };
      const delay = paragraphJumpDelay(via, paneVisible(pdfBody.current));
      if (delay === 0) {
        jump();
        return;
      }
      // Only the Korean pane is shown and the jump would hide it: a double-click that selects a
      // word to quote must get its second click in first.
      koreanJump.current = window.setTimeout(() => {
        if (!selectionWithin(textBody.current)) jump();
      }, delay);
    },
    [scrollPaneTo],
  );
  useEffect(() => () => window.clearTimeout(koreanJump.current), []);

  const selectSourceBlock = useCallback(
    (block: Block) => {
      const page = blockPage(block);
      if (page === null) return;
      aligned.current = false;
      setCurrentPage(page);
      setNarrowPane('translation');
      window.requestAnimationFrame(() => scrollKoreanToPage(page));
    },
    [scrollKoreanToPage],
  );

  // Both panes go to the page's top, which is in line by definition.
  const goToPage = useCallback(
    (page: number) => {
      aligned.current = true;
      setCurrentPage(page);
      window.requestAnimationFrame(() => {
        const node = pageNodes.current.get(page);
        const body = pdfBody.current;
        if (node !== undefined && body !== null) {
          scrollPaneTo('source', scrollTopForDescendant(node.getBoundingClientRect().top, body.getBoundingClientRect().top, body.scrollTop));
        }
        scrollKoreanToPage(page);
      });
    },
    [scrollKoreanToPage, scrollPaneTo],
  );

  // [p.N] in an answer opens that page of the original (Markdown renders them as .page-ref).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const ref = (event.target as HTMLElement | null)?.closest<HTMLElement>('.page-ref[data-page]');
      if (ref === null || ref === undefined) return;
      const page = Number(ref.dataset.page);
      if (!Number.isInteger(page) || page < 1) return;
      if (viewMode === 'translation') chooseView('source');
      goToPage(Math.min(page, pageCount || page));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [goToPage, pageCount, viewMode, chooseView]);

  // ---------------------------------------------------------- question panel

  /**
   * Open or shut the question panel. The docked panel narrows the reading panes; a source page
   * that was fitted to its pane's width is fitted again once the panel has finished moving.
   */
  const showChat = useCallback(
    (open: boolean, reading?: Pane) => {
      const zoomToFit = fitZoom();
      const fitted = zoomToFit !== null && Math.abs(zoomToFit - zoomRef.current) < 0.005;
      if (open) {
        setChatMounted(true);
        // Beside the docked panel a cramped reader shows one pane (onePaneBesideChat): keep the
        // one being read — where the quote came from, else the one the reader last scrolled.
        if (paneVisible(pdfBody.current) && paneVisible(textBody.current)) {
          const keep = reading ?? link.current.leader;
          if (keep !== null) setNarrowPane(keep);
        }
      }
      setChatOpen(open);
      if (!open) {
        // Focus that sat in the panel goes back to the toggle instead of vanishing with it.
        const active = document.activeElement;
        if (active === null || active === document.body || chatDockRef.current?.contains(active) === true) chatButtonRef.current?.focus();
      }
      window.clearTimeout(refitTimer.current);
      if (fitted) refitTimer.current = window.setTimeout(() => fitWidthRef.current(), prefersReducedMotion() ? 0 : CHAT_TRANSITION_MS + 40);
    },
    [fitZoom],
  );
  useEffect(() => () => window.clearTimeout(refitTimer.current), []);

  const closeChat = useCallback(() => showChat(false), [showChat]);
  /** The panel's buttons: open on that tab, switch tabs while open, or close from the tab in front. */
  const togglePanel = useCallback(
    (tab: 'notes' | 'questions') => {
      if (chatOpen && panelTab === tab) {
        showChat(false);
        return;
      }
      setPanelTab(tab);
      if (!chatOpen) showChat(true);
    },
    [chatOpen, panelTab, showChat],
  );
  const toggleChat = useCallback(() => togglePanel('questions'), [togglePanel]);
  const toggleNotes = useCallback(() => togglePanel('notes'), [togglePanel]);

  /** AI connection lives in Settings: the top bar and the question panel both go there. */
  const openSettingsAt = useCallback(
    (section: 'ai' | 'interests') => {
      navigate('settings');
      window.requestAnimationFrame(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' }));
    },
    [navigate],
  );
  const openAiSettings = useCallback(() => openSettingsAt('ai'), [openSettingsAt]);

  /** Open an answer beside the quoted passage. */
  const askAbout = useCallback(
    (text: string, from: Pane, page = currentPage) => {
      quoteCount.current += 1;
      setChatQuote({ id: quoteCount.current, text, page, from, ...(from === 'translation' ? { provenance: { textSource: 'translated' } } : {}) });
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      setAnswerAnchor(range ? { rect: range.getBoundingClientRect(), element: range.startContainer.parentElement } : passageAnchor(page));
    },
    [currentPage],
  );
  const askAboutKorean = useCallback((text: string, page?: number) => askAbout(text, 'translation', page), [askAbout]);
  const askAboutSource = useCallback((text: string) => askAbout(text, 'source'), [askAbout]);

  // The reader's width decides whether two panes still fit beside the docked panel.
  useEffect(() => {
    const reader = readerRef.current;
    if (reader === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setReaderWidth(reader.clientWidth));
    observer.observe(reader);
    return () => observer.disconnect();
  }, [paperKey]);

  // Global keyboard shortcuts, skipped while the reader is typing or a dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      // The question panel scrolls and closes with its own keys.
      if (target !== null && typeof target.closest === 'function' && target.closest('.chat-dock') !== null) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') {
        // A panel control that was used went away (or was disabled) under the focus, which fell
        // to the page: Escape still closes the panel.
        if (chatOpen && replacement === null && deleteConfirmation === null && (target === null || target === document.body)) {
          closeChat();
          event.preventDefault();
        }
        return;
      }
      if (replacement !== null || deleteConfirmation !== null) return;
      switch (event.key) {
        case '+':
        case '=':
          changeZoom(CONTROL_LIMITS.zoom.step);
          break;
        case '-':
          changeZoom(-CONTROL_LIMITS.zoom.step);
          break;
        case 'PageDown':
          goToPage(nextPage(currentPage, 1, pageCount));
          break;
        case 'PageUp':
          goToPage(nextPage(currentPage, -1, pageCount));
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeZoom, currentPage, pageCount, goToPage, replacement, deleteConfirmation, chatOpen, closeChat]);

  // ------------------------------------------------------------------ view

  // Ctrl/⌘+K opens the palette from anywhere, including inside inputs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A PDF dragged onto the window is imported; the outline shows only while files hover.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) void uploadFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [uploadFile]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const commands = useMemo<Command[]>(() => {
    const other: Language = language === 'ko' ? 'en' : 'ko';
    const list: Command[] = [
      { id: 'go-home', group: t('palette.groupGo'), label: t('nav.home'), keywords: 'home 홈', run: () => navigate('home') },
      { id: 'go-library', group: t('palette.groupGo'), label: t('nav.library'), keywords: 'library 보관함', run: () => navigate('library') },
      { id: 'go-settings', group: t('palette.groupGo'), label: t('nav.settings'), keywords: 'settings preferences 설정', run: () => navigate('settings') },
      {
        id: 'open-input',
        group: t('palette.groupPaper'),
        label: t('palette.openInput'),
        keywords: 'arxiv doi url open',
        hint: t('palette.inputHint'),
        run: () => omniRef.current?.focus(),
      },
      { id: 'upload-pdf', group: t('palette.groupPaper'), label: t('omni.uploadPdf'), keywords: 'upload file pdf', run: () => fileRef.current?.click() },
      {
        id: 'theme-next',
        group: t('palette.groupView'),
        label: t('palette.themeNext'),
        keywords: 'theme dark sepia 테마',
        hint: t(THEME_CHOICES.find((choice) => choice.value === nextTheme(theme))?.label ?? 'theme.light'),
        run: () => setTheme(nextTheme(theme)),
      },
      ...THEME_CHOICES.map((choice) => ({
        id: `theme-${choice.value}`,
        group: t('palette.groupView'),
        label: t('palette.themeOne', { name: t(choice.label) }),
        keywords: `theme ${choice.value}`,
        run: () => setTheme(choice.value),
      })),
      {
        id: 'language',
        group: t('palette.groupView'),
        label: t('palette.language', { name: other === 'ko' ? '한국어' : 'English' }),
        keywords: 'language 언어 english korean',
        run: () => updatePreferences({ uiLanguage: other }),
      },
      { id: 'ai-settings', group: t('palette.groupAi'), label: t('palette.aiSettings'), keywords: 'ai codex claude login 로그인', run: openAiSettings },
      { id: 'welcome', group: t('palette.groupView'), label: t('palette.welcome'), keywords: 'welcome guide 가이드', run: () => setWelcomeOpen(true) },
    ];
    if (paperKey !== null) {
      list.splice(3, 0, {
        id: 'toggle-chat',
        group: t('palette.groupReading'),
        label: chatOpen ? t('palette.chatClose') : t('palette.chatOpen'),
        keywords: 'chat ask question 질문',
        run: toggleChat,
      });
    }
    for (const p of papers) {
      list.push({
        id: `paper-${p.paperKey}`,
        group: t('palette.groupLibrary'),
        label: paperTitle(p),
        keywords: `${p.authors.join(' ')} ${p.arxivId ?? ''}`,
        run: () => void openStored(p.paperKey),
      });
    }
    return list;
  }, [navigate, theme, setTheme, paperKey, chatOpen, toggleChat, papers, openStored, openAiSettings, language, updatePreferences]);
  const activePane: Pane = viewMode === 'split' ? narrowPane : viewMode;
  const deleteTarget =
    deleteConfirmation === null
      ? undefined
      : (papers.find((p) => p.paperKey === deleteConfirmation) ?? (paper?.paperKey === deleteConfirmation ? paper : undefined));

  if (showWelcome && preferences !== null && paperKey === null) {
    return (
      <Welcome
        hub={hub}
        preferences={preferences}
        onPreferencesChange={updatePreferences}
        onDone={() => {
          setWelcomeOpen(false);
          updatePreferences({ onboardingCompleted: true });
          navigate('home');
          void loadLibrary();
        }}
      />
    );
  }

  return (
    <div className={`app${paperKey === null ? ' app--workspace' : ''}`}>
      <Masthead
        view={paperKey !== null ? 'reader' : view}
        onNavigate={navigate}
        onOpenPalette={() => setPaletteOpen(true)}
        input={<OmniInput ref={omniRef} busy={busy} disabled={!client.canMutate} onSubmit={submitIntent} onFile={(file) => void uploadFile(file)} />}
        account={
          <button type="button" className="masthead__account" data-state={connection?.status === 'subscription' ? 'on' : 'off'} onClick={openAiSettings}>
            {connection?.status === 'subscription' ? t('ai.statusReady') : t('ai.statusNone')}
          </button>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void uploadFile(file);
          event.target.value = '';
        }}
      />

      {!client.canMutate ? (
        <div className="notice warn" role="alert">
          <span className="notice__text">{t('reader.notServed')}</span>
        </div>
      ) : null}

      {error !== null ? (
        <div className="notice error" role="alert">
          <span className="notice__text">
            {error.message}
            {error.retryable ? t('reader.retryable') : ''}
          </span>
          <button type="button" onClick={() => setError(null)} aria-label={t('errors.close')}>
            {t('errors.closeLabel')}
          </button>
        </div>
      ) : null}

      {paperKey === null ? (
        <div className="app__page">
          {view !== 'library' ? <Sidebar view={view} onNavigate={navigate} /> : null}
          {view === 'home' ? (
            <HomeScreen
              hub={hub}
              papers={papers}
              onOpen={(key) => void openStored(key)}
              onOpenExternal={(value) => void openValue(value)}
              onShowLibrary={() => navigate('library')}
              onEditInterests={() => openSettingsAt('interests')}
            />
          ) : view === 'library' ? (
            <LibraryScreen
              papers={papers}
              query={libraryQuery}
              onQueryChange={setLibraryQuery}
              onOpen={(key) => void openStored(key)}
              onRequestDelete={setDeleteConfirmation}
              onImport={() => fileRef.current?.click()}
              onNavigate={navigate}
              hub={hub}
            />
          ) : (
            <SettingsScreen
              hub={hub}
              theme={theme}
              onThemeChange={setTheme}
              preferences={preferences}
              onPreferencesChange={updatePreferences}
              onShowWelcome={() => setWelcomeOpen(true)}
            />
          )}
        </div>
      ) : (
        <main className="reader-shell">
          <ReaderBar
            saved={{
              value: readerRecord?.saved ?? false,
              busy: savingReader,
              onToggle: () => {
                if (savingReader) return;
                setSavingReader(true);
                void hub
                  .patchLibrary(paperKey, { saved: !(readerRecord?.saved ?? false) })
                  .catch(fail)
                  .finally(() => setSavingReader(false));
              },
            }}
            language={preferences?.translationLanguage ?? 'ko'}
            onLanguage={(translationLanguage) => updatePreferences({ translationLanguage })}
            paper={paper}
            job={job}
            currentPage={currentPage}
            pageCount={pageCount}
            zoom={zoom}
            onPage={(page) => goToPage(nextPage(page, 0, pageCount))}
            onZoom={(direction) => changeZoom(direction * CONTROL_LIMITS.zoom.step)}
            onFitWidth={fitWidth}
            viewMode={viewMode}
            narrow={onePane}
            onViewMode={chooseView}
            modelIds={connection?.modelIds ?? []}
            selectedModelId={modelId}
            canTranslate={canTranslate}
            disabledReason={resetting ? t('reader.resetting') : blockedReason}
            sendHint={t('reader.sendHint')}
            onModelChange={setModelId}
            onStart={(chosen) => {
              chooseView('split');
              void act(() => client.startTranslation(paperKey, chosen));
            }}
            onPause={(jobId) => void act(() => client.pauseJob(jobId))}
            onResume={(jobId) => void act(() => client.resumeJob(jobId))}
            onRequestReplacement={requestReplacement}
            chat={{ open: chatOpen && panelTab === 'questions', controls: CHAT_PANEL_ID, onToggle: toggleChat, buttonRef: chatButtonRef }}
            notes={{ open: chatOpen && panelTab === 'notes', onToggle: toggleNotes }}
            exportLinks={[
              { label: t('reader.exportMarkdown'), href: `/api/papers/${encodeURIComponent(paperKey)}/export/markdown`, download: `${paperKey}.md` },
              { label: 'BibTeX', href: `/api/papers/${encodeURIComponent(paperKey)}/export/bibtex`, download: `${paperKey}.bib` },
            ]}
            onRequestDelete={() => setDeleteConfirmation(paperKey)}
            pdf={
              translated || (snapshot?.translations ?? []).length > 0
                ? {
                    busy: printMode !== null,
                    note:
                      job !== null && job.completedBlocks < job.totalTranslatableBlocks
                        ? t('reader.pdfPartial', { done: job.completedBlocks, total: job.totalTranslatableBlocks })
                        : null,
                    onSave: (mode) => {
                      setNotice(t('reader.pdfPreparing'));
                      setPrintMode(mode);
                    },
                  }
                : undefined
            }
          />
          {replacement !== null ? (
            <ReplacementDialog
              paper={paper}
              replacement={replacement}
              canTranslate={canTranslate}
              onConfirm={() => confirmReplacement(replacement.modelId)}
              onCancel={() => setReplacement(null)}
            />
          ) : null}

          <div className="reader-stage">
            {paper !== null && !originalAvailable ? (
              <div className="reader-status" role="status" inert={chatOpen && chatSheet}>
                <p className="eyebrow">{pdfFailure ? t('reader.source') : paper.paperKey}</p>
                <h2>{pdfFailure ? (language === 'ko' ? '원본 PDF를 열지 못했습니다' : 'Could not open the original PDF') : paperStatusLabel(paper)}</h2>
                {pdfFailure ? (
                  <>
                    <p role="alert">{pdfFailure}</p>
                    <button onClick={() => setPdfRetry((n) => n + 1)}>{language === 'ko' ? '원본 다시 불러오기' : 'Retry original PDF'}</button>
                  </>
                ) : (
                  <p>{t('reader.fetching')}</p>
                )}
              </div>
            ) : null}

            <div
              ref={readerRef}
              className={`reader narrow${onePane || viewMode !== 'split' ? ' one-pane' : ''}${resetting ? ' resetting' : ''}`}
              hidden={paper !== null && !originalAvailable}
              // Covered by the panel's sheet on a narrow screen: out of reach until it closes.
              inert={chatOpen && chatSheet}
            >
              <section className={`pane ${activePane === 'source' ? '' : 'hidden'}`} style={{ flex: `0 0 ${split * 100}%` }} aria-label={t('reader.source')}>
                <PdfPages
                  doc={doc}
                  onRendered={onPdfRendered}
                  pageCount={pageCount}
                  currentPage={currentPage}
                  zoom={zoom}
                  blocks={snapshot?.blocks ?? []}
                  highlights={provenanceReader.displayHighlights}
                  pageIntrinsicSize={pageIntrinsicSize}
                  onSize={recordSize}
                  registerPage={registerPage}
                  bodyRef={pdfBody}
                  onScroll={onPdfScroll}
                  onSelectBlock={selectSourceBlock}
                  onSelectText={setPendingSelection}
                  pending={pendingSelection}
                  pageColors={pageColors}
                  ink={ink}
                  structure={structureProps}
                  getLayout={getTextLayout}
                  memos={provenanceReader.displayMemos}
                  onSaveMemo={(memo) => saveMemo(provenanceReader.storedMemo(memo))}
                  onOpenHighlight={openHighlight}
                />
                {openHighlightRecord !== null ? (
                  <HighlightPopover
                    key={openHighlightRecord.highlightId}
                    highlight={openHighlightRecord}
                    anchor={passageAnchor(openHighlightRecord.page, openHighlightRecord.rects[0]).rect}
                    onSave={saveHighlight}
                    onDelete={removeHighlight}
                    onClose={() => setOpenHighlightId(null)}
                    onAsk={(text) => {
                      quoteCount.current += 1;
                      setChatQuote({
                        id: quoteCount.current,
                        text,
                        page: openHighlightRecord.page,
                        from: 'source',
                        rect: openHighlightRecord.rects[0],
                        provenance: openHighlightRecord.provenance,
                      });
                      setAnswerAnchor(passageAnchor(openHighlightRecord.page, openHighlightRecord.rects[0]));
                    }}
                  />
                ) : null}
              </section>

              <button
                type="button"
                className="splitter"
                aria-label={t('reader.splitter')}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') setSplit((s) => clampSplit(s - CONTROL_LIMITS.split.step));
                  if (event.key === 'ArrowRight') setSplit((s) => clampSplit(s + CONTROL_LIMITS.split.step));
                }}
                onPointerDown={(event) => {
                  const start = event.clientX;
                  const startSplit = split;
                  const width = event.currentTarget.parentElement?.clientWidth ?? 1;
                  const move = (e: PointerEvent) => setSplit(clampSplit(startSplit + (e.clientX - start) / width));
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              />

              <section className={`pane ${activePane === 'translation' ? '' : 'hidden'}`} style={{ flex: '1 1 0' }} aria-label={t('reader.translation')}>
                {!readable ? (
                  <div className="translation-unavailable" role="status">
                    <h2>{language === 'ko' ? '추출된 텍스트 없음' : 'Extracted text unavailable'}</h2>
                    <p>
                      {language === 'ko'
                        ? '원본 PDF를 그대로 읽고 영역을 선택해 메모하거나 질문할 수 있습니다. 텍스트 없는 페이지를 번역문으로 표시하지 않습니다.'
                        : 'Read the original PDF and deliberately select a region for notes or questions. No translation text is available for this extraction.'}
                    </p>
                    <button onClick={() => chooseView('source')}>{t('reader.source')}</button>
                  </div>
                ) : (
                  <KoreanPages
                    pageColors={pageColors}
                    doc={doc}
                    pageCount={pageCount}
                    currentPage={currentPage}
                    zoom={zoom}
                    blocks={snapshot?.blocks ?? []}
                    translations={snapshot?.translations ?? []}
                    pageHeights={koreanHeights}
                    pageIntrinsicSize={pageIntrinsicSize}
                    onPageHeight={recordKoreanHeight}
                    bodyRef={textBody}
                    onScroll={onTextScroll}
                    onAdjustScroll={onKoreanAdjustScroll}
                    onSelectBlock={selectKoreanBlock}
                  />
                )}
                <SelectionQuote containerRef={textBody} onQuote={askAboutKorean} />
              </section>
            </div>

            {chatOpen ? <button type="button" className="chat-scrim" aria-label={t('reader.closeQuestions')} tabIndex={-1} onClick={closeChat} /> : null}
            <aside
              style={panelWidth.style}
              ref={chatDockRef}
              id={CHAT_PANEL_ID}
              className={`chat-dock${chatOpen ? ' is-open' : ''}`}
              aria-label={t('reader.questionsPanel')}
              // As a sheet it covers the reader, which is inert meanwhile; the toolbar above stays
              // reachable (it holds the toggle that closes the sheet), so the dialog is not modal.
              role={chatSheet && chatOpen ? 'dialog' : undefined}
            >
              {!chatSheet && chatOpen ? <PanelResizeHandle width={panelWidth.width} onChange={panelWidth.update} /> : null}
              <div
                className="panel-tabs"
                role="tablist"
                aria-label={t('reader.sidePanel')}
                onKeyDown={(event) => {
                  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
                  const index = buttons.indexOf(event.target as HTMLButtonElement);
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : event.key === 'ArrowRight'
                          ? (index + 1) % buttons.length
                          : event.key === 'ArrowLeft'
                            ? (index + buttons.length - 1) % buttons.length
                            : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    buttons[next].click();
                    buttons[next].focus();
                  }
                }}
              >
                <button type="button" role="tab" aria-selected={panelTab === 'notes'} onClick={() => setPanelTab('notes')}>
                  {t('reader.notes')} <span className="panel-tabs__count">{highlights.length + memos.length || ''}</span>
                </button>
                <button type="button" role="tab" aria-selected={panelTab === 'questions'} onClick={() => setPanelTab('questions')}>
                  {t('reader.questions')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panelTab === 'history'}
                  onClick={() => {
                    setChatMounted(true);
                    setPanelTab('history');
                  }}
                >
                  {language === 'ko' ? '기록' : 'History'}
                </button>
                <button type="button" role="tab" aria-selected={panelTab === 'related'} onClick={() => setPanelTab('related')}>
                  {t('related.tab')}
                </button>
              </div>
              {panelTab === 'related' ? <RelatedPanel hub={hub} paperKey={paperKey} papers={papers} onOpen={(key) => void openStored(key)} /> : null}
              {panelTab === 'notes' ? (
                <NotesPanel
                  checkSource={provenanceReader.checkSource}
                  highlights={highlights}
                  memos={memos}
                  onCreate={() => createMemo(currentPage, null, '')}
                  onMemo={(m) => {
                    chooseView('source');
                    goToPage(m.page);
                    saveMemo({ ...m, collapsed: false });
                    requestAnimationFrame(() => {
                      const node = pageNodes.current.get(m.page),
                        body = pdfBody.current;
                      if (node && body) body.scrollTop += Math.max(0, (m.rect?.y ?? 0) * node.clientHeight - 30);
                    });
                  }}
                  onOpen={(h) => {
                    if (viewMode === 'translation') chooseView('source');
                    goToPage(h.page);
                    setOpenHighlightId(h.highlightId);
                  }}
                />
              ) : null}
              <div className="chat-dock__inner" hidden={panelTab !== 'questions' && panelTab !== 'history'}>
                {chatMounted && paperKey ? (
                  <ResearchPanel
                    checkSource={provenanceReader.checkSource}
                    key={paperKey}
                    hub={hub}
                    paperKey={paperKey}
                    open={chatOpen}
                    historyMode={panelTab === 'history'}
                    answerLanguage={preferences?.answerLanguage || undefined}
                    intent={chatQuote && !answerAnchor ? chatQuote : null}
                    onClose={closeChat}
                    onQuestion={() => setPanelTab('questions')}
                    onPage={(page) => {
                      chooseView('source');
                      goToPage(page);
                    }}
                    onSettings={openAiSettings}
                  />
                ) : null}
              </div>
            </aside>
          </div>
        </main>
      )}

      <UpdateToast />
      <UsageBar hub={hub} onOpenSettings={openAiSettings} />

      {deleteConfirmation !== null ? (
        <DeleteDialog
          paper={deleteTarget}
          paperKey={deleteConfirmation}
          onCancel={() => setDeleteConfirmation(null)}
          onConfirm={() => void confirmDelete(deleteConfirmation)}
        />
      ) : null}

      {paperKey && chatQuote && answerAnchor ? (
        <AnswerPopup
          key={`${paperKey}:${chatQuote.id}`}
          answerLanguage={preferences?.answerLanguage || undefined}
          hub={hub}
          paperKey={paperKey}
          intent={chatQuote}
          anchor={answerAnchor}
          onClose={() => {
            setChatQuote(null);
            setAnswerAnchor(null);
          }}
          onSettings={openAiSettings}
          onPage={(page) => {
            chooseView('source');
            goToPage(page);
          }}
          checkSource={provenanceReader.checkSource}
        />
      ) : null}

      {pendingSelection !== null ? (
        <SelectionMenu
          selection={pendingSelection}
          onClose={() => setPendingSelection(null)}
          onHighlight={(color) => {
            const { regions, text, pageTexts } = pendingSelection;
            setPendingSelection(null);
            for (const page of new Set(regions.map((r) => r.page)))
              void createHighlight(
                page,
                regions.filter((r) => r.page === page),
                pageTexts?.[page] ?? text,
                color,
                pendingSelection.provenance,
              );
          }}
          onMemo={() => {
            const { page, regions, text } = pendingSelection;
            setPendingSelection(null);
            createMemo(page, regions[0] ?? null, text);
          }}
          onAsk={() => {
            const selection = pendingSelection;
            setPendingSelection(null);
            quoteCount.current += 1;
            setChatQuote({
              id: quoteCount.current,
              text: selection.text,
              page: selection.page,
              from: 'source',
              rect: selection.regions[0],
              kind: 'text',
              provenance:
                selection.provenance ??
                (provenanceReader.pdfSha256
                  ? { coordinateSpace: 'rendered-page-normalized-v1', textSource: 'original', pdfSha256: provenanceReader.pdfSha256 }
                  : undefined),
            });
            setAnswerAnchor(passageAnchor(selection.page, selection.regions[0], selection.anchor));
          }}
        />
      ) : null}

      {citation !== null && paperKey !== null ? (
        <CitationCard
          state={citation}
          onClose={() => setCitation(null)}
          onOpenUrl={(url) => window.open(url, '_blank', 'noopener')}
          onAdd={(n) => {
            hub
              .addReference(paperKey, n)
              .then(() => {
                setCitation((s) => (s === null ? s : { ...s, added: new Set(s.added).add(n) }));
                void loadLibrary();
              })
              .catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : t('errors.addFailed')));
          }}
        />
      ) : null}

      {printMode !== null && doc !== null && paper !== null ? (
        <PrintView
          mode={printMode}
          doc={doc}
          pageCount={pageCount}
          blocks={snapshot?.blocks ?? []}
          translations={snapshot?.translations ?? []}
          pageIntrinsicSize={pageIntrinsicSize}
          onReady={() => {
            const name = `${(paper.title ?? paper.paperKey).replace(/[\\/:*?"<>|]+/g, ' ').trim()} — ${printMode === 'split' ? t('reader.viewSplit') : t('reader.translation')}.pdf`;
            // Paper is always light, whatever the screen theme.
            const root = document.documentElement;
            const theme = root.getAttribute('data-theme');
            root.setAttribute('data-theme', 'light');
            const restore = () => {
              if (theme === null) root.removeAttribute('data-theme');
              else root.setAttribute('data-theme', theme);
              setPrintMode(null);
            };
            const desktop = window.fractalDesktop;
            if (desktop !== undefined) {
              desktop
                .savePdf({ suggestedName: name })
                .then((result) => setNotice(result.saved ? t('reader.pdfSaved') : null))
                .catch(() => setNotice(t('reader.pdfFailed')))
                .finally(restore);
            } else {
              setNotice(null);
              window.addEventListener('afterprint', restore, { once: true });
              window.print();
            }
          }}
        />
      ) : null}

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />

      {dragging ? (
        <div className="drop-target" aria-hidden="true">
          <p>{t('reader.dropToAdd')}</p>
        </div>
      ) : null}

      {notice !== null ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t('errors.close')}>
            {t('errors.closeLabel')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
