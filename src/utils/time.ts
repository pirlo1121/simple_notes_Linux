const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const dateYearFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

/** "hace 3 min", "ayer", "12 sept" */
export function formatRelative(ms: number, now = Date.now()): string {
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'ahora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 6) return rtf.format(Math.round(diff / 86400), 'day');
  const d = new Date(ms);
  return d.getFullYear() === new Date(now).getFullYear() ? dateFmt.format(d) : dateYearFmt.format(d);
}

export function formatFull(ms: number): string {
  return fullFmt.format(new Date(ms));
}

/** Título de la nota diaria: 2026-09-24 */
export function todayTitle(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
