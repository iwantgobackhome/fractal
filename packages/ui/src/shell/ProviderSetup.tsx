import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { t, type MessageKey } from '../i18n';
import type { AccountLogin, AiAccount, HubApi, InstallJob, ProviderStatus } from './hub-api';
import { PROVIDER_NAME } from './settings-parts';

const POLL_MS = 1_500;

/** Terminal commands for readers who prefer to do it themselves. */
export const INSTALL_COMMAND: Record<ProviderStatus['id'], string> = {
  codex: 'npm install -g @openai/codex',
  claude: 'irm https://claude.ai/install.ps1 | iex',
};
export const LOGIN_COMMAND: Record<ProviderStatus['id'], string> = { codex: 'codex login', claude: 'claude auth login' };

const WHAT_IT_USES: Record<ProviderStatus['id'], MessageKey> = { codex: 'setup.codexUses', claude: 'setup.claudeUses' };

/** Polls a hub job every second and a half until `done(value)` says it has finished. */
function usePoll<T>(read: (() => Promise<T | null>) | null, done: (value: T) => boolean, onFinish: (value: T) => void): T | null {
  const [value, setValue] = useState<T | null>(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    if (read === null) return;
    let alive = true;
    const tick = () =>
      read()
        .then((next) => {
          if (!alive || next === null) return;
          setValue(next);
          if (doneRef.current(next)) {
            alive = false;
            window.clearInterval(timer);
            finishRef.current(next);
          }
        })
        .catch(() => undefined);
    const timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [read]);
  return value;
}

function ByHand({ command }: { command: string }): JSX.Element {
  return (
    <details className="setup__byhand">
      <summary>{t('setup.byHand')}</summary>
      <code className="command">{command}</code>
    </details>
  );
}

/** Installs a missing CLI through the hub and reports each step. */
export function InstallControl({ hub, provider, onInstalled }: { hub: HubApi; provider: ProviderStatus['id']; onInstalled(): void }): JSX.Element {
  const [started, setStarted] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const read = useCallback(() => hub.installStatus(provider), [hub, provider]);
  const job = usePoll<InstallJob>(
    started ? read : null,
    (j) => j.state === 'done' || j.state === 'failed',
    (j) => j.state === 'done' && onInstalled(),
  );

  const start = () => {
    setUnsupported(false);
    hub
      .installProvider(provider)
      .then((result) => (result === null ? setUnsupported(true) : setStarted(true)))
      .catch(() => setStarted(true));
  };

  if (unsupported) {
    return (
      <div className="setup__action">
        <span className="settings__quiet">{t('setup.installByHand')}</span>
        <code className="command">{INSTALL_COMMAND[provider]}</code>
      </div>
    );
  }
  if (started && job?.state !== 'failed') {
    return (
      <div className="setup__action" role="status">
        <span className="setup__working">{job?.state === 'done' ? t('setup.installed') : t('setup.installing', { step: job?.step ?? '' }).trim()}</span>
      </div>
    );
  }
  return (
    <div className="setup__action">
      {job?.state === 'failed' ? <span className="settings__warn">{job.message ?? t('setup.installFailed')}</span> : null}
      <button type="button" className="button" onClick={start}>
        {job?.state === 'failed' ? t('setup.retryInstall') : t('setup.install', { provider: PROVIDER_NAME[provider] })}
      </button>
      <ByHand command={INSTALL_COMMAND[provider]} />
    </div>
  );
}

/** Signs an account in through the CLI's own browser flow, started from the hub. */
export function LoginControl({ hub, account, command, onSignedIn }: { hub: HubApi; account: AiAccount; command?: string; onSignedIn(): void }): JSX.Element {
  const [started, setStarted] = useState(false);
  const read = useCallback(() => hub.accountLogin(account.id), [hub, account.id]);
  const login = usePoll<AccountLogin>(
    started ? read : null,
    (l) => l.state === 'done' || l.state === 'failed',
    (l) => l.state === 'done' && onSignedIn(),
  );

  const start = () => {
    setStarted(false);
    hub
      .retryAccountLogin(account.id)
      .then(() => setStarted(true))
      .catch(() => setStarted(true));
  };

  if (started && login?.state !== 'failed') {
    return (
      <div className="setup__action" role="status">
        <span className="setup__working">{t('accounts.finishInBrowser', { provider: PROVIDER_NAME[account.provider] })}</span>
        {login?.verificationUrl !== undefined ? (
          <a className="text-link" href={login.verificationUrl} target="_blank" rel="noreferrer noopener">
            {t('accounts.openLogin')}
          </a>
        ) : null}
        {login?.userCode !== undefined ? <code className="command">{login.userCode}</code> : null}
      </div>
    );
  }
  return (
    <div className="setup__action">
      {login?.state === 'failed' ? <span className="settings__warn">{login.message ?? t('accounts.loginFailed')}</span> : null}
      <button type="button" className="button" onClick={start}>
        {login?.state === 'failed' ? t('accounts.retryLogin') : t('setup.login', { provider: PROVIDER_NAME[account.provider] })}
      </button>
      <ByHand command={command ?? LOGIN_COMMAND[account.provider]} />
    </div>
  );
}

/**
 * One AI service as a newcomer sees it: what it is for, whether it is ready, and the one
 * thing to do next — install it, or sign in — without opening a terminal.
 */
export function ProviderCard({
  hub,
  status,
  account,
  onChange,
}: {
  hub: HubApi;
  status: ProviderStatus;
  account: AiAccount | undefined;
  onChange(): void;
}): JSX.Element {
  const ready = status.installed && status.loggedIn;
  return (
    <div className="setup-card" data-ready={ready}>
      <div className="setup-card__head">
        <span className="setup-card__name">{PROVIDER_NAME[status.id]}</span>
        <span className={ready ? 'setup-card__state setup-card__state--ok' : 'setup-card__state'}>
          {ready ? t('setup.ready') : status.installed ? t('ai.notSignedIn') : t('ai.notInstalled')}
        </span>
      </div>
      <p className="setup-card__deck">{t(WHAT_IT_USES[status.id])}</p>
      {ready ? null : !status.installed ? (
        <InstallControl hub={hub} provider={status.id} onInstalled={onChange} />
      ) : account !== undefined ? (
        <LoginControl hub={hub} account={account} command={status.loginCommand} onSignedIn={onChange} />
      ) : (
        <div className="setup__action">
          <span className="settings__quiet">{t('ai.signInHint')}</span>
          <code className="command">{status.loginCommand ?? LOGIN_COMMAND[status.id]}</code>
        </div>
      )}
    </div>
  );
}
