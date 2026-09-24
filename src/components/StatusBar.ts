import type { SaveStatus } from '../services/notes';
import { h, kbd } from '../utils/dom';
import { formatFull, formatRelative } from '../utils/time';

const LABELS: Record<SaveStatus, string> = {
  idle: 'Listo',
  dirty: 'Editando…',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'Error al guardar — reintentando',
};

export interface StatusInfo {
  status: SaveStatus;
  file: string;
  created: number | null;
  updated: number | null;
  words: number;
}

export class StatusBar {
  readonly el: HTMLElement;
  private state: HTMLElement;
  private meta: HTMLElement;
  private words: HTMLElement;

  constructor(onHelp: () => void) {
    // data-tauri-drag-region en cada hijo: la zona de arrastre no se hereda.
    const drag = { 'data-tauri-drag-region': true };
    this.state = h('span', { class: 'status-state', ...drag });
    this.meta = h('span', { class: 'status-meta', ...drag });
    this.words = h('span', { class: 'status-words', ...drag });
    const help = h('button', { class: 'status-help', type: 'button', title: 'Atajos (F1)' }, kbd('Ctrl ⇧ P'));
    help.addEventListener('click', onHelp);
    this.el = h('footer', { class: 'statusbar', ...drag }, this.state, this.meta, h('span', { class: 'spacer', ...drag }), this.words, help);
  }

  render(info: StatusInfo): void {
    this.state.dataset.status = info.status;
    this.state.textContent = LABELS[info.status];
    const parts: string[] = [];
    if (info.file) parts.push(info.file);
    if (info.updated) parts.push(`editada ${formatRelative(info.updated)}`);
    this.meta.textContent = parts.join(' · ');
    this.meta.title = info.created ? `Creada: ${formatFull(info.created)}\nModificada: ${formatFull(info.updated ?? info.created)}` : '';
    this.words.textContent = info.words ? `${info.words} ${info.words === 1 ? 'palabra' : 'palabras'}` : '';
  }
}
