// Contrato con el proceso Rust. En el navegador (npm run dev sin Tauri)
// se usa una implementación en memoria para poder iterar sobre la interfaz.

import type { HistoryEntry, NoteDoc, NoteInput, NoteMeta, PersistedState, ShortcutStatus } from '../types';

export type BackendEvent = 'summoned' | 'hiding' | 'quit';

export interface Backend {
  listNotes(): Promise<NoteMeta[]>;
  search(query: string, limit?: number): Promise<NoteMeta[]>;
  getNote(id: string): Promise<NoteDoc | null>;
  /** `snapshot`: copiar siempre la versión actual al historial antes de escribir. */
  saveNote(note: NoteInput, snapshot?: boolean): Promise<NoteMeta>;
  setPinned(id: string, pinned: boolean): Promise<NoteMeta>;
  deleteNote(id: string): Promise<void>;
  restoreNote(id: string): Promise<NoteMeta>;
  /** Relee cambios hechos fuera de la app. Devuelve true si hubo alguno. */
  syncDisk(): Promise<boolean>;
  listHistory(id: string): Promise<HistoryEntry[]>;
  readHistory(id: string, stamp: number): Promise<NoteDoc>;
  readState(): Promise<PersistedState | null>;
  writeState(state: PersistedState): Promise<void>;
  notesDir(): Promise<string>;
  openFolder(): Promise<void>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<boolean>;
  shortcutStatus(): Promise<ShortcutStatus | null>;
  hideWindow(): Promise<void>;
  quit(): Promise<void>;
  on(event: BackendEvent, fn: () => void): Promise<() => void>;
}

export const isTauri = '__TAURI_INTERNALS__' in window;

export async function createBackend(): Promise<Backend> {
  if (isTauri) return (await import('./tauriBackend')).tauriBackend;
  return (await import('./mockBackend')).createMockBackend();
}
