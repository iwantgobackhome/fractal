import { describe, expect, it } from 'vitest';
import { updateState, type UpdateState } from './state';

describe('update notification', () => {
  it('dismisses the same version but shows a subsequent version', () => {
    const available = updateState({ phase: 'idle' }, { type: 'update-available', version: '1.2.0' });
    const later = updateState(available, { type: 'later' });
    expect(updateState(later, { type: 'update-available', version: '1.2.0' }).phase).toBe('idle');
    expect(updateState(later, { type: 'update-available', version: '1.3.0' }).phase).toBe('available');
  });
  it('keeps progress across recurring checks and offers restart only after download', () => {
    let state: UpdateState = { phase: 'available', version: '1.2.0' };
    state = updateState(state, { type: 'download' });
    state = updateState(state, { type: 'download-progress', percent: 45 });
    expect(updateState(state, { type: 'update-available', version: '1.2.0' })).toEqual(state);
    expect(updateState(state, { type: 'update-downloaded' }).phase).toBe('ready');
    expect(updateState(state, { type: 'download-progress', percent: 110 }).percent).toBe(100);
  });
  it('allows a failed download to be retried and clears the brief error', () => {
    const failed = updateState({ phase: 'downloading', version: '1.2.0' }, { type: 'update-error' });
    expect(failed.phase).toBe('available');
    expect(updateState(failed, { type: 'clear-error' }).error).toBe(false);
    expect(updateState({ phase: 'ready', version: '1.2.0' }, { type: 'update-error' }).phase).toBe('ready');
  });
});
