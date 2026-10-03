import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { ContextSourceStatus, OriginalProvenance } from '@fractal/shared';
import { useLanguage } from '../i18n';
import type { HubApi } from '../shell/hub-api';
import { FloatingCard } from './Cards';
import { ResearchPanel, type ResearchIntent } from './ResearchPanel';

export interface AnswerAnchor {
  rect: DOMRect;
  element?: HTMLElement | null;
}

/** The first position follows the passage; dragging makes the position viewport-relative. */
export function AnswerPopup({
  hub,
  paperKey,
  intent,
  anchor,
  onClose,
  onPage,
  onSettings,
  checkSource,
}: {
  hub: HubApi;
  paperKey: string;
  intent: ResearchIntent;
  anchor: AnswerAnchor;
  onClose(): void;
  onPage(page: number): void;
  onSettings(): void;
  checkSource(provenance?: OriginalProvenance): Promise<ContextSourceStatus>;
}): JSX.Element {
  const ko = useLanguage() === 'ko';
  const say = (en: string, kr: string) => (ko ? kr : en);
  const card = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 60 });
  const moved = useRef(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const origin = useRef(anchor.element?.getBoundingClientRect());
  const clamp = (left: number, top: number) => {
    const box = card.current?.getBoundingClientRect();
    return {
      left: Math.max(12, Math.min(left, window.innerWidth - (box?.width ?? 380) - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - (box?.height ?? 48) - 12)),
    };
  };
  useLayoutEffect(() => {
    const place = () => {
      if (moved.current) {
        setPosition((p) => clamp(p.left, p.top));
        return;
      }
      const current = anchor.element?.getBoundingClientRect();
      const dx = current && origin.current ? current.left - origin.current.left : 0;
      const dy = current && origin.current ? current.top - origin.current.top : 0;
      const width = card.current?.getBoundingClientRect().width ?? 380;
      const beside = window.innerWidth - anchor.rect.right - dx > width + 24;
      setPosition(clamp(beside ? anchor.rect.right + dx + 12 : anchor.rect.left + dx, beside ? anchor.rect.top + dy : anchor.rect.bottom + dy + 8));
    };
    place();
    const observer = new ResizeObserver(place);
    if (card.current) observer.observe(card.current);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);
  // Focus the header once. Re-running this on every parent render stole focus from open
  // controls inside the popup, which closed the model list while it was being used.
  useEffect(() => {
    header.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (collapsed) onClose();
      else setCollapsed(true);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [collapsed, onClose]);
  return (
    <FloatingCard
      anchor={anchor.rect}
      onClose={onClose}
      label={say('Answer about selection', '선택 영역 답변')}
      className={`answer-popup${collapsed ? ' answer-popup--collapsed' : ''}`}
      managed={{ ref: card, position }}
    >
      <header
        ref={header}
        tabIndex={0}
        className="answer-popup__header"
        aria-label={say('Move answer with arrow keys or drag', '방향키 또는 드래그로 답변 이동')}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const delta = ({ ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] } as Record<string, number[]>)[event.key];
          if (!delta) return;
          event.preventDefault();
          moved.current = true;
          setPosition((p) => clamp(p.left + delta[0], p.top + delta[1]));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, ...position };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          moved.current = true;
          setPosition(clamp(drag.current.left + event.clientX - drag.current.x, drag.current.top + event.clientY - drag.current.y));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <strong>
          {say('Answer', '답변')} · p.{intent.page}
        </strong>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? say('Expand answer', '답변 펼치기') : say('Collapse answer', '답변 접기')}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '+' : '−'}
        </button>
        <button type="button" aria-label={say('Close answer', '답변 닫기')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="answer-popup__content" hidden={collapsed}>
        <ResearchPanel
          popup
          hub={hub}
          paperKey={paperKey}
          intent={intent}
          open
          historyMode={false}
          onClose={() => setCollapsed(true)}
          onPage={onPage}
          onSettings={onSettings}
          onQuestion={() => {}}
          checkSource={checkSource}
        />
      </div>
    </FloatingCard>
  );
}
