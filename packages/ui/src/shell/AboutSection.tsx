import { useEffect, useRef, useState, type ReactNode } from 'react';
import hubPackage from '../../../hub/package.json';
import { t } from '../i18n';
import type { DesktopUpdates } from '../updates/UpdateToast';

export type CheckResult = { status: 'idle' | 'checking' | 'current' } | { status: 'available'; version: string } | { status: 'error'; error: string };

export function AboutContent({
  version,
  updates,
  result,
  onCheck,
  children,
}: {
  version: string;
  updates?: DesktopUpdates;
  result: CheckResult;
  onCheck(): void;
  children?: ReactNode;
}) {
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
      {children}
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
  const [licenses, setLicenses] = useState<Array<{ name: string; text: string }> | null>(null);
  const licenseDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (licenses && !licenseDialog.current?.open) licenseDialog.current?.showModal();
  }, [licenses]);
  const [selectedLicense, setSelectedLicense] = useState(0);
  const [licenseError, setLicenseError] = useState('');
  const [loadingLicenses, setLoadingLicenses] = useState(false);
  async function openLicenses() {
    setLoadingLicenses(true);
    setLicenseError('');
    try {
      setSelectedLicense(0);
      setLicenses(await desktop!.readLicenses!());
    } catch (cause) {
      setLicenseError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingLicenses(false);
    }
  }
  return (
    <>
      <AboutContent version={desktop?.version ?? hubPackage.version} updates={desktop?.updates} result={result} onCheck={() => void check()}>
        {desktop?.readLicenses && (
          <button className="button" disabled={loadingLicenses} onClick={() => void openLicenses()}>
            {t('settings.openSourceLicenses')}
          </button>
        )}
        {licenseError && <p role="alert">{licenseError}</p>}
      </AboutContent>
      {licenses && (
        <dialog
          ref={licenseDialog}
          aria-modal="true"
          aria-label={t('settings.openSourceLicenses')}
          style={{ position: 'fixed', inset: '5vh 5vw', width: '90vw', maxWidth: 900, maxHeight: '90vh', zIndex: 1000 }}
          onCancel={() => setLicenses(null)}
        >
          <h2>{t('settings.openSourceLicenses')}</h2>
          <button className="button" autoFocus onClick={() => setLicenses(null)}>
            {t('article.close')}
          </button>
          <nav aria-label={t('settings.openSourceLicenses')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>
            {licenses.map(({ name }, index) => (
              <button className="button" key={name} aria-pressed={selectedLicense === index} onClick={() => setSelectedLicense(index)}>
                {name}
              </button>
            ))}
          </nav>
          <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
            <h3>{licenses[selectedLicense]?.name}</h3>
            {licenses[selectedLicense]?.name.endsWith('.html') ? (
              <iframe
                title={licenses[selectedLicense].name}
                sandbox=""
                srcDoc={licenses[selectedLicense].text}
                style={{ width: '100%', height: '55vh', border: 0 }}
              />
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{licenses[selectedLicense]?.text}</pre>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
