import { useEffect, useState, type JSX } from 'react';
import type { ContextSourceStatus, OriginalProvenance } from '@fractal/shared';
import { useLanguage } from '../i18n';

export function ReaderSourceStatus({
  provenance,
  durable,
  checkSource,
}: {
  provenance?: OriginalProvenance;
  durable?: ContextSourceStatus;
  checkSource(provenance?: OriginalProvenance): Promise<ContextSourceStatus>;
}): JSX.Element {
  const ko = useLanguage() === 'ko',
    [status, setStatus] = useState<ContextSourceStatus | undefined>(durable);
  useEffect(() => {
    let live = true;
    void checkSource(provenance).then((value) => {
      if (live) setStatus(value);
    });
    return () => {
      live = false;
    };
  }, [provenance, checkSource]);
  const labels = ko
    ? {
        current: '현재 원본 확인됨',
        unknown: '원본 식별 정보가 기록되지 않음',
        pdf_changed: '원본 PDF가 변경됨',
        layout_changed: '텍스트 추출 버전이 변경됨',
        range_invalid: '원본 텍스트 범위를 확인할 수 없음',
        unavailable: '원본 검증을 사용할 수 없음',
      }
    : {
        current: 'Current original verified',
        unknown: 'Original identity was not recorded',
        pdf_changed: 'Original PDF changed',
        layout_changed: 'Text extraction version changed',
        range_invalid: 'Original text range could not be verified',
        unavailable: 'Original verification unavailable',
      };
  const stale = !!status && status !== 'current' && status !== 'unknown';
  return (
    <p className="reader-context-status" data-stale={stale || undefined} role={stale ? 'status' : undefined}>
      {provenance?.textSource === 'translated'
        ? ko
          ? '번역문 인용'
          : 'Translated quote'
        : status
          ? labels[status]
          : ko
            ? '원본 확인 중…'
            : 'Checking original…'}
      {stale
        ? ` · ${ko ? '인용과 초안은 유지됩니다. 현재 원본에서 다시 선택하면 위치를 확인할 수 있습니다.' : 'Quote and draft retained. Select the current original again for usable grounding.'}`
        : ''}
      {durable && durable !== status ? ` · ${ko ? '완료 시 기록된 소스 상태' : 'Recorded source status at completion'}: ${labels[durable]}` : ''}
      {status === 'unavailable' ? (
        <button type="button" onClick={() => window.dispatchEvent(new Event('fractal:retry-source'))}>
          {ko ? '원본 검증 다시 시도' : 'Retry source verification'}
        </button>
      ) : null}
    </p>
  );
}
