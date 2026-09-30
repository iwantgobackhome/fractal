import { useCallback, useEffect, useState, type JSX } from 'react';
import { t } from '../i18n';
import type { HubApi, Preferences, ProviderStatus, ProvidersResult } from './hub-api';
import { TRANSLATION_LANGUAGES, UI_LANGUAGES } from './preferences';

export const PROVIDER_NAME: Record<ProviderStatus['id'], string> = { codex: 'Codex', claude: 'Claude' };

/** Default terminal commands, used when the hub does not say. */
const LOGIN_COMMAND: Record<ProviderStatus['id'], string> = { codex: 'codex login', claude: 'claude' };
const INSTALL_COMMAND: Record<ProviderStatus['id'], string> = {
  codex: 'npm install -g @openai/codex',
  claude: 'npm install -g @anthropic-ai/claude-code',
};

/** `null` = the hub has no such route; `undefined` = still loading. */
export type Loaded<T> = T | null | undefined;

export function useLoad<T>(load: () => Promise<T | null>): [Loaded<T>, (value: T | null) => void, () => void] {
  const [value, setValue] = useState<Loaded<T>>(undefined);
  const reload = useCallback(() => {
    load()
      .then(setValue)
      .catch(() => setValue(null));
  }, [load]);
  useEffect(reload, [reload]);
  return [value, setValue, reload];
}

function version(p: ProviderStatus): string {
  return p.version === null ? '' : p.version.replace(/\s*\(.*\)$/, '').replace(/^codex-cli\s+/, '');
}

/**
 * Codex and Claude as the hub sees them: Fractal uses the command-line tools the reader
 * already signed in to, so the fix for "not connected" is always a terminal command.
 */
export function AiConnection({ providers, onRecheck, checking }: { providers: ProviderStatus[]; onRecheck(): void; checking: boolean }): JSX.Element {
  return (
    <div className="ai-connection">
      <dl className="provider-list">
        {providers.map((p) => {
          const ready = p.installed && p.loggedIn;
          return (
            <div key={p.id} className="provider">
              <dt>{PROVIDER_NAME[p.id]}</dt>
              <dd>
                {ready ? (
                  <span>{t('ai.connected', { version: version(p) }).replace(/\s·\s$/, '')}</span>
                ) : (
                  <span className="provider__todo">
                    <span className="settings__warn">{p.installed ? t('ai.notSignedIn') : t('ai.notInstalled')}</span>
                    <span className="settings__quiet">{p.installed ? t('ai.signInHint') : t('ai.installHint')}</span>
                    <code className="command">{p.installed ? (p.loginCommand ?? LOGIN_COMMAND[p.id]) : INSTALL_COMMAND[p.id]}</code>
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <button type="button" className="text-link" onClick={onRecheck} disabled={checking}>
        {checking ? t('ai.checking') : t('ai.recheck')}
      </button>
    </div>
  );
}

/** The providers list with its own reload, for screens that only show connection state. */
export function useProviders(hub: HubApi): { data: Loaded<ProvidersResult>; setData(value: ProvidersResult | null): void; recheck(): void; checking: boolean } {
  const load = useCallback(() => hub.providers(), [hub]);
  const [data, setData, reload] = useLoad<ProvidersResult>(load);
  const [checking, setChecking] = useState(false);
  const recheck = useCallback(() => {
    setChecking(true);
    hub
      .providers()
      .then((next) => setData(next))
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [hub, setData]);
  void reload;
  return { data, setData, recheck, checking };
}

/** Interface, translation and answer languages. */
export function LanguageFields({ preferences, onChange }: { preferences: Preferences; onChange(change: Partial<Preferences>): void }): JSX.Element {
  return (
    <div className="language-fields">
      <div className="field-row">
        <span className="field-row__label">{t('lang.ui')}</span>
        <div className="segmented" role="group" aria-label={t('lang.ui')}>
          {UI_LANGUAGES.map((l) => (
            <button key={l.code} type="button" aria-pressed={preferences.uiLanguage === l.code} onClick={() => onChange({ uiLanguage: l.code })}>
              {l.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field-row">
        <label className="field-row__label" htmlFor="pref-translation">
          {t('lang.translation')}
        </label>
        <select id="pref-translation" value={preferences.translationLanguage} onChange={(event) => onChange({ translationLanguage: event.target.value })}>
          {TRANSLATION_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-row__label" htmlFor="pref-answer">
          {t('lang.answer')}
        </label>
        <select id="pref-answer" value={preferences.answerLanguage} onChange={(event) => onChange({ answerLanguage: event.target.value })}>
          <option value="auto">{t('lang.answerAuto')}</option>
          {TRANSLATION_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
