// Mover la ventana arrastrando desde casi cualquier sitio.
//
//   · zonas sin interacción (márgenes, barras, cabeceras): arrastran al instante.
//   · elementos clicables (notas de la lista, buscador sin foco…): un clic se
//     comporta como siempre; si se mueve el ratón > 4 px con el botón pulsado,
//     se arrastra la ventana.
//   · título y contenido de la nota: nunca, ahí arrastrar selecciona texto.

const DRAG_THRESHOLD = 4;
/** Donde arrastrar debe seleccionar texto. */
const TEXT_AREAS = 'textarea, .editor-title, [contenteditable], .modal, .resize-handle';
/** Donde un clic hace algo; se arrastra solo si el ratón se mueve. */
const CLICKABLE = 'input, button, .item, .tag, a';

export function useWindowDrag(root: HTMLElement, startDragging: () => void): () => void {
  const onMouseDown = (e: MouseEvent) => {
    // Sin mirar defaultPrevented: la lista lo usa para no robar el foco al editor.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(TEXT_AREAS)) return;
    const clickable = target.closest<HTMLElement>(CLICKABLE);
    if (!clickable) {
      e.preventDefault();
      startDragging();
      return;
    }
    // Un campo en el que ya se está escribiendo usa el arrastre para seleccionar.
    if (clickable === document.activeElement && clickable.matches('input')) return;
    dragIfMoved(e, startDragging);
  };
  root.addEventListener('mousedown', onMouseDown);
  return () => root.removeEventListener('mousedown', onMouseDown);
}

function dragIfMoved(down: MouseEvent, startDragging: () => void): void {
  const onMove = (e: MouseEvent) => {
    if (Math.hypot(e.screenX - down.screenX, e.screenY - down.screenY) < DRAG_THRESHOLD) return;
    cleanup();
    window.getSelection()?.removeAllRanges();
    startDragging();
  };
  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', cleanup);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', cleanup);
}
