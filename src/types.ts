export interface NoteMeta {
  id: string;
  /** Título visible: el explícito o la primera línea del contenido. */
  title: string;
  pinned: boolean;
  tags: string[];
  created: number;
  updated: number;
  snippet: string;
  file: string;
}

export interface NoteDoc extends NoteMeta {
  /** Título explícito (vacío si se deriva del contenido). */
  rawTitle: string;
  body: string;
}

export interface NoteInput {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
}

export interface HistoryEntry {
  stamp: number;
  size: number;
  preview: string;
}

export interface ShortcutStatus {
  accelerator: string;
  registered: boolean;
  wayland: boolean;
  error: string | null;
}

/** Contenido de ~/.quicknotes/.state.json */
export interface PersistedState {
  recent?: string[];
  sidebar?: boolean;
  /** Tamaño del texto de las notas, en px. */
  noteFontSize?: number;
  autostartInitialized?: boolean;
  shortcutHintShown?: boolean;
}
