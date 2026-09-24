// Capa modal ligera. La app le pasa las teclas mientras está abierta.

import { h } from '../utils/dom';

export abstract class Modal {
  readonly el: HTMLElement;
  protected panel: HTMLElement;
  private previousFocus: Element | null = null;

  constructor(className: string) {
    this.panel = h('div', { class: `modal-panel ${className}`, role: 'dialog' });
    this.el = h('div', { class: 'modal', hidden: true }, this.panel);
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  protected show(): void {
    this.previousFocus = document.activeElement;
    this.el.hidden = false;
    this.panel.tabIndex = -1;
    this.panel.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    (this.previousFocus as HTMLElement | null)?.focus?.();
  }

  /** Devuelve true si la tecla se ha gestionado. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.close();
      return true;
    }
    return false;
  }
}
