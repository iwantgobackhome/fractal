import { useState } from 'react';
import hubPackage from '../../../hub/package.json';
import { t } from '../i18n';
import type { DesktopUpdates } from '../updates/UpdateToast';

export type CheckResult = { status: 'idle' | 'checking' | 'current' } | { status: 'available'; version: string } | { status: 'error'; error: string };

export function AboutContent({ version, updates, result, onCheck }: { version: string; updates?: DesktopUpdates; result: CheckResult; onCheck(): void }) {
  return (
    <section id="settings-about" className="settings__section" aria-labelledby="settings-about-h">
      <h2 id="settings-about-h">{t('settings.about')}</h2>
      <p>{t('settings.version', { version })}</p>
      {updates ? (
        <button type="button" className="button" disabled={result.status === 'checking'} onClick={onCheck}>
          {t('settings.checkUpdates')}
        </button>
      ) : null}
      <p role="status" aria-live="polite">
        {result.status === 'checking'
          ? t('settings.checkingUpdates')
          : result.status === 'current'
            ? t('settings.upToDate')
            : result.status === 'available'
              ? t('updates.available', { version: result.version })
              : result.status === 'error'
                ? result.error
                : ''}
      </p>
    </section>
  );
}

export function AboutSection() {
  const desktop = typeof window === 'undefined' ? undefined : window.fractalDesktop;
  const [result, setResult] = useState<CheckResult>({ status: 'idle' });
  async function check() {
    if (!desktop?.updates) return;
    setResult({ status: 'checking' });
    try {
      setResult((await desktop.updates.check()) ?? { status: 'current' });
    } catch (cause) {
      setResult({ status: 'error', error: cause instanceof Error ? cause.message : t('updates.error') });
    }
  }
  return <AboutContent version={desktop?.version ?? hubPackage.version} updates={desktop?.updates} result={result} onCheck={() => void check()} />;
}
