import { useCallback, useEffect, useState, type JSX } from 'react';
import { THEME_CHOICES, type ThemeChoice } from './theme';
import type {
  AiChoice,
  AiFeature,
  AiSettings,
  HubApi,
  NetworkResult,
  PairedDevice,
  PairingSession,
  ProviderStatus,
  ProvidersResult,
  UsageResult,
} from './hub-api';

interface Props {
  hub: HubApi;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  onManageCodexLogin: () => void;
}

const SECTIONS = [
  { id: 'appearance', label: '외관' },
  { id: 'ai', label: 'AI' },
  { id: 'devices', label: '기기 연결' },
  { id: 'data', label: '데이터' },
] as const;

const PROVIDER_NAME: Record<ProviderStatus['id'], string> = { codex: 'Codex', claude: 'Claude' };
const FEATURES: { id: AiFeature; label: string }[] = [
  { id: 'chat', label: '질문' },
  { id: 'translate', label: '번역' },
  { id: 'explain', label: '수식·그림 설명' },
  { id: 'digest', label: '주간 요약' },
];

/** `null` = the hub has no such route yet; `undefined` = still loading. */
type Loaded<T> = T | null | undefined;

function useLoad<T>(load: () => Promise<T | null>): [Loaded<T>, (value: T | null) => void, () => void] {
  const [value, setValue] = useState<Loaded<T>>(undefined);
  const reload = useCallback(() => {
    load()
      .then(setValue)
      .catch(() => setValue(null));
  }, [load]);
  useEffect(reload, [reload]);
  return [value, setValue, reload];
}

function Unavailable({ what }: { what: string }): JSX.Element {
  return <p className="settings__quiet">이 허브 버전에서는 {what}을 아직 설정할 수 없습니다.</p>;
}

