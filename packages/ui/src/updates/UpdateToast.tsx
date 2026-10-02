import { useEffect, useReducer } from 'react';
import { t, useLanguage } from '../i18n';
import { updateState, type UpdateEvent, type UpdateState } from './state';

interface DesktopUpdates {
  onEvent(callback: (event: UpdateEvent) => void): () => void;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
}

declare global {
  interface FractalDesktop {
    updates?: DesktopUpdates;
  }
}

const DISMISSED = 'fractal.dismissedUpdate';
function initial(): UpdateState {
  try {
    return { phase: 'idle', dismissed: localStorage.getItem(DISMISSED) ?? undefined };
  } catch {
    return { phase: 'idle' };
  }
}

export function UpdateToast() {
  useLanguage();
  const updates = window.fractalDesktop?.updates;
  const [state, dispatch] = useReducer(updateState, undefined, initial);
  useEffect(() => updates?.onEvent(dispatch), [updates]);
  useEffect(() => {
    if (!state.error) return;
    const timer = setTimeout(() => dispatch({ type: 'clear-error' }), 6000);
    return () => clearTimeout(timer);
  }, [state.error]);
  if (!updates || (state.phase === 'idle' && !state.error)) return null;
  const fail = () => dispatch({ type: 'update-error' });
  return (
    <aside
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 56,
        zIndex: 1000,
        maxWidth: 360,
        padding: 16,
        borderRadius: 10,
        background: 'var(--panel, #fff)',
        color: 'var(--ink, #202534)',
        boxShadow: '0 4px 24px #0003',
      }}
    >
      {state.error ? <p>{t('updates.error')}</p> : null}
      {state.phase === 'available' ? (
        <>
          <p>{t('updates.available', { version: state.version ?? '' })}</p>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'download' });
              void updates.download().catch(fail);
            }}
          >
            {t('updates.update')}
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(DISMISSED, state.version ?? '');
              } catch {
                /* dismiss for this session */
              }
              dispatch({ type: 'later' });
            }}
          >
            {t('updates.later')}
          </button>
        </>
      ) : null}
      {state.phase === 'downloading' ? (
        <>
          <p>{t('updates.downloading', { percent: Math.round(state.percent ?? 0) })}</p>
          <progress max={100} value={state.percent ?? 0} aria-label={t('updates.progress')} style={{ width: '100%' }} />
        </>
      ) : null}
      {state.phase === 'ready' ? (
        <button type="button" onClick={() => void updates.install().catch(fail)}>
          {t('updates.restart')}
        </button>
      ) : null}
    </aside>
  );
}
