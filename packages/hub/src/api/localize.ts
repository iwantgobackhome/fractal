import type { AppError, ErrorCode } from '@fractal/shared';
import { SourceError } from '../arxiv/index';

const publicationMessages = {
  cache_changed: {
    en: 'The stored PDF no longer matches its recorded hash. The cached file was not replaced. Check the stored file or open the publication site.',
    ko: '저장된 PDF가 기록된 해시와 일치하지 않습니다. 캐시 파일은 교체되지 않았습니다. 저장 파일을 확인하거나 출판물 사이트를 여세요.',
  },
  source_changed: {
    en: 'The PDF bytes differ from this publication’s recorded file. The existing file was not replaced. Check the source before retrying.',
    ko: 'PDF가 이 출판물의 기록된 파일과 다릅니다. 기존 파일은 교체되지 않았습니다. 원문을 확인한 후 다시 시도하세요.',
  },
  no_main_pdf: {
    en: 'The source page did not identify one main PDF. It may require sign-in. Retry, open the publication site, or link your PDF.',
    ko: '원문 페이지에서 논문 PDF를 하나로 확인하지 못했습니다. 로그인이 필요할 수 있습니다. 다시 시도하거나 원문 사이트 또는 PDF 연결을 이용하세요.',
  },
  non_pdf: {
    en: 'The source did not return a readable PDF. It may have returned a sign-in page. Use a direct PDF link or link your PDF.',
    ko: '원문이 읽을 수 있는 PDF를 반환하지 않았습니다. 로그인 페이지가 반환되었을 수 있습니다. PDF 직접 링크 또는 PDF 연결을 이용하세요.',
  },
  auth: {
    en: 'The publication or metadata source requires authorization. Open the source to sign in, or link a PDF you can access.',
    ko: '출판물 또는 서지 정보 소스에 접근 권한이 필요합니다. 원문에서 로그인하거나 접근 가능한 PDF를 연결하세요.',
  },
  missing: {
    en: 'No publicly downloadable PDF was found for this publication. Retry, open the source, or link your PDF.',
    ko: '이 출판물에서 공개 다운로드 가능한 PDF를 찾지 못했습니다. 다시 시도하거나 원문 또는 PDF 연결을 이용하세요.',
  },
  timeout: {
    en: 'Publication download exceeded its time limit. Retry, open the source, or link your PDF.',
    ko: '출판물 다운로드 시간이 초과되었습니다. 다시 시도하거나 원문 또는 PDF 연결을 이용하세요.',
  },
  network: {
    en: 'The publication source could not be reached or rejected the download. Retry, open the source, or link your PDF.',
    ko: '출판물 소스에 연결할 수 없거나 다운로드가 거부되었습니다. 다시 시도하거나 원문 또는 PDF 연결을 이용하세요.',
  },
  quota: {
    en: 'The publication source is limiting requests. Retry later, open the source, or link your PDF.',
    ko: '출판물 소스가 요청을 제한하고 있습니다. 나중에 다시 시도하거나 원문 또는 PDF 연결을 이용하세요.',
  },
  size: {
    en: 'The source response exceeds the download size limit. Try a direct PDF link or a supported smaller file.',
    ko: '원문 응답이 다운로드 크기 제한을 초과했습니다. PDF 직접 링크 또는 지원되는 더 작은 파일을 이용하세요.',
  },
  conflict: {
    en: 'The publication identifiers conflict with the requested paper. No PDF was linked. Check the source or choose the correct PDF.',
    ko: '출판물 식별자가 요청한 논문과 다릅니다. PDF는 연결되지 않았습니다. 원문을 확인하거나 올바른 PDF를 선택하세요.',
  },
  url: {
    en: 'This publication URL cannot be downloaded here. Use a public HTTPS publication or direct PDF URL.',
    ko: '이 출판물 주소는 여기에서 다운로드할 수 없습니다. 공개 HTTPS 출판물 또는 PDF 직접 주소를 이용하세요.',
  },
};
// Internal request-scoped annotation, never a new wire field or unbounded raw cause.
const publicationFailures = new WeakMap<AppError, keyof typeof publicationMessages>();
export function markPublicationFailure(error: AppError, cause: unknown): void {
  if (error.code === 'SOURCE_CHANGED') {
    publicationFailures.set(
      error,
      error.message === 'Stored PDF bytes no longer match this publication. The cached file was not replaced.' ? 'cache_changed' : 'source_changed',
    );
    return;
  }
  if (
    error.code === 'INVALID_INPUT' &&
    ((cause instanceof SourceError && cause.reason === 'IDENTIFIER_CONFLICT') || /identifiers? conflict/i.test(error.message))
  ) {
    publicationFailures.set(error, 'conflict');
    return;
  }
  if (!(cause instanceof SourceError)) return;
  const kind =
    error.code === 'INVALID_INPUT'
      ? error.message === '이 페이지에서 논문 PDF를 하나로 확인할 수 없습니다. PDF 직접 주소를 입력하세요.'
        ? 'no_main_pdf'
        : 'url'
      : error.code === 'UNSUPPORTED_PDF'
        ? 'non_pdf'
        : error.code === 'AUTH_REQUIRED'
          ? 'auth'
          : error.code === 'NOT_FOUND'
            ? 'missing'
            : error.code === 'NETWORK'
              ? /time budget|시간을 초과/u.test(error.message)
                ? 'timeout'
                : 'network'
              : error.code === 'QUOTA'
                ? 'quota'
                : error.code === 'TOO_LARGE'
                  ? 'size'
                  : null;
  if (kind) publicationFailures.set(error, kind);
}

