import { useEffect, useId, useRef, useState, type JSX } from 'react';
import type { LibraryRecord, PublicationMetadata } from '@fractal/shared';
import { useLanguage } from '../i18n';
import type { HubApi } from './hub-api';
import { providerName, type PublicationItem } from './publication-model';

export function useCatalog(hub: HubApi): LibraryRecord[] {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  useEffect(() => {
    let alive = true,
      pending = false,
      again = false;
    const load = async () => {
      if (pending) {
        again = true;
        return;
      }
      pending = true;
      try {
        const next = await hub.library();
        if (alive && next) setRecords(next);
      } catch {
        /* row actions still expose their own failure */
      } finally {
        pending = false;
        if (alive && again) {
          again = false;
          void load();
        }
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

type Action = 'read' | 'save' | 'link';
const readingOwners = new WeakMap<HubApi, symbol>();

type ActionProps = {
  hub: HubApi;
  item: PublicationItem;
  record: LibraryRecord | null;
  feedId?: string;
  hasPdf: boolean;
  onOpen(key: string): void;
  showSave?: boolean;
};

export function PublicationActions(props: ActionProps): JSX.Element {
  // A replacement row cannot inherit an old item's busy state or late response.
  const identity = JSON.stringify([props.item.url, props.item.doi, props.item.arxivId, props.item.title, props.item.authors]);
  return <PublicationActionRow key={identity} {...props} />;
}

function PublicationActionRow({ hub, item, record, feedId, hasPdf, onOpen, showSave = true }: ActionProps): JSX.Element {
  const ko = useLanguage() === 'ko';
  const say = (en: string, kr: string) => (ko ? kr : en);
  const [pending, setPending] = useState<Action | null>(null),
    [error, setError] = useState<{ action: Action; message: string } | null>(null);
  const busy = useRef(false),
    alive = useRef(true),
    file = useRef<HTMLInputElement>(null),
    root = useRef<HTMLDivElement>(null),
    alert = useRef<HTMLParagraphElement>(null),
    focusError = useRef(false);
  const statusId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (error && focusError.current) alert.current?.focus();
  }, [error]);

  const reason = (cause: unknown): string => {
    const code = (cause as { code?: string } | null)?.code;
    if (code === 'pdf_open_unavailable')
      return say(
        'This Hub does not support in-app PDF acquisition. Update the Hub, or use a source link or link your PDF.',
        '이 Hub는 앱 내 PDF 가져오기를 지원하지 않습니다. Hub를 업데이트하거나 원문 링크 또는 PDF 연결을 이용하세요.',
      );
    if (code === 'pdf_open_timeout')
      return say(
        'The PDF request took too long. Retry, visit the source, or link your PDF.',
        'PDF 요청 시간이 초과되었습니다. 다시 시도하거나 원문 사이트 또는 PDF 연결을 이용하세요.',
      );
    if (code === 'pdf_open_invalid')
      return say(
        'The Hub did not return a readable PDF. Retry or link your PDF.',
        'Hub가 읽을 수 있는 PDF를 반환하지 않았습니다. 다시 시도하거나 PDF를 연결하세요.',
      );
    if (cause instanceof TypeError)
      return say('Could not reach the Hub. Check the connection and retry.', 'Hub에 연결할 수 없습니다. 연결을 확인한 후 다시 시도하세요.');
    return cause instanceof Error ? cause.message : String(cause);
  };
  const run = async (kind: Action, action: () => Promise<unknown>, after?: (result: unknown) => void) => {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    setError(null);
    try {
      const result = await action();
      if (!result) throw new Error(say('This action is unavailable. Try again.', '이 작업을 사용할 수 없습니다. 다시 시도하세요.'));
      if (alive.current) after?.(result);
    } catch (cause) {
      if (alive.current) {
        focusError.current = document.activeElement === document.body || !!root.current?.contains(document.activeElement);
        setError({ action: kind, message: reason(cause) });
      }
    } finally {
      busy.current = false;
      if (alive.current) setPending(null);
    }
  };
  const read = () => {
    if (busy.current) return;
    const owner = Symbol(),
      route = window.location.hash;
    readingOwners.set(hub, owner);
    const open = (key: string) => {
      if (alive.current && readingOwners.get(hub) === owner && window.location.hash === route) onOpen(key);
    };
    if (record && hasPdf) {
      open(record.paperKey);
      return;
    }
    void run(
      'read',
      async () => {
        const result = await hub.openPublication(item);
        if (!result) throw Object.assign(new Error('In-app PDF acquisition is unavailable'), { code: 'pdf_open_unavailable' });
        return result.paperKey;
      },
      (key) => open(key as string),
    );
  };
  const save = () =>
    void run('save', () =>
      record ? hub.patchLibrary(record.paperKey, { saved: record.saved === false }) : feedId ? hub.saveFeedItem(feedId) : hub.bookmark(item),
    );
  return (
    <div ref={root} className="publication-actions" aria-busy={!!pending}>
      <button
        type="button"
        className="publication-read"
        disabled={!!pending}
        onClick={read}
        aria-describedby={pending === 'read' || error?.action === 'read' ? statusId : undefined}
      >
        {pending === 'read' ? say('Opening PDF…', 'PDF를 여는 중…') : say('Read PDF', 'PDF 읽기')}
      </button>
      {showSave ? (
        <button
          type="button"
          disabled={!!pending}
          onClick={save}
          aria-label={`${record && record.saved !== false ? say('Remove saved', '저장 해제') : say('Save metadata', '서지 정보 저장')}: ${item.title}`}
        >
          {pending === 'save'
            ? say('Saving…', '저장 처리 중…')
            : record && record.saved !== false
              ? say('Remove saved', '저장 해제')
              : say('Save metadata', '서지 정보 저장')}
        </button>
      ) : null}
      {record && !hasPdf ? (
        <>
          <button type="button" disabled={!!pending} onClick={() => file.current?.click()} aria-label={`${say('Link PDF', 'PDF 연결')}: ${item.title}`}>
            {pending === 'link' ? say('Linking PDF…', 'PDF 연결 중…') : say('Link PDF…', 'PDF 연결…')}
          </button>
          <span className="publication-hint">
            {say('Choose the PDF for this publication; its library identity stays the same.', '이 출판물의 PDF를 선택하세요. 보관함의 논문 정보는 유지됩니다.')}
          </span>
        </>
      ) : !record ? (
        <span className="publication-hint">
          {say(
            'To link your own PDF, choose Save metadata, then Link PDF. Read PDF works without saving.',
            '직접 PDF를 연결하려면 서지 정보 저장 후 PDF 연결을 선택하세요. PDF 읽기는 저장 없이 사용할 수 있습니다.',
          )}
        </span>
      ) : null}
      {pending === 'read' ? (
        <p id={statusId} role="status" className="publication-hint">
          {say('Finding and downloading the PDF for the reader…', '리더에서 읽을 PDF를 찾아 다운로드하는 중…')}
        </p>
      ) : null}
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
          const owner = Symbol(),
            route = window.location.hash;
          readingOwners.set(hub, owner);
          void run(
            'link',
            async () => {
              const result = await hub.linkPdf(record.paperKey, selected);
              if (result && !result.hasPdf) throw new Error(say('The linked file is not a readable PDF.', '연결한 파일을 PDF로 읽을 수 없습니다.'));
              return result?.paperKey;
            },
            (key) => {
              if (readingOwners.get(hub) === owner && window.location.hash === route) onOpen(key as string);
            },
          );
        }}
      />
      {error ? (
        <p ref={alert} id={statusId} role="alert" tabIndex={-1} className="publication-error">
          {error.action === 'read' ? <strong>{say('Could not open PDF. ', 'PDF를 열 수 없습니다. ')}</strong> : null}
          {error.message}{' '}
          {error.action === 'read' ? (
            <button type="button" disabled={!!pending} onClick={read}>
              {say('Retry Read PDF', 'PDF 읽기 다시 시도')}
            </button>
          ) : null}{' '}
          <button type="button" disabled={!!pending} onClick={() => setError(null)}>
            {say('Dismiss', '닫기')}
          </button>
        </p>
      ) : null}
    </div>
  );
}
