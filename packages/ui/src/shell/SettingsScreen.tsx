import { useCallback, useEffect, useState, type JSX } from 'react';
import { locale, t, type MessageKey } from '../i18n';
import type {
  AiAccount,
  AiChoice,
  AiFeature,
  AiSettings,
  HubApi,
  NetworkResult,
  PairedDevice,
  PairingSession,
  Preferences,
  ProviderStatus,
  UsageResult,
} from './hub-api';
import { AccountsPanel } from './AccountsPanel';
import { InterestPicker } from './InterestPicker';
import { AiConnection, LanguageFields, PROVIDER_NAME, useLoad, useProviders } from './settings-parts';
import { THEME_CHOICES, type ThemeChoice } from './theme';

interface Props {
  hub: HubApi;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  preferences: Preferences | null;
  onPreferencesChange(change: Partial<Preferences>): void;
  onShowWelcome(): void;
}

const SECTIONS: { id: string; label: MessageKey }[] = [
  { id: 'language', label: 'settings.language' },
  { id: 'appearance', label: 'settings.appearance' },
  { id: 'interests', label: 'settings.interests' },
  { id: 'ai', label: 'settings.ai' },
  { id: 'devices', label: 'settings.devices' },
  { id: 'data', label: 'settings.data' },
];

const FEATURES: { id: AiFeature; label: MessageKey }[] = [
  { id: 'chat', label: 'ai.featureChat' },
  { id: 'translate', label: 'ai.featureTranslate' },
  { id: 'explain', label: 'ai.featureExplain' },
  { id: 'digest', label: 'ai.featureDigest' },
];

function Unavailable(): JSX.Element {
  return <p className="settings__quiet">{t('settings.unavailable')}</p>;
}

function choiceKey(c: AiChoice): string {
  return `${c.provider}:${c.model}`;
}

