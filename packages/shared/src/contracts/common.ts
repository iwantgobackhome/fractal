export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_PDF'
  | 'SOURCE_CHANGED'
  | 'AUTH_REQUIRED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'QUOTA'
  | 'RELATED_RATE_LIMITED'
  | 'ARTICLE_UNAVAILABLE'
  | 'QUICK_TRANSLATE_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'BUSY'
  | 'INVALID_TRANSLATION'
  | 'STORAGE'
  | 'UNSAFE_RUNTIME'
  | 'INTERNAL';
export interface AppError {
  /** Present only for a question/explanation page beyond a known physical PDF count. */
  details?: { reason: 'page_out_of_range'; page: number; pageCount: number };
  code: ErrorCode;
  message: string;
  retryable: boolean;
}
export type ApiResult<T> = { data: T } | { error: AppError };
