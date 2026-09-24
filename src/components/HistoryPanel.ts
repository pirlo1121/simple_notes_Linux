import type { HistoryEntry } from '../types';
import { h, kbd } from '../utils/dom';
import { formatFull, formatRelative } from '../utils/time';
import { Modal } from './Modal';

export interface HistorySource {
  title: string;
  entries: HistoryEntry[];
  load(stamp: number): Promise<string>;
  restore(stamp: number): void;
}

export class HistoryPanel extends Modal {
  private source: HistorySource | null = null;
  private selected = 0;
  private list = h('div', { class: 'history-list' });
  private preview = h('pre', { class: 'history-preview' });
  private heading = h('div', { class: 'modal-title' });
  private loadSeq = 0;

  constructor() {
    super('history');
    this.panel.append(
      this.heading,
      h('div', { class: 'history-body' }, this.list, this.preview),
      h('div', { class: 'modal-footer' }, kbd('↑↓'), ' navegar  ', kbd('↵'), ' restaurar esta versión  ', kbd('Esc'), ' cerrar'),
    );
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (!row) return;
      this.select(Number(row.dataset.index));
    });
    this.list.addEventListener('dblclick', () => this.restore());
  }

  open(source: HistorySource): void {
    this.source = source;
    this.heading.textContent = `Historial · ${source.title}`;
    this.show();
    this.select(0);
  }

  handleKey(e: KeyboardEvent): boolean {
    if (super.handleKey(e)) return true;
    const count = this.source?.entries.length ?? 0;
    if (e.key === 'ArrowDown') this.select(Math.min(this.selected + 1, count - 1));
    else if (e.key === 'ArrowUp') this.select(Math.max(this.selected - 1, 0));
    else if (e.key === 'Enter') this.restore();
    else return false;
    return true;
  }

  private restore(): void {
    const entry = this.source?.entries[this.selected];
    if (!entry || !this.source) return;
    this.close();
    this.source.restore(entry.stamp);
  }

  private select(index: number): void {
    const entries = this.source?.entries ?? [];
    this.selected = Math.max(0, index);
    this.list.replaceChildren(
      ...(entries.length
        ? entries.map((entry, i) =>
            h(
              'div',
              { class: `item${i === this.selected ? ' selected' : ''}`, 'data-index': i, title: formatFull(entry.stamp) },
              h('span', { class: 'item-title' }, formatRelative(entry.stamp)),
              h('span', { class: 'item-snippet' }, entry.preview || '(vacía)'),
            ),
          )
        : [h('div', { class: 'list-empty' }, 'Todavía no hay versiones anteriores. Se guarda una cada 5 minutos de edición.')]),
    );
    this.list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    const entry = entries[this.selected];
    this.preview.textContent = '';
    if (!entry || !this.source) return;
    const seq = ++this.loadSeq;
    this.source
      .load(entry.stamp)
      .then((text) => seq === this.loadSeq && (this.preview.textContent = text))
      .catch(() => (this.preview.textContent = 'No se pudo leer esta versión.'));
  }
}
