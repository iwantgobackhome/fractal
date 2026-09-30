import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { Highlight, Region } from '@fractal/shared';
import { t, type MessageKey } from '../i18n';

/** A passage the reader swept on a PDF page, waiting for them to choose what to do with it. */
export interface PendingSelection {
  page: number;
  regions: Region[];
  text: string;
  /** Viewport point just above the end of the selection. */
  anchor: { x: number; y: number };
}

const COLORS: { value: Highlight['color']; label: MessageKey }[] = [
  { value: 'yellow', label: 'reader.yellow' },
  { value: 'green', label: 'reader.green' },
  { value: 'blue', label: 'reader.blue' },
  { value: 'pink', label: 'reader.pink' },
];

interface Props {
  selection: PendingSelection;
  onHighlight(color: Highlight['color']): void;
  onMemo(): void;
  onAsk(): void;
  onClose(): void;
}

const GAP = 10;

/**
 * The menu that appears where the reader selected text: mark it, write beside it,
 * or ask about it. Nothing is saved until one of these is chosen.
 */
export function SelectionMenu({ selection, onHighlight, onMemo, onAsk, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // Keep the menu on screen: above the selection when there is room, otherwise below it.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (menu === null) return;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, selection.anchor.x - width / 2), window.innerWidth - width - 8);
    const above = selection.anchor.y - height - GAP;
    setPosition({ left, top: above > 60 ? above : selection.anchor.y + 28 });
  }, [selection]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="selection-menu"
      role="toolbar"
      aria-label={t('reader.selection')}
      style={position === null ? { visibility: 'hidden', left: 0, top: 0 } : { left: position.left, top: position.top }}
    >
      <div className="selection-menu__colors" role="group" aria-label={t('reader.highlight')}>
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`selection-menu__swatch hl-${c.value}`}
            aria-label={t('reader.highlightColor', { color: t(c.label) })}
            onClick={() => onHighlight(c.value)}
          />
        ))}
      </div>
      <span className="selection-menu__rule" aria-hidden="true" />
      <button type="button" onClick={onMemo}>
        {t('reader.memo')}
      </button>
      <button type="button" onClick={onAsk}>
        {t('reader.ask')}
      </button>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(selection.text).then(() => {
            setCopied(true);
            window.setTimeout(onClose, 600);
          });
        }}
      >
        {copied ? t('reader.copied') : t('reader.copy')}
      </button>
    </div>
  );
}
