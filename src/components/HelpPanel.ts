import { h, kbd } from '../utils/dom';
import { Modal } from './Modal';

const SHORTCUTS: [string, string][] = [
  ['Ctrl Espacio', 'Mostrar / ocultar QuickNotes (global)'],
  ['Ctrl N', 'Nueva nota'],
  ['Ctrl K · Ctrl P', 'Buscar notas'],
  ['Ctrl ⇧ P', 'Paleta de comandos'],
  ['Ctrl Tab', 'Volver a la nota anterior'],
  ['Ctrl E', 'Notas recientes'],
  ['Ctrl 1…9', 'Abrir nota fijada'],
  ['Ctrl D', 'Fijar / desfijar'],
  ['Ctrl T', 'Nota de hoy'],
  ['Ctrl H', 'Historial de cambios'],
  ['Ctrl ⇧ ⌫', 'Eliminar nota (se puede deshacer)'],
  ['Ctrl B', 'Mostrar / ocultar la lista'],
  ['Esc · Ctrl W', 'Ocultar ventana (todo queda guardado)'],
  ['Ctrl Q', 'Salir del todo'],
];

const SEARCH_TIPS: [string, string][] = [
  ['mongo índices', 'Notas que contienen ambas palabras'],
  ['#backend', 'Filtra por etiqueta'],
  ['/', 'Comandos: /new /search /pin /delete /today …'],
  ['↵ sin resultados', 'Crea una nota con ese título'],
];

export class HelpPanel extends Modal {
  private dir = h('code', {});

  constructor(private notesDir: () => string) {
    super('help');
    const table = (rows: [string, string][]) =>
      h('div', { class: 'help-grid' }, ...rows.flatMap(([k, v]) => [h('span', {}, kbd(k)), h('span', {}, v)]));
    this.panel.append(
      h('div', { class: 'modal-title' }, 'Atajos de teclado'),
      table(SHORTCUTS),
      h('div', { class: 'modal-title' }, 'Búsqueda'),
      table(SEARCH_TIPS),
      h('div', { class: 'modal-footer' }, 'Notas en ', this.dir, ' · guardado automático · ', kbd('Esc'), ' cerrar'),
    );
  }

  open(): void {
    this.dir.textContent = this.notesDir();
    this.show();
  }
}
