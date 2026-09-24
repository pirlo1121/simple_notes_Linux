// Estado de la interfaz persistido en ~/.quicknotes/.state.json:
// notas recientes y preferencias.

import { useDebounce } from '../hooks/useDebounce';
import type { Backend } from '../services/backend';
import type { PersistedState } from '../types';

const MAX_RECENT = 30;

export class AppStateStore {
  private state: PersistedState = {};
  private save = useDebounce(() => {
    this.backend.writeState(this.state).catch((e) => console.error('state', e));
  }, 800);

  constructor(private backend: Backend) {}

  async load(): Promise<void> {
    try {
      const s = await this.backend.readState();
      if (s && typeof s === 'object') this.state = s;
    } catch (e) {
      console.error('state', e);
    }
  }

  get<K extends keyof PersistedState>(key: K): PersistedState[K] {
    return this.state[key];
  }

  set<K extends keyof PersistedState>(key: K, value: PersistedState[K]): void {
    this.state = { ...this.state, [key]: value };
    this.save();
  }

  get recent(): string[] {
    return this.state.recent ?? [];
  }

  touchRecent(id: string): void {
    if (this.recent[0] === id) return;
    this.set('recent', [id, ...this.recent.filter((r) => r !== id)].slice(0, MAX_RECENT));
  }

  forget(id: string): void {
    this.set('recent', this.recent.filter((r) => r !== id));
  }

  flush(): void {
    this.save.flush();
  }
}
