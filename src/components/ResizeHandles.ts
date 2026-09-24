// Asas invisibles para redimensionar la ventana (no tiene bordes del sistema).
// WebKit ocupa toda la ventana y se queda los clics de los bordes, así que el
// redimensionado se inicia desde aquí y lo termina el gestor de ventanas.

import type { ResizeDirection } from '../services/backend';
import { h } from '../utils/dom';

const HANDLES: [string, ResizeDirection][] = [
  ['n', 'North'],
  ['s', 'South'],
  ['e', 'East'],
  ['w', 'West'],
  ['ne', 'NorthEast'],
  ['nw', 'NorthWest'],
  ['se', 'SouthEast'],
  ['sw', 'SouthWest'],
];

export class ResizeHandles {
  readonly el: HTMLElement;

  constructor(onResize: (direction: ResizeDirection) => void) {
    this.el = h('div', { class: 'resize-handles', 'aria-hidden': 'true' });
    for (const [edge, direction] of HANDLES) {
      const handle = h('div', { class: `resize-handle resize-${edge}` });
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onResize(direction);
      });
      this.el.append(handle);
    }
  }
}
