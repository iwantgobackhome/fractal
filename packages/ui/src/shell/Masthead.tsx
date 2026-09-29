import type { JSX, ReactNode, RefObject } from 'react';
import { FractalMark } from './FractalMark';

export type ShellView = 'home' | 'library' | 'settings';

const NAV: { view: ShellView; label: string }[] = [
  { view: 'home', label: '홈' },
  { view: 'library', label: '보관함' },
  { view: 'settings', label: '설정' },
];

interface Props {
  view: ShellView | 'reader';
  onNavigate: (view: ShellView) => void;
  input: ReactNode;
  account: ReactNode;
  onOpenPalette: () => void;
  paletteButtonRef?: RefObject<HTMLButtonElement | null>;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function Masthead({ view, onNavigate, input, account, onOpenPalette, paletteButtonRef }: Props): JSX.Element {
  return (
    <header className="masthead">
      <button type="button" className="masthead__brand" onClick={() => onNavigate('home')} aria-label="Fractal 홈">
        <FractalMark />
        <span className="masthead__word">Fractal</span>
      </button>
      <nav className="masthead__nav" aria-label="주요 화면">
        {NAV.map((item) => (
          <button
            key={item.view}
            type="button"
            className="masthead__link"
            aria-current={view === item.view ? 'page' : undefined}
            onClick={() => onNavigate(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="masthead__input">{input}</div>
      <div className="masthead__end">
        <button ref={paletteButtonRef} type="button" className="masthead__palette" onClick={onOpenPalette} aria-label="명령 팔레트 열기">
          <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
          <kbd>K</kbd>
        </button>
        {account}
      </div>
    </header>
  );
}