function providerState(p: ProviderStatus): string {
  if (!p.installed) return '설치되지 않음';
  if (!p.loggedIn) return '로그인 필요';
  return p.version !== null ? `연결됨 · ${p.version.replace(/\s*\(.*\)$/, '').replace(/^codex-cli\s+/, '')}` : '연결됨';
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
      {allowInherit ? <option value="">기본값 따름</option> : null}
      {installed.map((p) => (
        <optgroup key={p.id} label={p.loggedIn ? PROVIDER_NAME[p.id] : `${PROVIDER_NAME[p.id]} (로그인 필요)`}>
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

function AiSection({ hub, onManageCodexLogin }: { hub: HubApi; onManageCodexLogin: () => void }): JSX.Element {
  const loadProviders = useCallback(() => hub.providers(), [hub]);
  const loadUsage = useCallback(() => hub.usage(), [hub]);
  const [data, setData] = useLoad<ProvidersResult>(loadProviders);
  const [usage] = useLoad<UsageResult>(loadUsage);
  const [saving, setSaving] = useState(false);

  if (data === undefined) return <p className="settings__quiet">불러오는 중…</p>;
  if (data === null) return <Unavailable what="AI 제공자" />;

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
      <dl className="provider-list">
        {data.providers.map((p) => (
          <div key={p.id} className="provider">
            <dt>{PROVIDER_NAME[p.id]}</dt>
            <dd>
              <span className={p.installed && p.loggedIn ? '' : 'settings__warn'}>{providerState(p)}</span>
              {p.id === 'codex' ? (
                <button type="button" className="text-link" onClick={onManageCodexLogin}>
                  로그인 관리
                </button>
              ) : !p.loggedIn && p.installed ? (
                <span className="settings__quiet">
                  터미널에서 <code>claude</code>를 실행해 로그인하세요.
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <div className="field-row">
        <span className="field-row__label">기본 모델</span>
        <ModelSelect
          label="기본 모델"
          providers={data.providers}
          value={data.settings.default}
          allowInherit={false}
          onChange={(choice) => choice !== undefined && void save({ ...data.settings, default: choice })}
        />
        {efforts.length > 0 ? (
          <select
            aria-label="추론 강도"
            value={data.settings.default.effort ?? ''}
            onChange={(event) =>
              void save({ ...data.settings, default: { ...data.settings.default, effort: (event.target.value || undefined) as AiChoice['effort'] } })
            }
          >
            <option value="">추론 강도 기본</option>
            {efforts.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        ) : null}
        {saving ? <span className="settings__quiet">저장 중</span> : null}
      </div>

      <table className="plain-table">
        <caption>기능별 모델</caption>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f.id}>
              <th scope="row">{f.label}</th>
              <td>
                <ModelSelect
                  label={`${f.label} 모델`}
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

      <h3 className="settings__sub">사용량</h3>
      {usage === undefined ? null : usage === null ? <Unavailable what="사용량" /> : <UsageTable usage={usage} />}
    </>
  );
}

function UsageTable({ usage }: { usage: UsageResult }): JSX.Element {
  const totals = new Map<string, { requests: number; tokens: number }>();
  for (const row of usage.rows) {
    const key = `${row.provider} · ${row.model}`;
    const t = totals.get(key) ?? { requests: 0, tokens: 0 };
    t.requests += row.requests;
    t.tokens += row.inputTokens + row.outputTokens;
    totals.set(key, t);
  }
  const number = new Intl.NumberFormat('ko-KR');
  return (
    <>
      {usage.limits !== undefined && usage.limits.length > 0 ? (
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
        <p className="settings__quiet">아직 기록된 사용량이 없습니다.</p>
      ) : (
        <table className="plain-table plain-table--numbers">
          <thead>
            <tr>
              <th scope="col">모델</th>
              <th scope="col">요청</th>
              <th scope="col">토큰</th>
            </tr>
          </thead>
          <tbody>
            {[...totals].map(([key, t]) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>{number.format(t.requests)}</td>
                <td>{number.format(t.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function DevicesSection({ hub }: { hub: HubApi }): JSX.Element {
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

  if (network === undefined) return <p className="settings__quiet">불러오는 중…</p>;
  if (network === null) return <Unavailable what="기기 연결" />;

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
      setError(cause instanceof Error ? cause.message : '설정을 바꾸지 못했습니다.');
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
                <span>{kind === 'lan' ? '같은 Wi-Fi에서 연결' : 'Tailscale로 어디서나 연결'}</span>
                <span className="settings__quiet">
                  {address === '' ? (kind === 'lan' ? '네트워크 주소를 찾지 못했습니다' : 'Tailscale이 실행 중이 아닙니다') : address}
                </span>
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
            <img className="pairing__qr" src={hub.pairingQrUrl(pairing.session)} alt="기기 연결용 QR 코드" width={168} height={168} />
            <div>
              <p className="pairing__lead">태블릿의 Fractal 앱에서 QR을 찍으세요.</p>
              <p className="settings__quiet">
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} 후 만료 · 코드{' '}
                <code className="pairing__code">{pairing.code.match(/.{1,4}/g)?.join(' ')}</code>
              </p>
              <button type="button" className="text-link" onClick={() => setPairing(null)}>
                닫기
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
                .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '연결을 시작하지 못했습니다.'));
            }}
          >
            새 기기 연결
          </button>
        )}
      </div>

      <h3 className="settings__sub">연결된 기기</h3>
      {devices === undefined ? null : devices === null || devices.devices.length === 0 ? (
        <p className="settings__quiet">연결된 기기가 없습니다.</p>
      ) : (
        <ul className="device-list">
          {devices.devices.map((d) => (
            <li key={d.id}>
              <span className="device-list__name">{d.name}</span>
              <span className="settings__quiet">
                {d.platform} · {d.lastSeen !== null ? `최근 접속 ${new Date(d.lastSeen).toLocaleString('ko-KR')}` : '접속 기록 없음'}
              </span>
              <button type="button" className="text-link text-link--danger" onClick={() => void hub.revokeDevice(d.id).then(reloadDevices)}>
                연결 해제
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SettingsScreen({ hub, theme, onThemeChange, onManageCodexLogin }: Props): JSX.Element {
  return (
    <main className="screen settings" aria-labelledby="settings-title">
      <nav className="settings__index" aria-label="설정 항목">
        <h1 id="settings-title" className="screen__title">
          설정
        </h1>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#settings-${s.id}`}>{s.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings__body">
        <section id="settings-appearance" className="settings__section" aria-labelledby="settings-appearance-h">
          <h2 id="settings-appearance-h">외관</h2>
          <div className="theme-picker" role="radiogroup" aria-label="테마">
            {THEME_CHOICES.map((t) => (
              <label key={t.value} className="theme-swatch" data-swatch={t.value}>
                <input type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => onThemeChange(t.value)} />
                <span className="theme-swatch__page" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section id="settings-ai" className="settings__section" aria-labelledby="settings-ai-h">
          <h2 id="settings-ai-h">AI</h2>
          <AiSection hub={hub} onManageCodexLogin={onManageCodexLogin} />
        </section>

        <section id="settings-devices" className="settings__section" aria-labelledby="settings-devices-h">
          <h2 id="settings-devices-h">기기 연결</h2>
          <DevicesSection hub={hub} />
        </section>

        <section id="settings-data" className="settings__section" aria-labelledby="settings-data-h">
          <h2 id="settings-data-h">데이터</h2>
          <div className="field-row">
            <span className="field-row__label">보관함 내보내기</span>
            <a className="text-link" href={hub.exportUrl('bibtex')} download="fractal-library.bib">
              BibTeX
            </a>
            <a className="text-link" href={hub.exportUrl('csl-json')} download="fractal-library.json">
              CSL-JSON
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
