import { h, kbd } from '../utils/dom';

export interface SearchBarOptions {
  onInput(query: string): void;
  /** Devuelve true si la tecla se ha gestionado. */
  onKey(e: KeyboardEvent): boolean;
  onFocusChange(focused: boolean): void;
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

export class SearchBar {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;

  constructor(opts: SearchBarOptions) {
    this.input = h('input', {
      class: 'search-input',
      type: 'text',
      placeholder: 'Buscar o crear nota…   / para comandos',
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': 'Buscar',
    });
    const icon = h('span', { class: 'search-icon', 'data-tauri-drag-region': true });
    icon.innerHTML = ICON;
    this.el = h(
      'header',
      { class: 'topbar', 'data-tauri-drag-region': true },
      icon,
      this.input,
      h('span', { class: 'topbar-hint', 'data-tauri-drag-region': true }, kbd('Ctrl K')),
    );

    this.input.addEventListener('input', () => opts.onInput(this.input.value));
    this.input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (opts.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.input.addEventListener('focus', () => opts.onFocusChange(true));
    this.input.addEventListener('blur', () => opts.onFocusChange(false));
  }

  get value(): string {
    return this.input.value;
  }

  set value(v: string) {
    this.input.value = v;
  }

  focus(selectAll = true): void {
    this.input.focus();
    if (selectAll) this.input.select();
    else this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  get focused(): boolean {
    return document.activeElement === this.input;
  }
}
