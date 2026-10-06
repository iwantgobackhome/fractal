import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { t } from '../i18n';
import type { AccountLimits, AccountLogin, AiAccount, HubApi, ProviderStatus } from './hub-api';
import { PROVIDER_NAME } from './settings-parts';
import { InstallControl, LoginControl } from './ProviderSetup';
import { useLimits } from './UsageBar';

const LOGIN_POLL_MS = 2_000;

function accountName(account: AiAccount): string {
  return account.kind === 'system' ? t('accounts.system') : account.label;
}

function LimitsLine({ limits }: { limits: AccountLimits | undefined }): JSX.Element | null {
  if (limits === undefined || limits.state !== 'ok') return null;
  const parts = [
    limits.windows.fiveHour === null ? null : t('accounts.fiveHourUsed', { used: Math.round(limits.windows.fiveHour.usedPercent) }),
    limits.windows.weekly === null ? null : t('accounts.weeklyUsed', { used: Math.round(limits.windows.weekly.usedPercent) }),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : <span className="account__limits">{parts.join(' · ')}</span>;
}

/** Follows one account's sign-in in the browser until the CLI reports it finished. */
function LoginProgress({ hub, account, onDone }: { hub: HubApi; account: AiAccount; onDone(): void }): JSX.Element {
  const [login, setLogin] = useState<AccountLogin | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let alive = true;
    const poll = () =>
      hub
        .accountLogin(account.id)
        .then((next) => {
          if (!alive) return;
          setLogin(next);
          if (next?.state === 'done') doneRef.current();
        })
        .catch(() => undefined);
    void poll();
    const timer = window.setInterval(() => void poll(), LOGIN_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [hub, account.id]);

  if (login?.state === 'failed') {
    return (
      <p className="account__login">
        <span className="settings__warn">{login.message ?? t('accounts.loginFailed')}</span>{' '}
        <button type="button" className="text-link" onClick={() => void hub.retryAccountLogin(account.id).then(setLogin)}>
          {t('accounts.retryLogin')}
        </button>
      </p>
    );
  }
  return (
    <p className="account__login">
      <span className="settings__quiet">{t('accounts.finishInBrowser', { provider: PROVIDER_NAME[account.provider] })}</span>
      {login?.verificationUrl !== undefined ? (
        <a className="text-link" href={login.verificationUrl} target="_blank" rel="noreferrer noopener">
          {t('accounts.openLogin')}
        </a>
      ) : null}
      {login?.userCode !== undefined ? <code className="command">{login.userCode}</code> : null}
    </p>
  );
}

function AddAccount({ hub, provider, onAdded }: { hub: HubApi; provider: AiAccount['provider']; onAdded(account: AiAccount): void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="text-link" onClick={() => setOpen(true)}>
        {t('accounts.add', { provider: PROVIDER_NAME[provider] })}
      </button>
    );
  }
  return (
    <form
      className="account-add"
      onSubmit={(event) => {
        event.preventDefault();
        const name = label.trim();
        if (name === '') return;
        setBusy(true);
        setError(null);
        hub
          .addAccount(provider, name)
          .then((account) => {
            if (account === null) throw new Error(t('settings.unavailable'));
            setOpen(false);
            setLabel('');
            onAdded(account);
          })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('errors.request')))
          .finally(() => setBusy(false));
      }}
    >
      <label className="sr-only" htmlFor={`account-label-${provider}`}>
        {t('accounts.labelField')}
      </label>
      <input
        id={`account-label-${provider}`}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder={t('accounts.labelPlaceholder')}
        maxLength={60}
        autoFocus
      />
      <button type="submit" className="button" disabled={busy || label.trim() === ''}>
        {busy ? t('accounts.adding') : t('accounts.addAndLogin')}
      </button>
      <button type="button" className="text-link text-link--quiet" onClick={() => setOpen(false)}>
        {t('dialog.cancel')}
      </button>
      {error !== null ? <p className="settings__warn">{error}</p> : null}
    </form>
  );
}

