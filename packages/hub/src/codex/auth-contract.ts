import type { LoginAttemptResult, LoginStartResult, LogoutResult } from '@fractal/shared';

/** User authentication controls, deliberately separate from the translation capability. */
export interface AccountSession {
  startLogin(): Promise<LoginStartResult>;
  getLogin(loginId: string): Promise<LoginAttemptResult>;
  cancelLogin(loginId: string): Promise<LoginAttemptResult>;
  logout(): Promise<LogoutResult>;
}
