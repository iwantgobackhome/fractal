export type ErrorCode = 'INVALID_INPUT'|'NOT_FOUND'|'NETWORK'|'TOO_LARGE'|'UNSUPPORTED_PDF'|'SOURCE_CHANGED'|'AUTH_REQUIRED'|'SUBSCRIPTION_REQUIRED'|'QUOTA'|'MODEL_UNAVAILABLE'|'BUSY'|'INVALID_TRANSLATION'|'STORAGE'|'UNSAFE_RUNTIME'|'INTERNAL';
export interface AppError { code:ErrorCode; message:string; retryable:boolean }
export type ApiResult<T> = {data:T}|{error:AppError};
