import { useCallback, useState, type JSX } from 'react';
import { t, type MessageKey } from '../i18n';
import { FractalMark } from './FractalMark';
import { InterestPicker } from './InterestPicker';
import type { AiAccount, HubApi, Preferences } from './hub-api';
import { ProviderCard } from './ProviderSetup';
import { AiConnection, LanguageFields, useLoad, useProviders } from './settings-parts';
import { DevicesSection } from './SettingsScreen';

type Step = 'language' | 'ai' | 'fields' | 'tablet';

const STEPS: { id: Step; label: MessageKey }[] = [
  { id: 'language', label: 'welcome.stepLanguage' },
  { id: 'ai', label: 'welcome.stepAi' },
  { id: 'fields', label: 'welcome.stepFields' },
  { id: 'tablet', label: 'welcome.stepTablet' },
];

interface Props {
  hub: HubApi;
  preferences: Preferences;
  onPreferencesChange(change: Partial<Preferences>): void;
  onDone(): void;
}

function AiStep({ hub }: { hub: HubApi }): JSX.Element {
  const { data, recheck, checking } = useProviders(hub);
  const loadAccounts = useCallback(() => hub.accounts(), [hub]);
  const [accounts, , reloadAccounts] = useLoad<AiAccount[]>(loadAccounts);
  const changed = useCallback(() => {
    recheck();
    reloadAccounts();
  }, [recheck, reloadAccounts]);
  if (data === undefined) return <p className="settings__quiet">{t('settings.loading')}</p>;
  if (data === null) return <p className="settings__quiet">{t('settings.unavailable')}</p>;
  const ready = data.providers.some((p) => p.installed && p.loggedIn);
  if (accounts === null) {
    return (
      <>
        <AiConnection providers={data.providers} onRecheck={recheck} checking={checking} />
        <p className="welcome__note">{ready ? t('welcome.aiReady') : t('welcome.aiLater')}</p>
      </>
    );
  }
  return (
    <>
      <div className="setup-cards">
        {data.providers.map((status) => (
          <ProviderCard
            key={status.id}
            hub={hub}
            status={status}
            account={accounts?.find((a) => a.provider === status.id && a.kind === 'system')}
            onChange={changed}
          />
        ))}
      </div>
      <p className="welcome__note">{ready ? t('welcome.aiReady') : t('setup.oneIsEnough')}</p>
    </>
  );
}

/**
 * The first run: the reader's languages, the AI tools already on this PC, the fields to
 * follow, and (optionally) the tablet. Every step can be skipped and revisited in Settings.
 */
export function Welcome({ hub, preferences, onPreferencesChange, onDone }: Props): JSX.Element {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const next = () => (last ? onDone() : setIndex(index + 1));

  return (
    <main className="welcome" aria-labelledby="welcome-title">
      <header className="welcome__top">
        <span className="welcome__brand">
          <FractalMark size={22} />
          <span>Fractal</span>
        </span>
        <button type="button" className="text-link text-link--quiet" onClick={onDone}>
          {t('welcome.skip')}
        </button>
      </header>

      <ol className="welcome__progress" aria-label={t('welcome.progress')}>
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={i === index ? 'step' : undefined} className={i < index ? 'is-done' : undefined}>
            <button type="button" onClick={() => setIndex(i)}>
              {t(s.label)}
            </button>
          </li>
        ))}
      </ol>

      <section className="welcome__body">
        {step.id === 'language' ? (
          <>
            <h1 id="welcome-title" className="welcome__title">
              {t('welcome.titleLanguage')}
            </h1>
            <p className="welcome__deck">{t('welcome.deckLanguage')}</p>
            <LanguageFields preferences={preferences} onChange={onPreferencesChange} />
          </>
        ) : step.id === 'ai' ? (
          <>
            <h1 id="welcome-title" className="welcome__title">
              {t('welcome.titleAi')}
            </h1>
            <p className="welcome__deck">{t('welcome.deckAi')}</p>
            <AiStep hub={hub} />
          </>
        ) : step.id === 'fields' ? (
          <>
            <h1 id="welcome-title" className="welcome__title">
              {t('welcome.titleFields')}
            </h1>
            <p className="welcome__deck">{t('welcome.deckFields')}</p>
            <InterestPicker hub={hub} onSaved={next} heading={false} />
          </>
        ) : (
          <>
            <h1 id="welcome-title" className="welcome__title">
              {t('welcome.titleTablet')}
            </h1>
            <p className="welcome__deck">{t('welcome.deckTablet')}</p>
            <DevicesSection hub={hub} />
          </>
        )}
      </section>

      <footer className="welcome__nav">
        {index > 0 ? (
          <button type="button" className="text-link text-link--quiet" onClick={() => setIndex(index - 1)}>
            {t('welcome.back')}
          </button>
        ) : (
          <span />
        )}
        {step.id === 'fields' ? (
          <button type="button" className="text-link" onClick={next}>
            {t('welcome.later')}
          </button>
        ) : (
          <button type="button" className="button" onClick={next}>
            {last ? t('welcome.done') : t('welcome.next')}
          </button>
        )}
      </footer>
    </main>
  );
}
