// Estado reactivo mínimo: get / set / subscribe, sin framework.

export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T>): void;
  /** Llama a `fn` cuando cambia el valor devuelto por `selector`. */
  select<V>(selector: (s: T) => V, fn: (value: V) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(s: T) => void>();

  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) l(state);
    },
    select(selector, fn) {
      let last = selector(state);
      const listener = (s: T) => {
        const next = selector(s);
        if (!Object.is(next, last)) {
          last = next;
          fn(next);
        }
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
