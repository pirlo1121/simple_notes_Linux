export interface Debounced {
  (): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

/**
 * Retrasa `fn` hasta `wait` ms sin llamadas. Con `maxWait` se ejecuta como
 * mínimo cada `maxWait` ms aunque las llamadas no cesen (escritura continua).
 */
export function useDebounce(fn: () => void, wait: number, maxWait = Infinity): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstCall = 0;

  const run = () => {
    timer = undefined;
    firstCall = 0;
    fn();
  };

  const debounced = (() => {
    const now = Date.now();
    if (!firstCall) firstCall = now;
    if (timer) clearTimeout(timer);
    const remaining = Math.min(wait, Math.max(0, firstCall + maxWait - now));
    timer = setTimeout(run, remaining);
  }) as Debounced;

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    firstCall = 0;
  };
  debounced.pending = () => timer !== undefined;
  return debounced;
}