const messages: Record<ErrorCode, { ko: string; en: string }> = {
  ARTICLE_UNAVAILABLE: {
    ko: '이 기사를 앱에서 읽을 수 없습니다. 브라우저에서 열어 주세요.',
    en: 'This article could not be read here. Open it in your browser.',
  },
  QUICK_TRANSLATE_UNAVAILABLE: {
    ko: '빠른 번역을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    en: 'Quick translation is unavailable. Try again shortly.',
  },
  RELATED_RATE_LIMITED: {
    ko: 'Semantic Scholar가 바쁩니다. 잠시 후 관련 논문을 다시 시도해 주세요.',
    en: 'Semantic Scholar is busy. Try related papers again shortly.',
  },
  INVALID_INPUT: { ko: '요청 형식이 올바르지 않습니다.', en: 'Invalid request.' },
  NOT_FOUND: { ko: '요청한 항목을 찾을 수 없습니다.', en: 'The requested item was not found.' },
  NETWORK: { ko: '네트워크 연결을 확인해 주세요.', en: 'Check the network connection.' },
  TOO_LARGE: { ko: '요청이 너무 큽니다.', en: 'The request is too large.' },
  UNSUPPORTED_PDF: { ko: '이 PDF는 지원되지 않습니다.', en: 'This PDF is not supported.' },
  SOURCE_CHANGED: { ko: '원문이 변경되었습니다.', en: 'The source has changed.' },
  AUTH_REQUIRED: { ko: 'CLI에서 로그인해 주세요.', en: 'Sign in through the CLI.' },
  SUBSCRIPTION_REQUIRED: { ko: '구독 로그인이 필요합니다.', en: 'A subscription login is required.' },
  QUOTA: { ko: '사용량 제한에 도달했습니다.', en: 'The usage limit has been reached.' },
  MODEL_UNAVAILABLE: { ko: '선택한 모델을 사용할 수 없습니다.', en: 'The selected model is unavailable.' },
  BUSY: { ko: '다른 작업이 진행 중입니다.', en: 'Another task is in progress.' },
  INVALID_TRANSLATION: { ko: '번역 응답이 올바르지 않습니다.', en: 'The translation response was invalid.' },
  STORAGE: { ko: '저장 중 오류가 발생했습니다.', en: 'Could not save the data.' },
  UNSAFE_RUNTIME: { ko: '안전한 실행 환경을 확인할 수 없습니다.', en: 'A safe runtime could not be verified.' },
  INTERNAL: { ko: '로컬 서비스에서 오류가 발생했습니다.', en: 'The local service encountered an error.' },
};

export function localizeError(error: AppError, language: 'ko' | 'en'): AppError {
  if (error.code === 'TOO_LARGE' && language === 'en') {
    const pages = /PDF 페이지 제한\((\d+)쪽\)/u.exec(error.message);
    const bytes = /PDF 크기 제한\((\d+) MiB\)/u.exec(error.message);
    if (pages) return { ...error, message: `PDF exceeds the ${pages[1]}-page limit.` };
    if (bytes || /PDF.*300 MiB|300 MiB.*PDF/u.test(error.message)) return { ...error, message: `PDF exceeds the ${bytes?.[1] ?? '300'} MiB size limit.` };
  }
  const publication = publicationFailures.get(error);
  if (publication) return { ...error, message: publicationMessages[publication][language] };
  if (error.code === 'UNSAFE_RUNTIME') return error;
  return {
    ...error,
    message: language === 'ko' && /[\uac00-\ud7a3]/u.test(error.message) ? error.message : (messages[error.code]?.[language] ?? error.message),
  };
}

export function localizePayload(value: unknown, language: 'ko' | 'en'): unknown {
  if (Array.isArray(value)) return value.map((item) => localizePayload(item, language));
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  const record = value as Record<string, unknown>;
  if (typeof record.code === 'string' && typeof record.message === 'string' && typeof record.retryable === 'boolean' && record.code in messages)
    return localizeError(record as unknown as AppError, language);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, localizePayload(item, language)]));
}
