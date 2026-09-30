import type { JSX, ReactNode, RefObject } from 'react';
import { t, type MessageKey } from '../i18n';
import { FractalMark } from './FractalMark';
import { locale } from '../i18n';

export type ShellView = 'home' | 'library' | 'settings';

const NAV: { view: ShellView; label: MessageKey }[] = [
  { view: 'home', label: 'nav.home' },
  { view: 'library', label: 'nav.library' },
  { view: 'settings', label: 'nav.settings' },
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
      {view === 'reader' ? (
        <>
          <button type="button" className="masthead__brand" onClick={() => onNavigate('home')} aria-label={t('nav.brandHome')}>
            <FractalMark />
            <span className="masthead__word">Fractal</span>
          </button>
          <nav className="masthead__nav" aria-label={t('nav.main')}>
            {NAV.map((item) => (
              <button key={item.view} type="button" className="masthead__link" onClick={() => onNavigate(item.view)}>
                {t(item.label)}
              </button>
            ))}
          </nav>
        </>
      ) : (
        <span className="masthead__context">
          READ · DISCOVER <span>/</span> {t(view === 'home' ? 'nav.home' : view === 'library' ? 'nav.library' : 'nav.settings')}
        </span>
      )}
      <div className="masthead__input">{input}</div>
      <div className="masthead__end">
        <button ref={paletteButtonRef} type="button" className="masthead__palette" onClick={onOpenPalette} aria-label={t('nav.openPalette')}>
          <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
          <kbd>K</kbd>
        </button>
        {account}
        {view !== 'reader' ? (
          <time className="masthead__date">{new Intl.DateTimeFormat(locale(), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}</time>
        ) : null}
      </div>
    </header>
  );
}
