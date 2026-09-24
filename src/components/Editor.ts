// Editor: título + contenido Markdown en texto plano.
// Un <textarea> es lo más rápido que existe para escribir: sin reflujo de
// HTML, con deshacer nativo y sin sorpresas al copiar/pegar.

import type { EditableNote } from '../services/notes';
import { h } from '../utils/dom';
import { extractTags } from '../utils/tags';
import { deriveTitle } from '../utils/text';

export interface EditorOptions {
  onChange(patch: { title?: string; body?: string }): void;
  onTagClick(tag: string): void;
  onEscapeTitle(): void;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;

export class Editor {
  readonly el: HTMLElement;
  private title: HTMLInputElement;
  private body: HTMLTextAreaElement;
  private tags: HTMLElement;
  private noteId: string | null = null;
  private selections = new Map<string, [number, number, number]>();
  private tagsFrame = 0;

  constructor(private opts: EditorOptions) {
    this.title = h('input', { class: 'editor-title', type: 'text', spellcheck: 'false', 'aria-label': 'Título' });
    this.tags = h('div', { class: 'editor-tags' });
    this.body = h('textarea', {
      class: 'editor-body',
      spellcheck: 'false',
      placeholder: 'Escribe… la primera línea es el título. Usa #etiquetas para organizar.',
      'aria-label': 'Contenido',
    });
    this.el = h('section', { class: 'editor' }, this.title, this.tags, this.body);

    this.title.addEventListener('input', () => {
      this.opts.onChange({ title: this.title.value });
      this.scheduleTags();
    });
    this.body.addEventListener('input', () => {
      this.opts.onChange({ body: this.body.value });
      this.updatePlaceholder();
      this.scheduleTags();
    });
    this.title.addEventListener('keydown', (e) => this.onTitleKey(e));
    this.body.addEventListener('keydown', (e) => this.onBodyKey(e));
    this.tags.addEventListener('mousedown', (e) => e.preventDefault());
    this.tags.addEventListener('click', (e) => {
      const tag = (e.target as HTMLElement).dataset.tag;
      if (tag) this.opts.onTagClick(tag);
    });
  }

  load(note: EditableNote): void {
    this.rememberSelection();
    this.noteId = note.id;
    this.title.value = note.title;
    this.body.value = note.body;
    this.updatePlaceholder();
    this.renderTags();
    const sel = this.selections.get(note.id);
    if (sel) {
      this.body.setSelectionRange(sel[0], sel[1]);
      this.body.scrollTop = sel[2];
    } else {
      this.body.setSelectionRange(note.body.length, note.body.length);
      this.body.scrollTop = 0;
    }
  }

  focusBody(): void {
    this.body.focus({ preventScroll: true });
  }

  focusTitle(): void {
    this.title.focus();
  }

  get focused(): boolean {
    return document.activeElement === this.body || document.activeElement === this.title;
  }

  get text(): string {
    return this.body.value;
  }

  private rememberSelection(): void {
    if (this.noteId) {
      this.selections.set(this.noteId, [this.body.selectionStart, this.body.selectionEnd, this.body.scrollTop]);
    }
  }

  private updatePlaceholder(): void {
    this.title.placeholder = deriveTitle(this.body.value) || 'Título';
  }

  private scheduleTags(): void {
    cancelAnimationFrame(this.tagsFrame);
    this.tagsFrame = requestAnimationFrame(() => this.renderTags());
  }

  private renderTags(): void {
    const tags = extractTags(this.title.value, this.body.value);
    this.tags.replaceChildren(...tags.map((t) => h('span', { class: 'tag', 'data-tag': t, title: `Buscar #${t}` }, `#${t}`)));
  }

  private onTitleKey(e: KeyboardEvent): void {
    const atEnd = this.title.selectionStart === this.title.value.length;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) {
      e.preventDefault();
      this.body.focus();
      this.body.setSelectionRange(0, 0);
    } else if (e.key === 'Escape' && this.title.value === '' && document.activeElement === this.title) {
      // Sin título: Esc vuelve al contenido en lugar de ocultar la ventana.
      e.preventDefault();
      e.stopPropagation();
      this.opts.onEscapeTitle();
    }
  }

  private onBodyKey(e: KeyboardEvent): void {
    if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    const ta = this.body;
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      e.preventDefault();
      this.title.focus();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) this.outdent();
      else insertText('  ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      this.continueList(e);
    }
  }

  /** Enter en una lista continúa la viñeta; en una viñeta vacía la termina. */
  private continueList(e: KeyboardEvent): void {
    const ta = this.body;
    const pos = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
    const line = ta.value.slice(lineStart, pos);
    const m = LIST_ITEM.exec(line);
    if (!m) return;
    e.preventDefault();
    if (line.length === m[0].length) {
      ta.setSelectionRange(lineStart, pos);
      insertText('');
      return;
    }
    const [, indent, bullet, checkbox] = m;
    const num = /^(\d+)([.)])$/.exec(bullet);
    const next = num ? `${Number(num[1]) + 1}${num[2]}` : bullet;
    insertText(`\n${indent}${next} ${checkbox ? '[ ] ' : ''}`);
  }

  private outdent(): void {
    const ta = this.body;
    const pos = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
    const spaces = /^ {1,2}/.exec(ta.value.slice(lineStart))?.[0].length ?? 0;
    if (!spaces) return;
    ta.setSelectionRange(lineStart, lineStart + spaces);
    insertText('');
    ta.setSelectionRange(pos - spaces, pos - spaces);
  }
}

/** Inserta texto conservando el historial de deshacer del navegador. */
function insertText(text: string): void {
  if (text) document.execCommand('insertText', false, text);
  else document.execCommand('delete');
}
