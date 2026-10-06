/** Coalesce a burst of invalidations without postponing the refresh indefinitely. */
export function debouncedRefresh(load: () => void, delay = 150): { notify(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    notify() {
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          load();
        }, delay);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
