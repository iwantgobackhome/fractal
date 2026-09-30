import { useEffect, useState, type JSX } from 'react';
import type { FeedSourceStatus, PublicationProviderStatus } from '@fractal/shared';
import { locale, useLanguage } from '../i18n';
import { providerName } from './publication-model';

export function useRetryTime(statuses: { retryAt?: string }[]): number {
  const [now, setNow] = useState(Date.now());
  const until = Math.max(0, ...statuses.map((s) => (s.retryAt ? Date.parse(s.retryAt) : 0)).filter(Number.isFinite));
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
export function SourceStatus({ statuses }: { statuses: (PublicationProviderStatus | FeedSourceStatus)[] }): JSX.Element {
  const ko = useLanguage() === 'ko';
  const labels: Record<string, string> = ko
    ? {
        ok: '최신 결과',
        cached: '캐시된 결과',
        disabled: '사용 안 함',
        not_found: '일치 항목 없음',
        rate_limited: '요청 한도 초과',
        timeout: '응답 시간 초과',
        error: '소스 요청 실패',
        auth_required: '소스 인증 필요',
        budget_exhausted: '소스 할당량 소진',
      }
    : {
        ok: 'Current results',
        cached: 'Cached results',
        disabled: 'Disabled',
        not_found: 'No matching identity',
        rate_limited: 'Rate limited',
        timeout: 'Request timed out',
        error: 'Source request failed',
        auth_required: 'Source authentication required',
        budget_exhausted: 'Source budget exhausted',
      };
  return (
    <ul className="source-status" aria-label={ko ? '소스 상태' : 'Source status'}>
      {statuses.map((status, i) => {
        const provider = 'provider' in status ? status.provider : status.source;
        const state = 'errorCode' in status && status.errorCode ? status.errorCode : status.state;
        return (
          <li key={`${provider}:${i}`} data-state={state}>
            <strong>{providerName(provider)}</strong> <span>{labels[state] ?? state}</span>
            {status.message ? <span>{status.message}</span> : null}
            {'fetchedAt' in status && status.fetchedAt ? (
              <span>
                {ko ? '캐시 시각' : 'Cached'}: {new Date(status.fetchedAt).toLocaleString(locale())}
              </span>
            ) : null}
            {status.retryAt ? (
              <span>
                {ko ? '재시도 가능' : 'Retry after'}: {new Date(status.retryAt).toLocaleString(locale())}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
