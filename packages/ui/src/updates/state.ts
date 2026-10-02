export type UpdateEvent =
  | { type: 'update-available'; version: string; notes?: string }
  | { type: 'download-progress'; percent: number }
  | { type: 'update-downloaded' }
  | { type: 'update-error' };

export interface UpdateState {
  phase: 'idle' | 'available' | 'downloading' | 'ready';
  version?: string;
  dismissed?: string;
  percent?: number;
  error?: boolean;
}

export function updateState(state: UpdateState, event: UpdateEvent | { type: 'later' | 'download' | 'clear-error' }): UpdateState {
  switch (event.type) {
    case 'update-available':
      if (event.version === state.dismissed || state.phase === 'downloading' || state.phase === 'ready') return state;
      return { ...state, phase: 'available', version: event.version, error: false };
    case 'later':
      return { phase: 'idle', dismissed: state.version };
    case 'download':
      return { ...state, phase: 'downloading', percent: 0, error: false };
    case 'download-progress':
      return { ...state, phase: 'downloading', percent: Number.isFinite(event.percent) ? Math.max(0, Math.min(100, event.percent)) : 0 };
    case 'update-downloaded':
      return { ...state, phase: 'ready', percent: 100, error: false };
    case 'update-error':
      return { ...state, phase: state.phase === 'ready' ? 'ready' : state.version ? 'available' : 'idle', error: true };
    case 'clear-error':
      return { ...state, error: false };
  }
}
