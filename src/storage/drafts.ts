// Diario de borradores para recuperación ante fallos.
//
// Cada pulsación escribe el estado de la nota en localStorage (síncrono,
// < 1 ms). Se borra cuando el fichero queda guardado en disco. Si la app
// muere antes, el siguiente arranque encuentra el borrador y lo guarda.

import type { NoteInput } from '../types';

const PREFIX = 'qn.draft.';

export interface Draft extends NoteInput {
  ts: number;
}

export class DraftJournal {
  put(note: NoteInput): void {
    const draft: Draft = { id: note.id, title: note.title, body: note.body, pinned: note.pinned, ts: Date.now() };
    try {
      localStorage.setItem(PREFIX + note.id, JSON.stringify(draft));
    } catch {
      /* almacenamiento lleno o no disponible: el autoguardado sigue funcionando */
    }
  }

  remove(id: string): void {
    try {
      localStorage.removeItem(PREFIX + id);
    } catch {
      /* ignorar */
    }
  }

  all(): Draft[] {
    const drafts: Draft[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        const draft = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
        if (draft?.id) drafts.push(draft);
      }
    } catch {
      /* ignorar */
    }
    return drafts;
  }
}
