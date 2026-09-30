import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { LibraryRecord, PublicationMetadata } from '@fractal/shared';
import { useLanguage } from '../i18n';
import type { HubApi } from './hub-api';
import { providerName, type PublicationItem } from './publication-model';

export function useCatalog(hub: HubApi): LibraryRecord[] {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  useEffect(() => {
    let alive = true,
      pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await hub.library();
        if (alive && next) setRecords(next);
      } catch {
        /* row actions still expose their own failure */
      } finally {
        pending = false;
      }
    };
    void load();
    window.addEventListener('fractal:catalog-changed', load);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('fractal:catalog-changed', load);
      window.removeEventListener('focus', load);
    };
  }, [hub]);
  return records;
}

export function PublicationMeta({
  publication,
  source,
  year,
  venue,
}: {
  publication?: PublicationMetadata;
  source?: string;
  year?: number | null;
  venue?: string | null;
}): JSX.Element {
  const ko = useLanguage() === 'ko';
  const kinds = ko
    ? { journal: '학술지', conference: '학회', preprint: '프리프린트', other: '기타 출판물', unknown: '출판 유형 미상' }
    : { journal: 'Journal', conference: 'Conference', preprint: 'Preprint', other: 'Other publication', unknown: 'Publication type unknown' };
  return (
    <div className="publication-meta">
      <span>{kinds[publication?.publicationKind ?? 'unknown']}</span>
      <span>{publication?.venue || venue || (ko ? '출판처 미상' : 'Venue unknown')}</span>
      <span>{publication?.year ?? year ?? (ko ? '연도 미상' : 'Year unknown')}</span>
      <span>
        {publication?.oaAvailability === 'open'
          ? ko
            ? '오픈 액세스'
            : 'Open access'
          : publication?.oaAvailability === 'closed'
            ? ko
              ? '제한된 액세스'
              : 'Closed access'
            : ko
              ? '접근 상태 미상'
              : 'Access unknown'}
      </span>
      {source ? (
        <span>
          {source
            .split(',')
            .map((s) => providerName(s.trim()))
            .join(' · ')}
        </span>
      ) : null}
      {publication?.publicationDate ? <time dateTime={publication.publicationDate}>{publication.publicationDate}</time> : null}
    </div>
  );
}

export function PublicationActions({
  hub,
  item,
  record,
  feedId,
  hasPdf,
  onOpen,
}: {
  hub: HubApi;
  item: PublicationItem;
  record: LibraryRecord | null;
  feedId?: string;
  hasPdf: boolean;
  onOpen(key: string): void;
}): JSX.Element {
  const ko = useLanguage() === 'ko';
  const say = (en: string, kr: string) => (ko ? kr : en);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false),
    file = useRef<HTMLInputElement>(null);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await action();
        if (!result) throw new Error(say('This action is unavailable. Try again.', '이 작업을 사용할 수 없습니다. 다시 시도하세요.'));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [ko],
  );
  const save = () =>
    void run(() => (record ? hub.patchLibrary(record.paperKey, { saved: record.saved === false }) : feedId ? hub.saveFeedItem(feedId) : hub.bookmark(item)));
  return (
    <div className="publication-actions">
      <button
        type="button"
        disabled={pending}
        onClick={save}
        aria-label={`${record && record.saved !== false ? say('Remove saved', '저장 해제') : say('Save metadata', '서지 정보 저장')}: ${item.title}`}
      >
        {pending ? say('Working…', '처리 중…') : record && record.saved !== false ? say('Remove saved', '저장 해제') : say('Save metadata', '서지 정보 저장')}
      </button>
      {record && hasPdf ? (
        <button type="button" onClick={() => onOpen(record.paperKey)}>
          {say('Read PDF', 'PDF 읽기')}
        </button>
      ) : record ? (
        <>
          <button type="button" disabled={pending} onClick={() => file.current?.click()} aria-label={`${say('Link PDF', 'PDF 연결')}: ${item.title}`}>
            {say('Link PDF…', 'PDF 연결…')}
          </button>
          <span className="publication-hint">
            {say('Choose the PDF for this publication; its library identity stays the same.', '이 출판물의 PDF를 선택하세요. 보관함의 논문 정보는 유지됩니다.')}
          </span>
        </>
      ) : (
        <span className="publication-hint">{say('Save metadata to link your PDF.', '서지 정보를 저장한 후 PDF를 연결할 수 있습니다.')}</span>
      )}
      <a href={item.url} target="_blank" rel="noreferrer noopener">
        {say('Publication source', '출판물 원문 사이트')}
      </a>
      {item.publication?.oaPdfUrl ? (
        <a href={item.publication.oaPdfUrl} target="_blank" rel="noreferrer noopener">
          {say('PDF source', 'PDF 제공 사이트')}
        </a>
      ) : !hasPdf ? (
        <span className="publication-hint">{say('PDF availability unknown', 'PDF 제공 여부 미상')}</span>
      ) : null}
      <input
        ref={file}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label={say('PDF for this publication', '이 출판물에 연결할 PDF')}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!selected || !record) return;
          void run(async () => {
            const result = await hub.linkPdf(record.paperKey, selected);
            if (result) onOpen(result.paperKey);
            return result;
          });
        }}
      />
      {error ? (
        <p role="alert" className="publication-error">
          {error}{' '}
          <button type="button" disabled={pending} onClick={() => setError(null)}>
            {say('Dismiss', '닫기')}
          </button>
        </p>
      ) : null}
    </div>
  );
}
