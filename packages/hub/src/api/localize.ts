import type { AppError, ErrorCode } from '@fractal/shared';

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
