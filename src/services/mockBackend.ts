// Backend en memoria para desarrollar la interfaz en un navegador normal.
// No se incluye en el paquete de Tauri (import dinámico).

import type { HistoryEntry, NoteDoc, NoteInput, NoteMeta, PersistedState } from '../types';
import { extractTags } from '../utils/tags';
import { deriveTitle, displayTitle, truncate } from '../utils/text';
import type { Backend } from './backend';

const KEY = 'qn.mock.notes';

interface MockNote extends NoteInput {
  created: number;
  updated: number;
  history: { stamp: number; title: string; body: string }[];
}

export function createMockBackend(): Backend {
  const notes = new Map<string, MockNote>(Object.entries(JSON.parse(localStorage.getItem(KEY) ?? '{}')));
  let state: PersistedState | null = null;
  const persist = () => localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(notes)));

  if (notes.size === 0) seed(notes);

  const meta = (n: MockNote): NoteMeta => {
    const lines = n.body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!n.title) lines.shift();
    return {
      id: n.id,
      title: displayTitle(n.title, n.body),
      pinned: n.pinned,
      tags: extractTags(n.title, n.body),
      created: n.created,
      updated: n.updated,
      snippet: truncate(lines.slice(0, 4).join('  '), 140),
      file: `${(n.title || deriveTitle(n.body) || 'nota').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}.md`,
    };
  };
  const doc = (n: MockNote): NoteDoc => ({ ...meta(n), rawTitle: n.title, body: n.body });
  const sorted = () =>
    [...notes.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
  const trash = new Map<string, MockNote>();

  return {
    async listNotes() {
      return sorted().map(meta);
    },
    async search(query, limit = 200) {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const tags = tokens.filter((t) => t.startsWith('#') && t.length > 1).map((t) => t.slice(1));
      const terms = tokens.filter((t) => !t.startsWith('#'));
      return sorted()
        .filter((n) => {
          const m = meta(n);
          const hay = `${m.title}\n${n.body}`.toLowerCase();
          return tags.every((t) => m.tags.some((x) => x.startsWith(t))) && terms.every((t) => hay.includes(t));
        })
        .slice(0, limit)
        .map(meta);
    },
    async getNote(id) {
      const n = notes.get(id);
      return n ? doc(n) : null;
    },
    async saveNote(input, snapshot = false) {
      const now = Date.now();
      const prev = notes.get(input.id);
      if (prev && (snapshot || !prev.history.length || now - prev.history[0].stamp > 5 * 60_000)) {
        prev.history.unshift({ stamp: now, title: prev.title, body: prev.body });
      }
      const n: MockNote = { ...input, created: prev?.created ?? now, updated: now, history: prev?.history ?? [] };
      notes.set(n.id, n);
      persist();
      return meta(n);
    },
    async setPinned(id, pinned) {
      const n = notes.get(id);
      if (!n) throw new Error('nota no encontrada');
      n.pinned = pinned;
      persist();
      return meta(n);
    },
    async deleteNote(id) {
      const n = notes.get(id);
      if (n) trash.set(id, n);
      notes.delete(id);
      persist();
    },
    async restoreNote(id) {
      const n = trash.get(id);
      if (!n) throw new Error('nota no encontrada');
      notes.set(id, n);
      persist();
      return meta(n);
    },
    async syncDisk() {
      return false;
    },
    async listHistory(id): Promise<HistoryEntry[]> {
      return (notes.get(id)?.history ?? []).map((h) => ({
        stamp: h.stamp,
        size: h.body.length,
        preview: truncate(h.body.replace(/\s+/g, ' '), 120),
      }));
    },
    async readHistory(id, stamp) {
      const n = notes.get(id);
      const h = n?.history.find((x) => x.stamp === stamp);
      if (!n || !h) throw new Error('versión no encontrada');
      return doc({ ...n, title: h.title, body: h.body });
    },
    async readState() {
      return state;
    },
    async writeState(s) {
      state = s;
    },
    async notesDir() {
      return '~/.quicknotes (simulado)';
    },
    async openFolder() {},
    async getAutostart() {
      return false;
    },
    async setAutostart(enabled) {
      return enabled;
    },
    async shortcutStatus() {
      return { accelerator: 'ctrl+space', registered: true, wayland: false, error: null };
    },
    async hideWindow() {
      console.info('[mock] ocultar ventana');
    },
    async quit() {
      console.info('[mock] salir');
    },
    async on() {
      return () => {};
    },
  };
}

function seed(notes: Map<string, MockNote>): void {
  const now = Date.now();
  const add = (id: string, title: string, body: string, pinned = false, ago = 0) =>
    notes.set(id, { id, title, body, pinned, created: now - ago - 86400_000, updated: now - ago, history: [] });
  add('seed-tareas', 'Tareas', '- [ ] Revisar PR del índice #backend\n- [x] Actualizar Debian\n- [ ] Escribir notas de la charla #ideas', true, 3600_000);
  add('seed-linux', 'Comandos Linux', '```sh\njournalctl -u nginx -f\nss -tulpn\n```\nListar puertos abiertos y seguir logs. #linux', true, 7200_000);
  add('seed-mongo', '', 'MongoDB: índices compuestos\nEl orden de los campos importa: igualdad, orden, rango. #backend #mongodb', false, 600_000);
  add('seed-idea', '', 'Idea: CLI para exportar notas a HTML estático #ideas', false, 86400_000 * 3);
}
