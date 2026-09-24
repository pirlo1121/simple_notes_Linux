// Detección de etiquetas. Equivalente a src-tauri/src/tags.rs.

const BOUNDARY = /[\s([{,;:!¡¿?"']/u;
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;

export function extractTags(title: string, body: string): string[] {
  const out = new Set<string>();
  scanLine(title, out);
  let inFence = false;
  for (const line of body.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('```') || t.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) scanLine(line, out);
  }
  return [...out].sort();
}

function scanLine(line: string, out: Set<string>): void {
  const chars = Array.from(line);
  let inCode = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '`') {
      inCode = !inCode;
      continue;
    }
    if (inCode || c !== '#' || (i > 0 && !BOUNDARY.test(chars[i - 1]))) continue;
    let j = i + 1;
    while (j < chars.length && TAG_CHAR.test(chars[j])) j++;
    let end = j;
    while (end > i + 1 && (chars[end - 1] === '-' || chars[end - 1] === '/')) end--;
    if (end > i + 1) {
      const tag = chars.slice(i + 1, end).join('');
      if (isTag(tag)) out.add(tag.toLowerCase());
    }
    i = j - 1;
  }
}

function isTag(tag: string): boolean {
  if (!/\p{L}/u.test(tag)) return false;
  const hexColor = [3, 4, 6, 8].includes(tag.length) && /^[0-9a-f]+$/i.test(tag) && /\d/.test(tag);
  return !hexColor;
}
