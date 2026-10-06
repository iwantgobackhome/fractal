import type { JSX, ReactNode } from 'react';
import { t, useLanguage } from '../i18n';
import { FractalMark } from './FractalMark';
import type { ShellView } from './Masthead';

export function Sidebar({ view, onNavigate, children }: { view: ShellView; onNavigate(view: ShellView): void; children?: ReactNode }): JSX.Element {
  const language = useLanguage();
  return (
    <aside className="workspace-sidebar" aria-label={t('nav.main')}>
      <button className="workspace-brand" type="button" onClick={() => onNavigate('library')} aria-label={t('nav.brandHome')}>
        <FractalMark size={36} />
        <span>
          <strong>News Papers</strong>
          <small>READ DEEPER. DISCOVER FURTHER.</small>
        </span>
      </button>
      <nav className="workspace-nav" aria-label={t('nav.main')}>
        <button type="button" aria-current={view === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')}>
          <span aria-hidden="true">⌂</span>
          {language === 'ko' ? '발견 · 분야 뉴스' : 'Discover · field news'}
        </button>
        <button type="button" aria-current={view === 'library' ? 'page' : undefined} onClick={() => onNavigate('library')}>
          <span aria-hidden="true">▤</span>
          {t('nav.library')}
        </button>
        <button
          type="button"
          onClick={() => {
            onNavigate('settings');
            requestAnimationFrame(() => document.getElementById('settings-interests')?.scrollIntoView());
          }}
        >
          <span aria-hidden="true">✳</span>
          {t('settings.interests')}
        </button>
      </nav>
      <div className="workspace-sidebar__content">{children}</div>
      <button type="button" className="workspace-settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}>
        <span aria-hidden="true">⚙</span>
        {language === 'ko' ? '보기 및 연결' : 'Appearance & connections'}
      </button>
    </aside>
  );
}
