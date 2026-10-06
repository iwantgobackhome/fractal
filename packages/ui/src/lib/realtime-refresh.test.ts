import { afterEach, expect, it, vi } from 'vitest';
import { debouncedRefresh } from './realtime-refresh';
afterEach(() => vi.useRealTimers());
it('coalesces stream bursts and cancels pending refresh when the paper closes', () => {
  vi.useFakeTimers();
  const load = vi.fn();
  const refresh = debouncedRefresh(load);
  refresh.notify();
  vi.advanceTimersByTime(100);
  refresh.notify();
  vi.advanceTimersByTime(50);
  expect(load).toHaveBeenCalledTimes(1);
  refresh.notify();
  refresh.cancel();
  vi.advanceTimersByTime(150);
  expect(load).toHaveBeenCalledTimes(1);
});
