// Atajos de teclado: { 'ctrl+shift+p': handler }.
// Orden canónico de modificadores: ctrl, alt, shift.

export type HotkeyHandler = (e: KeyboardEvent) => void | false;
export type HotkeyMap = Record<string, HotkeyHandler>;

const MODS = ['ctrl', 'alt', 'shift'] as const;

function normalize(combo: string): string {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  return [...MODS.filter((m) => parts.includes(m)), key].join('+');
}

export function eventCombo(e: KeyboardEvent): string {
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  // Con Ctrl algunas distribuciones de teclado cambian e.key; e.code es estable.
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : ''];
  return [...mods.filter(Boolean), key].join('+');
}

/**
 * Registra atajos en `target`. Si el handler devuelve `false`, el evento
 * sigue su curso normal. Devuelve la función para desregistrar.
 */
export function useHotkeys(target: Window | HTMLElement, bindings: HotkeyMap): () => void {
  const map = new Map<string, HotkeyHandler>();
  for (const [combo, fn] of Object.entries(bindings)) {
    for (const alt of combo.split(',')) map.set(normalize(alt.trim()), fn);
  }
  const listener = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (e.defaultPrevented || e.isComposing) return;
    const fn = map.get(eventCombo(e));
    if (fn && fn(e) !== false) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
