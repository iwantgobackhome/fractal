import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLanguage } from '../i18n';
import { clampPanelWidth } from './research-state';
const KEY = 'fractal.research.width';
export function usePanelWidth() {
  const [width, setWidth] = useState(() => {
    try {
      return clampPanelWidth(Number(localStorage.getItem(KEY)) || 380, window.innerWidth);
    } catch {
      return clampPanelWidth(380, window.innerWidth);
    }
  });
  const update = (value: number) => setWidth(clampPanelWidth(value, window.innerWidth));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width));
    } catch {
      /* storage unavailable */
    }
  }, [width]);
  useEffect(() => {
    const resize = () => setWidth((w) => clampPanelWidth(w, window.innerWidth));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return { width, update, style: { '--chat-width': `${width}px` } as CSSProperties };
}
export function PanelResizeHandle({ width, onChange }: { width: number; onChange(width: number): void }) {
  const ko = useLanguage() === 'ko',
    drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="research-resize"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={ko ? '질문 패널 너비 조절' : 'Resize question panel'}
      aria-valuemin={300}
      aria-valuemax={Math.max(300, Math.floor(window.innerWidth * 0.6))}
      aria-valuenow={Math.round(width)}
      onDoubleClick={() => onChange(380)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(width + (e.key === 'ArrowLeft' ? 20 : -20));
        }
        if (e.key === 'Home') {
          e.preventDefault();
          onChange(380);
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        if (drag.current) onChange(drag.current.width + drag.current.x - e.clientX);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}