/**
 * Every Codex and Claude sign-in Fractal can use, one of each running at a time. The
 * reader's own terminal login is always there; more accounts sign in through the
 * CLI's browser flow and live in Fractal's data folder.
 */
export function AccountsPanel({
  hub,
  accounts,
  providers,
  onChange,
}: {
  hub: HubApi;
  accounts: AiAccount[];
  providers: ProviderStatus[];
  onChange(): void;
}): JSX.Element {
  const limits = useLimits(hub) ?? [];
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<AiAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finished = useCallback(
    (id: string) => {
      setPending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      onChange();
    },
    [onChange],
  );

  const act = (work: Promise<unknown>) => {
    setError(null);
    work.then(onChange).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('errors.request')));
  };

  const order: AiAccount['provider'][] = ['codex', 'claude'];
  return (
    <div className="accounts">
      {order.map((provider) => {
        const status = providers.find((p) => p.id === provider);
        const own = accounts.filter((a) => a.provider === provider);
        return (
          <section key={provider} className="accounts__provider" aria-label={PROVIDER_NAME[provider]}>
            <h3 className="accounts__title">
              {PROVIDER_NAME[provider]}
              {status?.version ? <span className="settings__quiet"> {status.version.replace(/^codex-cli\s+/, '').replace(/\s*\(.*\)$/, '')}</span> : null}
            </h3>
            {status !== undefined && !status.installed ? (
              <InstallControl hub={hub} provider={provider} command={status.installCommand} onInstalled={onChange} />
            ) : (
              <ul className="account-list">
                {own.map((account) => (
                  <li key={account.id} className="account" data-active={account.active}>
                    <label className="account__pick">
                      <input
                        type="radio"
                        name={`account-${provider}`}
                        checked={account.active}
                        disabled={!account.loggedIn}
                        onChange={() => act(hub.updateAccount(account.id, { active: true }))}
                      />
                      <span className="account__name">{accountName(account)}</span>
                    </label>
                    <span className="account__detail">
                      {account.email ?? ''}
                      {account.email !== undefined && account.plan !== undefined ? ' · ' : ''}
                      {account.plan ?? ''}
                    </span>
                    {account.loggedIn ? (
                      <LimitsLine limits={limits.find((l) => l.accountId === account.id)} />
                    ) : pending.has(account.id) ? null : account.kind === 'system' ? (
                      <span className="account__todo">
                        <span className="settings__warn">{t('ai.notSignedIn')}</span>
                        <LoginControl hub={hub} account={account} command={status?.loginCommand} onSignedIn={onChange} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          setPending((current) => new Set(current).add(account.id));
                          void hub.retryAccountLogin(account.id).catch(() => undefined);
                        }}
                      >
                        {t('accounts.login')}
                      </button>
                    )}
                    {account.kind === 'managed' ? (
                      <button type="button" className="text-link text-link--quiet account__remove" onClick={() => setRemoving(account)}>
                        {t('accounts.remove')}
                      </button>
                    ) : null}
                    {pending.has(account.id) ? <LoginProgress hub={hub} account={account} onDone={() => finished(account.id)} /> : null}
                  </li>
                ))}
              </ul>
            )}
            {status === undefined || status.installed ? (
              <AddAccount
                hub={hub}
                provider={provider}
                onAdded={(account) => {
                  setPending((current) => new Set(current).add(account.id));
                  onChange();
                }}
              />
            ) : null}
          </section>
        );
      })}
      {error !== null ? <p className="settings__warn">{error}</p> : null}
      {removing !== null ? (
        <ConfirmDialog
          title={t('accounts.removeTitle')}
          confirmLabel={t('accounts.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const account = removing;
            setRemoving(null);
            act(hub.removeAccount(account.id));
          }}
        >
          <p className="confirm__subject">
            {PROVIDER_NAME[removing.provider]} · {removing.label}
          </p>
          <p>{t('accounts.removeBody')}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
