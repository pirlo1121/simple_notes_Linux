import type { Command } from '../commands/registry';
import type { NoteMeta } from '../types';
import { h, kbd } from '../utils/dom';
import { formatRelative } from '../utils/time';

export type ListItem =
  | { kind: 'header'; label: string }
  | { kind: 'note'; note: NoteMeta; hotkey?: string }
  | { kind: 'create'; title: string }
  | { kind: 'command'; command: Command; args: string }
  | { kind: 'tag'; tag: string; count: number }
  | { kind: 'empty'; label: string };

export const isSelectable = (item: ListItem) => item.kind !== 'header' && item.kind !== 'empty';

export class NoteList {
  readonly el: HTMLElement;

  constructor(private onPick: (index: number) => void) {
    this.el = h('nav', { class: 'list', role: 'listbox', tabindex: '-1' });
    this.el.addEventListener('mousedown', (e) => e.preventDefault()); // no robar el foco
    this.el.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (row) this.onPick(Number(row.dataset.index));
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
        const n = item.note;
        const active = n.id === activeId ? ' active' : '';
        return h(
          'div',
          { class: cls('item-note' + active), 'data-index': index, role: 'option', title: n.file },
          h(
            'span',
            { class: 'item-main' },
            h(
              'span',
              { class: 'item-title' },
              n.pinned ? h('span', { class: 'pin' }, '📌') : null,
              n.title,
            ),
            n.snippet ? h('span', { class: 'item-snippet' }, n.snippet) : null,
            n.tags.length ? h('span', { class: 'item-tags' }, n.tags.map((t) => `#${t}`).join(' ')) : null,
          ),
          h('span', { class: 'item-side' }, item.hotkey ? kbd(item.hotkey) : formatRelative(n.updated)),
        );
      }
    }
  }
}