function ModelSelect({
  providers,
  value,
  onChange,
  allowInherit,
  label,
}: {
  providers: ProviderStatus[];
  value: AiChoice | undefined;
  onChange: (choice: AiChoice | undefined) => void;
  allowInherit: boolean;
  label: string;
}): JSX.Element {
  // Signed-out providers stay listed (marked), so a saved choice never silently shows as another model.
  const installed = providers.filter((p) => p.installed);
  return (
    <select
      aria-label={label}
      value={value === undefined ? '' : choiceKey(value)}
      onChange={(event) => {
        if (event.target.value === '') return onChange(undefined);
        const [provider, ...model] = event.target.value.split(':');
        onChange({ provider: provider as AiChoice['provider'], model: model.join(':'), effort: value?.effort });
      }}
    >
      {allowInherit ? <option value="">{t('ai.inherit')}</option> : null}
      {installed.map((p) => (
        <optgroup key={p.id} label={p.loggedIn ? PROVIDER_NAME[p.id] : t('ai.providerSignedOut', { name: PROVIDER_NAME[p.id] })}>
          {p.models.map((m) => (
            <option key={m.id} value={`${p.id}:${m.id}`}>
              {m.label ?? m.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function AiSection({ hub }: { hub: HubApi }): JSX.Element {
  const { data, setData, recheck, checking } = useProviders(hub);
  const loadUsage = useCallback(() => hub.usage(), [hub]);
  const [usage] = useLoad<UsageResult>(loadUsage);
  const loadAccounts = useCallback(() => hub.accounts(), [hub]);
  const [accounts, , reloadAccounts] = useLoad<AiAccount[]>(loadAccounts);
  const [saving, setSaving] = useState(false);
  const accountsChanged = useCallback(() => {
    reloadAccounts();
    recheck();
  }, [reloadAccounts, recheck]);

  if (data === undefined) return <p className="settings__quiet">{t('settings.loading')}</p>;
  if (data === null) return <Unavailable />;

  const save = async (settings: AiSettings) => {
    setData({ ...data, settings });
    setSaving(true);
    try {
      const next = await hub.saveAiSettings(settings);
      if (next !== null) setData(next);
    } finally {
      setSaving(false);
    }
  };

  const efforts = data.providers.find((p) => p.id === data.settings.default.provider)?.models.find((m) => m.id === data.settings.default.model)?.efforts ?? [];

  return (
    <>
      {accounts === undefined ? null : accounts === null ? (
        <AiConnection providers={data.providers} onRecheck={recheck} checking={checking} />
      ) : (
        <AccountsPanel hub={hub} accounts={accounts} providers={data.providers} onChange={accountsChanged} />
      )}

      <div className="field-row">
        <span className="field-row__label">{t('ai.defaultModel')}</span>
        <ModelSelect
          label={t('ai.defaultModel')}
          providers={data.providers}
          value={data.settings.default}
          allowInherit={false}
          onChange={(choice) => choice !== undefined && void save({ ...data.settings, default: choice })}
        />
        {efforts.length > 0 ? (
          <select
            aria-label={t('ai.effort')}
            value={data.settings.default.effort ?? ''}
            onChange={(event) =>
              void save({ ...data.settings, default: { ...data.settings.default, effort: (event.target.value || undefined) as AiChoice['effort'] } })
            }
          >
            <option value="">{t('ai.effortDefault')}</option>
            {efforts.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        ) : null}
        {saving ? <span className="settings__quiet">{t('settings.saving')}</span> : null}
      </div>

      <table className="plain-table">
        <caption>{t('ai.perFeature')}</caption>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f.id}>
              <th scope="row">{t(f.label)}</th>
              <td>
                <ModelSelect
                  label={t('ai.featureModel', { feature: t(f.label) })}
                  providers={data.providers}
                  value={data.settings.overrides[f.id]}
                  allowInherit
                  onChange={(choice) => {
                    const overrides = { ...data.settings.overrides };
                    if (choice === undefined) {
                      delete overrides[f.id];
                    } else {
                      overrides[f.id] = choice;
                    }
                    void save({ ...data.settings, overrides });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="settings__sub">{t('ai.usage')}</h3>
      {usage === undefined ? null : usage === null ? <Unavailable /> : <UsageTable usage={usage} showLimits={accounts === null} />}
    </>
  );
}

/** Requests and tokens per model; quota windows appear here only for hubs without accounts. */
function UsageTable({ usage, showLimits }: { usage: UsageResult; showLimits: boolean }): JSX.Element {
  const totals = new Map<string, { requests: number; tokens: number }>();
  for (const row of usage.rows) {
    const key = `${row.provider} · ${row.model}`;
    const total = totals.get(key) ?? { requests: 0, tokens: 0 };
    total.requests += row.requests;
    total.tokens += row.inputTokens + row.outputTokens;
    totals.set(key, total);
  }
  const number = new Intl.NumberFormat(locale());
  return (
    <>
      {showLimits && usage.limits.length > 0 ? (
        <ul className="limit-list">
          {usage.limits.map((l) => (
            <li key={`${l.provider}-${l.label}`}>
              <span>
                {PROVIDER_NAME[l.provider as ProviderStatus['id']] ?? l.provider} {l.label}
              </span>
              <span className="meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, l.usedPercent ?? 0)}%` }} />
              </span>
              <span className="settings__num">{l.usedPercent === null ? '—' : `${Math.round(l.usedPercent)}%`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {totals.size === 0 ? (
        <p className="settings__quiet">{t('ai.noUsage')}</p>
      ) : (
        <table className="plain-table plain-table--numbers">
          <thead>
            <tr>
              <th scope="col">{t('ai.model')}</th>
              <th scope="col">{t('ai.requests')}</th>
              <th scope="col">{t('ai.tokens')}</th>
            </tr>
          </thead>
          <tbody>
            {[...totals].map(([key, total]) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>{number.format(total.requests)}</td>
                <td>{number.format(total.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function DevicesSection({ hub }: { hub: HubApi }): JSX.Element {
  const loadNetwork = useCallback(() => hub.network(), [hub]);
  const loadDevices = useCallback(() => hub.devices(), [hub]);
  const [network, setNetwork] = useLoad<NetworkResult>(loadNetwork);
  const [devices, , reloadDevices] = useLoad<{ devices: PairedDevice[] }>(loadDevices);
  const [pairing, setPairing] = useState<PairingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (pairing === null) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      reloadDevices();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [pairing, reloadDevices]);

  if (network === undefined) return <p className="settings__quiet">{t('settings.loading')}</p>;
  if (network === null) return <Unavailable />;

  const enabled = (kind: 'lan' | 'tailscale') => network.settings[kind];
  const toggle = async (kind: 'lan' | 'tailscale') => {
    setError(null);
    try {
      const next = await hub.saveNetwork({
        lan: kind === 'lan' ? !enabled('lan') : enabled('lan'),
        tailscale: kind === 'tailscale' ? !enabled('tailscale') : enabled('tailscale'),
      });
      if (next !== null) setNetwork(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('devices.changeFailed'));
    }
  };
  const addressOf = (kind: 'lan' | 'tailscale') =>
    network.addresses
      .filter((a) => a.kind === kind)
      .map((a) => a.url.replace(/^https?:\/\//, ''))
      .join(', ');

  const secondsLeft = pairing === null ? 0 : Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - now) / 1000));

  return (
    <>
      <div className="toggle-list">
        {(['lan', 'tailscale'] as const).map((kind) => {
          const address = addressOf(kind);
          return (
            <label key={kind} className="toggle">
              <input type="checkbox" checked={enabled(kind)} disabled={address === ''} onChange={() => void toggle(kind)} />
              <span className="toggle__text">
                <span>{kind === 'lan' ? t('devices.lan') : t('devices.tailscale')}</span>
                <span className="settings__quiet">{address === '' ? (kind === 'lan' ? t('devices.noLan') : t('devices.noTailscale')) : address}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error !== null ? (
        <p className="settings__warn" role="alert">
          {error}
        </p>
      ) : null}

      <div className="pairing">
        {pairing !== null && secondsLeft > 0 ? (
          <div className="pairing__card">
            <img className="pairing__qr" src={hub.pairingQrUrl(pairing.session)} alt={t('devices.qrAlt')} width={168} height={168} />
            <div>
              <p className="pairing__lead">{t('devices.scan')}</p>
              <p className="settings__quiet">
                {t('devices.expires', { time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` })}{' '}
                <code className="pairing__code">{pairing.code.match(/.{1,4}/g)?.join(' ')}</code>
              </p>
              <button type="button" className="text-link" onClick={() => setPairing(null)}>
                {t('errors.closeLabel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!enabled('lan') && !enabled('tailscale')}
            onClick={() => {
              setError(null);
              hub
                .startPairing()
                .then((session) => setPairing(session))
                .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('devices.startFailed')));
            }}
          >
            {t('devices.pair')}
          </button>
        )}
      </div>

      <h3 className="settings__sub">{t('devices.paired')}</h3>
      {devices === undefined ? null : devices === null || devices.devices.length === 0 ? (
        <p className="settings__quiet">{t('devices.none')}</p>
      ) : (
        <ul className="device-list">
          {devices.devices.map((d) => (
            <li key={d.id}>
              <span className="device-list__name">{d.name}</span>
              <span className="settings__quiet">
                {d.platform} · {d.lastSeen !== null ? t('devices.lastSeen', { time: new Date(d.lastSeen).toLocaleString(locale()) }) : t('devices.neverSeen')}
              </span>
              <button type="button" className="text-link text-link--danger" onClick={() => void hub.revokeDevice(d.id).then(reloadDevices)}>
                {t('devices.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SettingsScreen({ hub, theme, onThemeChange, preferences, onPreferencesChange, onShowWelcome }: Props): JSX.Element {
  return (
    <main className="screen settings" aria-labelledby="settings-title">
      <nav className="settings__index" aria-label={t('settings.index')}>
        <h1 id="settings-title" className="screen__title">
          {t('nav.settings')}
        </h1>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#settings-${s.id}`}>{t(s.label)}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings__body">
        <section id="settings-language" className="settings__section" aria-labelledby="settings-language-h">
          <h2 id="settings-language-h">{t('settings.language')}</h2>
          {preferences === null ? (
            <p className="settings__quiet">{t('settings.loading')}</p>
          ) : (
            <LanguageFields preferences={preferences} onChange={onPreferencesChange} />
          )}
        </section>

        <section id="settings-appearance" className="settings__section" aria-labelledby="settings-appearance-h">
          <h2 id="settings-appearance-h">{t('settings.appearance')}</h2>
          <div className="theme-picker" role="radiogroup" aria-label={t('settings.theme')}>
            {THEME_CHOICES.map((choice) => (
              <label key={choice.value} className="theme-swatch" data-swatch={choice.value}>
                <input type="radio" name="theme" value={choice.value} checked={theme === choice.value} onChange={() => onThemeChange(choice.value)} />
                <span className="theme-swatch__page" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{t(choice.label)}</span>
              </label>
            ))}
          </div>
        </section>

        <section id="settings-interests" className="settings__section" aria-labelledby="settings-interests-h">
          <h2 id="settings-interests-h">{t('settings.interests')}</h2>
          <p className="settings__quiet">{t('interests.settingsDeck')}</p>
          <InterestPicker hub={hub} onSaved={() => undefined} heading={false} saveLabel={t('interests.save')} />
        </section>

        <section id="settings-ai" className="settings__section" aria-labelledby="settings-ai-h">
          <h2 id="settings-ai-h">{t('settings.ai')}</h2>
          <AiSection hub={hub} />
        </section>

        <section id="settings-devices" className="settings__section" aria-labelledby="settings-devices-h">
          <h2 id="settings-devices-h">{t('settings.devices')}</h2>
          <DevicesSection hub={hub} />
        </section>

        <section id="settings-data" className="settings__section" aria-labelledby="settings-data-h">
          <h2 id="settings-data-h">{t('settings.data')}</h2>
          <div className="field-row">
            <span className="field-row__label">{t('settings.exportLibrary')}</span>
            <a className="text-link" href={hub.exportUrl('bibtex')} download="fractal-library.bib">
              BibTeX
            </a>
            <a className="text-link" href={hub.exportUrl('csl-json')} download="fractal-library.json">
              CSL-JSON
            </a>
          </div>
          <div className="field-row">
            <span className="field-row__label">{t('settings.welcome')}</span>
            <button type="button" className="text-link" onClick={onShowWelcome}>
              {t('settings.showWelcome')}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
