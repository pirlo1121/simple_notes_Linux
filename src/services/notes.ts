// Nota en edición + autoguardado.
//
// Cada cambio: (1) se apunta en el diario de borradores, (2) se programa un
// guardado a 400 ms (como máximo cada 2 s si se escribe sin parar). Los
// guardados se encadenan para que nunca se pisen entre sí.

import { useDebounce, type Debounced } from '../hooks/useDebounce';
import type { DraftJournal } from '../storage/drafts';
import type { NoteDoc, NoteInput, NoteMeta } from '../types';
import { Emitter } from '../utils/emitter';
import { newId } from '../utils/id';
import type { Backend } from './backend';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface EditableNote extends NoteInput {
  created: number;
  updated: number;
  /** Ya existe en disco. Las notas nuevas vacías nunca se escriben. */
  persisted: boolean;
  file: string;
}

const SAVE_DELAY = 400;
const SAVE_MAX_WAIT = 2000;
const RETRY_DELAY = 3000;

export class NotesService {
  current: EditableNote | null = null;
  status: SaveStatus = 'idle';
  lastEditAt = 0;

  readonly onStatus = new Emitter<SaveStatus>();
  readonly onSaved = new Emitter<NoteMeta>();

  private version = 0;
  private savedVersion = 0;
  private chain: Promise<void> = Promise.resolve();
  private saver: Debounced;

  constructor(
    private backend: Backend,
    private drafts: DraftJournal,
  ) {
    this.saver = useDebounce(() => void this.flush(), SAVE_DELAY, SAVE_MAX_WAIT);
  }

  open(doc: NoteDoc): void {
    void this.flush();
    this.current = {
      id: doc.id,
      title: doc.rawTitle,
      body: doc.body,
      pinned: doc.pinned,
      created: doc.created,
      updated: doc.updated,
      persisted: true,
      file: doc.file,
    };
    this.resetVersion('idle');
  }

  openBlank(title = ''): void {
    void this.flush();
    const now = Date.now();
    this.current = { id: newId(), title, body: '', pinned: false, created: now, updated: now, persisted: false, file: '' };
    this.resetVersion('idle');
    if (title) this.touch();
  }

  update(patch: Partial<Pick<NoteInput, 'title' | 'body' | 'pinned'>>): void {
    if (!this.current) return;
    Object.assign(this.current, patch);
    this.touch();
  }

  isEmpty(note: NoteInput | null = this.current): boolean {
    return !note || (!note.title.trim() && !note.body.trim());
  }

  get dirty(): boolean {
    return this.version !== this.savedVersion;
  }

  /** Guarda ya lo pendiente. Devuelve una promesa que se cumple al terminar. */
  flush(): Promise<void> {
    this.saver.cancel();
    const note = this.current;
    if (!note || !this.dirty) return this.chain;

    if (!note.persisted && this.isEmpty(note)) {
      this.savedVersion = this.version;
      this.drafts.remove(note.id);
      this.setStatus('idle');
      return this.chain;
    }

    const version = this.version;
    const input: NoteInput = { id: note.id, title: note.title, body: note.body, pinned: note.pinned };
    this.setStatus('saving');

    this.chain = this.chain.then(async () => {
      const stillCurrent = () => this.current?.id === input.id;
      try {
        const meta = await this.backend.saveNote(input);
        if (stillCurrent() && this.current) {
          this.current.persisted = true;
          this.current.updated = meta.updated;
          this.current.file = meta.file;
          this.savedVersion = Math.max(this.savedVersion, version);
        }
        // Si se siguió escribiendo durante el guardado, el borrador sigue siendo necesario.
        if (!stillCurrent() || this.version === version) this.drafts.remove(input.id);
        this.onSaved.emit(meta);
        if (stillCurrent()) this.setStatus(this.dirty ? 'dirty' : 'saved');
      } catch (e) {
        console.error('save', e);
        if (stillCurrent()) {
          this.setStatus('error');
          setTimeout(() => this.dirty && void this.flush(), RETRY_DELAY);
        }
      }
    });
    return this.chain;
  }

  /**
   * Tras un cierre inesperado: guarda los borradores que no llegaron a disco.
   * Devuelve cuántas notas se recuperaron.
   */
  async recoverDrafts(): Promise<number> {
    let recovered = 0;
    for (const draft of this.drafts.all()) {
      try {
        const existing = await this.backend.getNote(draft.id);
        const unchanged =
          existing && existing.rawTitle === draft.title && existing.body === draft.body && existing.pinned === draft.pinned;
        if (unchanged || (!existing && this.isEmpty(draft))) {
          this.drafts.remove(draft.id);
          continue;
        }
        await this.backend.saveNote({ id: draft.id, title: draft.title, body: draft.body, pinned: draft.pinned });
        this.drafts.remove(draft.id);
        recovered++;
      } catch (e) {
        console.error('recover', e);
      }
    }
    return recovered;
  }

  private touch(): void {
    if (!this.current) return;
    this.version++;
    this.lastEditAt = Date.now();
    this.drafts.put(this.current);
    this.setStatus('dirty');
    this.saver();
  }

  // El contador de versión nunca retrocede: un guardado antiguo que termine
  // tarde no puede marcar como guardada una edición posterior.
  private resetVersion(status: SaveStatus): void {
    this.savedVersion = this.version;
    this.setStatus(status);
  }

  private setStatus(status: SaveStatus): void {
    this.status = status;
    this.onStatus.emit(status);
  }
}
