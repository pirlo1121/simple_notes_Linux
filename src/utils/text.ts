export const UNTITLED = 'Sin título';

/** Primera línea con texto, sin marcas de Markdown. Igual que note.rs. */
export function deriveTitle(body: string): string {
  for (const line of body.split('\n')) {
    let t = line.trim().replace(/^[#>]+/, '').trim();
    for (const marker of ['- [ ] ', '- [x] ', '- ', '* ', '+ ']) {
      if (t.startsWith(marker)) {
        t = t.slice(marker.length).trim();
        break;
      }
    }
    if (t) return truncate(t, 80);
  }
  return '';
}

export function displayTitle(title: string, body: string): string {
  return title.trim() || deriveTitle(body) || UNTITLED;
}

export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() + '…' : s;
}

export function wordCount(s: string): number {
  const m = s.match(/\S+/g);
  return m ? m.length : 0;
}
