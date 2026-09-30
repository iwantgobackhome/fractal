import { useEffect, useState, type JSX } from 'react';
import { locale, t } from '../i18n';
import type { AccountLimits, HubApi, LimitWindow } from './hub-api';
import { PROVIDER_NAME } from './settings-parts';

const POLL_MS = 60_000;

/**
 * The quota of every signed-in account, read every minute and whenever the window
 * comes back into focus. `null` means the hub does not report limits.
 */
export function useLimits(hub: HubApi): AccountLimits[] | null | undefined {
  const [limits, setLimits] = useState<AccountLimits[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const read = () => {
      if (document.visibilityState === 'hidden') return;
      hub
        .limits()
        .then((next) => alive && setLimits(next))
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, [hub]);
  return limits;
}

/** "15:20" today, "Thu 09:00" later this week. */
function resetTime(iso: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(locale(), sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(
    at,
  );
}

function level(used: number): 'calm' | 'high' | 'full' {
  if (used >= 95) return 'full';
  if (used >= 80) return 'high';
  return 'calm';
}

function Window({ name, window }: { name: string; window: LimitWindow }): JSX.Element {
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const reset = window.resetsAt === null ? null : resetTime(window.resetsAt);
  const state = level(used);
  const title =
    reset === null
      ? t('usage.windowTitle', { window: name, used: Math.round(used) })
      : t('usage.windowTitleReset', { window: name, used: Math.round(used), time: reset });
  return (
    <span className="usage-bar__window" data-level={state} title={title}>
      <span className="usage-bar__name">{name}</span>
      <span className="usage-bar__meter" aria-hidden="true">
        <span style={{ width: `${used}%` }} />
      </span>
      <span className="usage-bar__num">{Math.round(used)}%</span>
      {state !== 'calm' && reset !== null ? <span className="usage-bar__reset">{t('usage.resetsAt', { time: reset })}</span> : null}
    </span>
  );
}

/**
 * A quiet line along the bottom of every screen: how much of each subscription's
 * five-hour and weekly allowance is used. Only the account each provider runs on is
 * shown; the others are in settings.
 */
export function UsageBar({ hub, onOpenSettings }: { hub: HubApi; onOpenSettings(): void }): JSX.Element | null {
  const limits = useLimits(hub);
  if (limits === undefined || limits === null || limits.length === 0) return null;
  // The account each provider runs on; one the hub cannot measure is explained in settings instead.
  const shown = limits.filter((account) => account.active !== false && account.state !== 'unavailable');
  if (shown.length === 0) return null;
  // Name the account only where a provider has more than one to choose from.
  const several = (provider: AccountLimits['provider']) => limits.filter((a) => a.provider === provider).length > 1;
  const accountLabel = (account: AccountLimits) => (account.kind === 'system' ? t('accounts.system') : account.label);

  return (
    <footer className="usage-bar" aria-label={t('usage.barLabel')}>
      <button type="button" className="usage-bar__open" onClick={onOpenSettings}>
        {shown.map((account) => (
          <span key={account.accountId} className="usage-bar__account">
            <span className="usage-bar__provider">
              {PROVIDER_NAME[account.provider]}
              {several(account.provider) ? <span className="usage-bar__label"> {accountLabel(account)}</span> : null}
            </span>
            {account.state === 'notLoggedIn' ? (
              <span className="usage-bar__quiet">{t('ai.notSignedIn')}</span>
            ) : (
              <>
                {account.windows.fiveHour !== null ? <Window name={t('usage.fiveHour')} window={account.windows.fiveHour} /> : null}
                {account.windows.weekly !== null ? <Window name={t('usage.weekShort')} window={account.windows.weekly} /> : null}
                {account.windows.fiveHour === null && account.windows.weekly === null ? <span className="usage-bar__quiet">{t('usage.unknown')}</span> : null}
              </>
            )}
          </span>
        ))}
      </button>
    </footer>
  );
}
