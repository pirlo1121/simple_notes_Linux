import { h } from '../utils/dom';

export interface ToastAction {
  label: string;
  run(): void;
}

export class Toast {
  readonly el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string, action?: ToastAction, duration = 4000): void {
    clearTimeout(this.timer);
    const children: Node[] = [h('span', {}, message)];
    if (action) {
      const btn = h('button', { type: 'button' }, action.label);
      btn.addEventListener('click', () => {
        this.hide();
        action.run();
      });
      children.push(btn);
    }
    this.el.replaceChildren(...children);
    this.el.classList.add('visible');
    this.timer = setTimeout(() => this.hide(), duration);
  }

  hide(): void {
    this.el.classList.remove('visible');
  }
}
