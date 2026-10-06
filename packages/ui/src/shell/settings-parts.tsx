import { Selector } from '../components/Selector';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { t, useLanguage } from '../i18n';
import { languageSchema } from '@fractal/shared';
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
 * Codex and Claude as the hub sees them: News Papers uses the command-line tools the reader
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
                    <code className="command">{p.installed ? (p.loginCommand ?? LOGIN_COMMAND[p.id]) : (p.installCommand ?? INSTALL_COMMAND[p.id])}</code>
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
  const ko = useLanguage() === 'ko';
  const [custom, setCustom] = useState('');
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="language-fields">
      <div className="field-row">
        <span className="field-row__label">{t('lang.ui')}</span>
        <Selector
          label={t('lang.ui')}
          value={preferences.uiLanguage}
          options={UI_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
          onChange={(value) => onChange({ uiLanguage: value as Preferences['uiLanguage'] })}
        />
      </div>
      <div className="field-row">
        <label className="field-row__label" htmlFor="pref-translation">
          {t('lang.translation')}
        </label>
        <Selector
          id="pref-translation"
          label={t('lang.translation')}
          value={preferences.translationLanguage}
          options={TRANSLATION_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
          onChange={(value) => onChange({ translationLanguage: value })}
        />
      </div>
      <div className="field-row">
        <label className="field-row__label" htmlFor="pref-answer">
          {t('lang.answer')}
        </label>
        <Selector
          id="pref-answer"
          label={t('lang.answer')}
          value={preferences.answerLanguage}
          options={[
            { value: 'auto', label: t('lang.answerAuto') },
            ...TRANSLATION_LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
            ...(!['', 'auto', ...TRANSLATION_LANGUAGES.map((l) => l.code)].includes(preferences.answerLanguage)
              ? [{ value: preferences.answerLanguage, label: preferences.answerLanguage }]
              : []),
          ]}
          onChange={(value) => onChange({ answerLanguage: value })}
        />
      </div>
      <details className="settings-custom-language">
        <summary>{ko ? '사용자 지정 답변 언어' : 'Custom answer language'}</summary>
        <label>
          {ko ? 'BCP47 언어 코드' : 'BCP47 language tag'}
          <input aria-label={ko ? 'BCP47 언어 코드' : 'BCP47 language tag'} placeholder="zh-Hant" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => {
            const parsed = languageSchema.safeParse(custom.trim());
            setInvalid(!parsed.success);
            if (parsed.success) onChange({ answerLanguage: parsed.data });
          }}
        >
          {ko ? '언어 적용' : 'Use language'}
        </button>
        {invalid ? <p role="alert">{ko ? '유효한 BCP47 언어 코드를 입력하세요.' : 'Enter a valid BCP47 language tag.'}</p> : null}
      </details>
    </div>
  );
}
