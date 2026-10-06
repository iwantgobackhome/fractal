import { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { AnswerPlacement, ContextSourceStatus, HistoryEntry, OriginalProvenance, PdfTextLayout, Region } from '@fractal/shared';
import { useLanguage } from '../i18n';
import type { HubApi } from '../shell/hub-api';
import { ResearchPanel, type ResearchIntent } from './ResearchPanel';
import { groupThreads, threadKey } from './research-state';
import { clampCard, defaultPlacement, mergeLineRegions, threadRoot } from './answer-placement';
import { renderedRegion } from './useReaderProvenance';
export interface AnswerAnchor {
  rect: DOMRect;
  element?: HTMLElement | null;
}
interface Card {
  threadId: string;
  rootId?: string;
  intent: ResearchIntent | null;
  source: ResearchIntent;
  placement: AnswerPlacement;
}
export function openAnswerThread(rows: HistoryEntry[]) {
  window.dispatchEvent(new CustomEvent('fractal:open-answer-thread', { detail: rows }));
}
export function AnswerPopup({
  hub,
  paperKey,
  intent,
  anchor,
  answerLanguage,
  onPage,
  onSettings,
  checkSource,
  getLayout,
}: {
  hub: HubApi;
  paperKey: string;
  intent: ResearchIntent | null;
  anchor: AnswerAnchor | null;
  answerLanguage?: string;
  getLayout(page: number): Promise<PdfTextLayout | null>;
  onPage(page: number): void;
  onSettings(): void;
  checkSource(provenance?: OriginalProvenance): Promise<ContextSourceStatus>;
}): JSX.Element {
  const [cards, setCards] = useState<Card[]>([]);
  const [pages, setPages] = useState<Map<number, HTMLElement>>(new Map());
  const latest = useRef(cards);
  latest.current = cards;
  const seen = useRef<number | null>(null);
  const pending = useRef(new Map<string, AnswerPlacement>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saving = useRef(new Set<string>());
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const flush = async (card: Card) => {
    if (!card.rootId || saving.current.has(card.threadId)) return;
    saving.current.add(card.threadId);
    try {
      while (pending.current.has(card.threadId)) {
        const placement = pending.current.get(card.threadId)!;
        await hub.saveAnswerPlacement(paperKey, card.rootId, placement);
        if (pending.current.get(card.threadId) === placement) pending.current.delete(card.threadId);
      }
    } catch {
      // Keep the newest placement for the next history refresh after recovery.
    } finally {
      saving.current.delete(card.threadId);
    }
  };
  const source = (root: HistoryEntry): ResearchIntent => ({
    id: 0,
    page: root.context.page ?? root.placement?.page ?? 1,
    text: root.context.selectedText ?? '',
    from: root.context.provenance?.textSource === 'translated' ? 'translation' : 'source',
    rect: root.context.rect,
    kind: root.context.explanationKind,
    provenance: root.context.provenance,
  });
  useEffect(() => {
    const scan = () => {
      const next = new Map<number, HTMLElement>();
      document.querySelectorAll<HTMLElement>('[data-testid="pdf-body"] .pdf-page').forEach((el) => next.set(Number(el.dataset.page), el));
      setPages((old) => (old.size === next.size && [...next].every(([p, el]) => old.get(p) === el) ? old : next));
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const rows = await hub.history(paperKey);
        if (!live || !rows) return;
        const groups = groupThreads(rows.filter((e) => !e.deleted));
        {
          const next = latest.current.map((card) => {
            const root = threadRoot(groups.find((g) => threadKey(g[0]) === card.threadId) ?? []);
            return root ? { ...card, rootId: root.id, intent: null } : card;
          });
          for (const group of groups) {
            const root = threadRoot(group)!;
            if (next.some((c) => c.threadId === threadKey(root)) || !root.placement || root.placement.state === 'dismissed') continue;
            const s = source(root);
            next.push({ threadId: threadKey(root), rootId: root.id, intent: null, source: s, placement: root.placement });
          }
          for (const card of next) {
            const placement = pending.current.get(card.threadId);
            if (placement && card.rootId && !timers.current.has(card.threadId)) void flush(card);
          }
          setCards(next);
        }
      } catch {
        /* retain cards while offline */
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    const reopen = (event: Event) => {
      const root = threadRoot((event as CustomEvent<HistoryEntry[]>).detail);
      if (!root) return;
      const s = source(root);
      const page = document.querySelector<HTMLElement>(`[data-testid="pdf-body"] .pdf-page[data-page="${s.page}"]`);
      const placement: AnswerPlacement = {
        ...(root.placement ?? { page: s.page, ...defaultPlacement(s.rect, page?.getBoundingClientRect() ?? { width: 800, height: 1000 }) }),
        state: 'open',
        updatedAt: new Date().toISOString(),
      };
      pending.current.set(threadKey(root), placement);
      setCards((old) => [
        ...old.filter((c) => c.threadId !== threadKey(root)),
        { threadId: threadKey(root), rootId: root.id, intent: null, source: s, placement },
      ]);
      onPageRef.current(placement.page);
    };
    window.addEventListener('fractal:open-answer-thread', reopen);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('fractal:open-answer-thread', reopen);
      for (const t of timers.current.values()) clearTimeout(t);
      for (const card of latest.current) void flush(card);
    };
  }, [hub, paperKey]);
  useEffect(() => {
    if (!intent || !anchor || seen.current === intent.id) return;
    seen.current = intent.id;
    const page = document.querySelector<HTMLElement>(`[data-testid="pdf-body"] .pdf-page[data-page="${intent.page}"]`);
    const pageBox = page?.getBoundingClientRect() ?? { width: 800, height: 1000 };
    let point = defaultPlacement(intent.rect, pageBox);
    // Stagger repeated questions at the same source so earlier card headings stay reachable.
    const nearby = latest.current.filter(
      (c) =>
        c.placement.page === intent.page &&
        c.placement.state !== 'dismissed' &&
        Math.abs(c.placement.x - point.x) * pageBox.width < 40 &&
        Math.abs(c.placement.y - point.y) * pageBox.height < 120,
    ).length;
    if (nearby)
      point = clampCard(
        { x: point.x + (nearby * 32) / pageBox.width, y: point.y + (nearby * 48) / pageBox.height },
        Math.min(420, pageBox.width),
        Math.min(560, pageBox.height),
        pageBox,
      );
    const placement: AnswerPlacement = {
      page: intent.page,
      ...point,
      state: 'open',
      updatedAt: new Date().toISOString(),
    };
    const card = { threadId: crypto.randomUUID(), intent, source: intent, placement };
    pending.current.set(card.threadId, placement);
    setCards((old) => [...old, card]);
  }, [intent, anchor]);
  const update = (card: Card, change: Partial<AnswerPlacement>) => {
    const placement = { ...card.placement, ...change, updatedAt: new Date().toISOString() };
    pending.current.set(card.threadId, placement);
    setCards((old) => old.map((c) => (c.threadId === card.threadId ? { ...c, placement } : c)));
    clearTimeout(timers.current.get(card.threadId));
    timers.current.set(
      card.threadId,
      setTimeout(() => {
        timers.current.delete(card.threadId);
        void flush(latest.current.find((c) => c.threadId === card.threadId) ?? card);
      }, 200),
    );
  };
  return (
    <>
      {cards
        .filter((c) => c.placement.state !== 'dismissed')
        .map((card) => {
          const page = pages.get(card.placement.page);
          return page
            ? createPortal(
                <PageCard
                  key={card.threadId}
                  card={card}
                  page={page}
                  update={(change) => update(card, change)}
                  hub={hub}
                  paperKey={paperKey}
                  answerLanguage={answerLanguage}
                  onPage={onPage}
                  onSettings={onSettings}
                  checkSource={checkSource}
                  getLayout={getLayout}
                />,
                page,
                card.threadId,
              )
            : null;
        })}
    </>
  );
}
function PageCard({
  card,
  page,
  update,
  hub,
  paperKey,
  answerLanguage,
  onPage,
  onSettings,
  checkSource,
  getLayout,
}: {
  getLayout(page: number): Promise<PdfTextLayout | null>;
  card: Card;
  page: HTMLElement;
  update(change: Partial<AnswerPlacement>): void;
  hub: HubApi;
  paperKey: string;
  answerLanguage?: string;
  onPage(page: number): void;
  onSettings(): void;
  checkSource(provenance?: OriginalProvenance): Promise<ContextSourceStatus>;
}) {
  const ko = useLanguage() === 'ko',
    say = (en: string, kr: string) => (ko ? kr : en);
  const host = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLElement>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [hover, setHover] = useState(false),
    [focused, setFocused] = useState(false),
    [moving, setMoving] = useState<{ x: number; y: number } | null>(null),
    [valid, setValid] = useState(false);
  const collapsed = card.placement.state === 'collapsed',
    position = moving ?? card.placement;
  useEffect(() => {
    if (card.intent) heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const status = await checkSource(card.source.provenance);
      if (!live) return;
      setValid(status === 'current' || status === 'unknown');
      const range = card.source.provenance?.layoutRange;
      const layout = await getLayout(card.source.page).catch(() => null);
      const rotation = layout?.status === 'ready' ? layout.page.rotation : 0;
      let shown: Region[] = [];
      if (range && layout?.status === 'ready') {
        shown = layout.page.runs
          .flatMap((run) => run.units)
          .filter((unit) => unit.start < range.end && unit.end > range.start && unit.quad)
          .map((unit) => {
            const xs = unit.quad!.map((p) => p[0]),
              ys = unit.quad!.map((p) => p[1]);
            return renderedRegion(
              {
                page: card.source.page,
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
              },
              { coordinateSpace: 'unrotated-crop-normalized-v1' },
              rotation,
            );
          });
      }
      if (!shown.length && card.source.rect) shown = [renderedRegion({ ...card.source.rect, page: card.source.page }, card.source.provenance, rotation)];
      if (live) setRegions(mergeLineRegions(shown));
    })();
    return () => {
      live = false;
    };
  }, [card.source, checkSource, getLayout]);
  const clamp = (p: { x: number; y: number }) => {
    const box = host.current?.getBoundingClientRect();
    return clampCard(p, box?.width ?? 420, box?.height ?? 560, page.getBoundingClientRect());
  };
  const current = useRef({ position, update, moving });
  current.current = { position, update, moving };
  useEffect(() => {
    const place = () => {
      if (current.current.moving) return;
      const next = clamp(current.current.position);
      if (Math.abs(next.x - current.current.position.x) > 0.00001 || Math.abs(next.y - current.current.position.y) > 0.00001) current.current.update(next);
    };
    const observer = new ResizeObserver(place);
    observer.observe(page);
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [page]);
  const drag = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    heading.current?.focus({ preventScroll: true });
    const box = page.getBoundingClientRect(),
      start = { x: event.clientX, y: event.clientY };
    let next = { x: position.x, y: position.y };
    setMoving(next);
    const move = (e: PointerEvent) => {
      next = clamp({ x: position.x + (e.clientX - start.x) / box.width, y: position.y + (e.clientY - start.y) / box.height });
      setMoving(next);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      update(next);
      setMoving(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  return (
    <>
      {(hover || focused || moving) && valid && card.source.from === 'source' && !page.classList.contains('pdf-placeholder')
        ? regions.map((rect, index) => (
            <div
              key={index}
              className="answer-source-highlight"
              data-thread-id={card.threadId}
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
            />
          ))
        : null}
      <div
        ref={host}
        role="dialog"
        aria-label={say('Answer about selection', '선택 영역 답변')}
        className={`answer-popup${collapsed ? ' answer-popup--collapsed' : ''}`}
        data-thread-id={card.threadId}
        style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            update({ state: 'collapsed' });
          }
        }}
      >
        <header
          ref={heading}
          tabIndex={0}
          className="answer-popup__header"
          onPointerDown={drag}
          aria-label={say('Move answer with arrow keys or drag', '방향키 또는 드래그로 답변 이동')}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            const d = ({ ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] } as Record<string, number[]>)[e.key];
            if (d) {
              e.preventDefault();
              const box = page.getBoundingClientRect();
              update(clamp({ x: position.x + d[0] / box.width, y: position.y + d[1] / box.height }));
            }
          }}
        >
          {!collapsed ? (
            <strong>
              {say('Answer', '답변')} · p.{card.placement.page}
            </strong>
          ) : null}
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? say('Expand answer', '답변 펼치기') : say('Collapse answer', '답변 접기')}
            onClick={() => update({ state: collapsed ? 'open' : 'collapsed' })}
          >
            {collapsed ? (card.source.kind && card.source.kind !== 'text' ? 'i' : '?') : '−'}
          </button>
          {!collapsed ? (
            <button
              aria-label={say('Delete answer', '답변 삭제')}
              onClick={() => {
                if (confirm(say('Delete this card? The conversation stays in History.', '카드를 삭제할까요? 대화는 기록에 남습니다.')))
                  update({ state: 'dismissed' });
              }}
            >
              ×
            </button>
          ) : null}
        </header>
        <div className="answer-popup__content" hidden={collapsed}>
          <ResearchPanel
            threadId={card.threadId}
            answerLanguage={answerLanguage}
            popup
            hub={hub}
            paperKey={paperKey}
            intent={card.intent}
            open
            historyMode={false}
            onClose={() => update({ state: 'collapsed' })}
            onPage={onPage}
            onSettings={onSettings}
            onQuestion={() => {}}
            checkSource={checkSource}
          />
        </div>
      </div>
    </>
  );
}
