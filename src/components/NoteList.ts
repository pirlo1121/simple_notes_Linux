import type { Command } from '../commands/registry';
import type { NoteMeta } from '../types';
import { h, kbd } from '../utils/dom';

export type ListItem =
  | { kind: 'header'; label: string }
  /** `number`: posición fija de la nota; se abre con Ctrl + número (1–9). */
  | { kind: 'note'; note: NoteMeta; number?: number }
  | { kind: 'create'; title: string }
  | { kind: 'command'; command: Command; args: string }
  | { kind: 'tag'; tag: string; count: number }
  | { kind: 'empty'; label: string };

export const isSelectable = (item: ListItem) => item.kind !== 'header' && item.kind !== 'empty';

const TRASH_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

export class NoteList {
  readonly el: HTMLElement;

  constructor(
    private onPick: (index: number) => void,
    private onDelete: (noteId: string) => void,
  ) {
    this.el = h('nav', { class: 'list', role: 'listbox', tabindex: '-1' });
    this.el.addEventListener('mousedown', (e) => e.preventDefault()); // no robar el foco
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const row = target.closest<HTMLElement>('[data-index]');
      if (!row) return;
      if (target.closest('.item-delete') && row.dataset.id) this.onDelete(row.dataset.id);
      else this.onPick(Number(row.dataset.index));
    });
  }

  render(items: ListItem[], selected: number, activeId: string | null): void {
    const frag = document.createDocumentFragment();
    items.forEach((item, i) => frag.append(this.row(item, i, i === selected, activeId)));
    this.el.replaceChildren(frag);
    this.el.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private row(item: ListItem, index: number, selected: boolean, activeId: string | null): HTMLElement {
    const cls = (extra: string) => `item ${extra}${selected ? ' selected' : ''}`;
    switch (item.kind) {
      case 'header':
        return h('div', { class: 'list-header' }, item.label);
      case 'empty':
        return h('div', { class: 'list-empty' }, item.label);
      case 'create':
        return h(
          'div',
          { class: cls('item-create'), 'data-index': index, role: 'option' },
          h('span', { class: 'item-icon' }, '+'),
          h('span', { class: 'item-title' }, 'Crear ', h('strong', {}, `«${item.title}»`)),
          kbd('↵'),
        );
      case 'command':
        return h(
          'div',
          { class: cls('item-command'), 'data-index': index, role: 'option' },
          h('span', { class: 'item-icon' }, '/'),
          h(
            'span',
            { class: 'item-main' },
            h('span', { class: 'item-title' }, item.command.name, item.command.args ? h('em', {}, ` ${item.command.args}`) : null),
            h('span', { class: 'item-snippet' }, item.command.title),
          ),
          item.command.shortcut ? kbd(item.command.shortcut) : null,
        );
      case 'tag':
        return h(
          'div',
          { class: cls('item-tag'), 'data-index': index, role: 'option' },
          h('span', { class: 'item-icon' }, '#'),
          h('span', { class: 'item-title' }, item.tag),
          h('span', { class: 'item-count' }, String(item.count)),
        );
      case 'note': {
        // Una sola línea: número de atajo, chincheta y título.
        const n = item.note;
        const active = n.id === activeId ? ' active' : '';
        const hint = item.number ? `Ctrl ${item.number} · ${n.file}` : n.file;
        const trash = h('button', { class: 'item-delete', type: 'button', title: 'Eliminar nota (se puede deshacer)' });
        trash.innerHTML = TRASH_ICON;
        return h(
          'div',
          { class: cls('item-note' + active), 'data-index': index, 'data-id': n.id, role: 'option', title: hint },
          h('span', { class: 'item-num' }, item.number ? String(item.number) : ''),
          h('span', { class: 'item-title' }, n.pinned ? h('span', { class: 'pin' }, '📌') : null, n.title),
          trash,
        );
      }
    }
  }
}
