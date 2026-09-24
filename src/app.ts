// Orquestador: conecta componentes, servicios y comandos.
//
// Panel lateral, pegado al borde derecho de la pantalla:
//
//   ┌ SearchBar ─────────────┐
//   │ Editor (nota actual)   │
//   ├────────────────────────┤
//   │ NoteList (las demás,   │
//   │ resultados, comandos)  │
//   └ StatusBar ─────────────┘

import { builtinCommands } from './commands/builtin';
import { CommandRegistry, type CommandContext } from './commands/registry';
import { Editor } from './components/Editor';
import { HelpPanel } from './components/HelpPanel';
import { HistoryPanel } from './components/HistoryPanel';
import type { Modal } from './components/Modal';
import { isSelectable, NoteList, type ListItem } from './components/NoteList';
import { ResizeHandles } from './components/ResizeHandles';
import { SearchBar } from './components/SearchBar';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/Toast';
import { createStore, type Store } from './hooks/createStore';
import { useDebounce } from './hooks/useDebounce';
import { useHotkeys } from './hooks/useHotkeys';
import { useWindowDrag } from './hooks/useWindowDrag';
import type { Backend } from './services/backend';
import type { NotesService } from './services/notes';
import type { AppStateStore } from './storage/appState';
import type { NoteMeta } from './types';
import { h } from './utils/dom';
import { displayTitle, wordCount } from './utils/text';
import { todayTitle } from './utils/time';

const LIST_LIMIT = 300;

interface UIState {
  query: string;
  items: ListItem[];
  selected: number;
  sidebar: boolean;
  searchFocused: boolean;
  recentOnly: boolean;
}

export class App implements CommandContext {
  private index = new Map<string, NoteMeta>();
  private commands = new CommandRegistry().register(...builtinCommands);
  private ui: Store<UIState>;
  private root!: HTMLElement;
  private search!: SearchBar;
  private list!: NoteList;
  private editor!: Editor;
  private status!: StatusBar;
  private toast = new Toast();
  private history = new HistoryPanel();
  private help = new HelpPanel(() => this.notesDir);
  private notesDir = '~/.quicknotes';
  private searchSeq = 0;
  private statusFrame = 0;
  private refreshSoon = useDebounce(() => void this.runQuery(false), 120);

  constructor(
    private backend: Backend,
    private notes: NotesService,
    private state: AppStateStore,
  ) {
    this.ui = createStore<UIState>({
      query: '',
      items: [],
      selected: -1,
      sidebar: state.get('sidebar') ?? true,
      searchFocused: false,
      recentOnly: false,
    });
  }

  // ── Arranque ────────────────────────────────────────────────────────────

  mount(host: HTMLElement): void {
    this.search = new SearchBar({
      onInput: (q) => this.setQuery(q, false),
      onKey: (e) => this.onSearchKey(e),
      onFocusChange: (focused) => this.ui.set({ searchFocused: focused }),
    });
    this.list = new NoteList((i) => this.pick(i));
    this.editor = new Editor({
      onChange: (patch) => {
        this.notes.update(patch);
        this.scheduleStatus();
      },
      onTagClick: (tag) => this.focusSearch(`#${tag} `),
      onEscapeTitle: () => this.editor.focusBody(),
    });
    this.status = new StatusBar(() => this.showHelp());

    this.root = h(
      'div',
      { class: 'app' },
      this.search.el,
      h('main', { class: 'main' }, this.editor.el, this.list.el),
      this.status.el,
      this.toast.el,
      this.history.el,
      this.help.el,
      new ResizeHandles((direction) => void this.backend.startResize(direction)).el,
    );
    host.replaceChildren(this.root);

    this.ui.select((s) => s.items, () => this.renderList());
    this.ui.select((s) => s.selected, () => this.renderList());
    this.ui.select((s) => `${s.sidebar}|${s.searchFocused}|${s.query !== ''}`, () => this.renderLayout());
    this.notes.onStatus.on(() => this.renderStatus());
    this.notes.onSaved.on((meta) => this.onSaved(meta));

    this.bindKeys();
    useWindowDrag(this.root, () => void this.backend.startDragging());
    this.renderLayout();
  }

  async start(): Promise<void> {
    const [metas, shortcut, dir] = await Promise.all([
      this.backend.listNotes(),
      this.backend.shortcutStatus().catch(() => null),
      this.backend.notesDir().catch(() => this.notesDir),
    ]);
    this.notesDir = dir;
    for (const m of metas) this.index.set(m.id, m);

    await this.openLastNote();

    this.backend.on('summoned', () => void this.onSummoned());
    this.backend.on('hiding', () => {
      void this.discardEmptyNote();
      this.flushAll();
    });
    this.backend.on('quit', () => this.quit());
    this.backend.on('placement', (docked) => this.root.classList.toggle('floating', docked === false));
    window.addEventListener('blur', () => this.flushAll());
    window.addEventListener('beforeunload', () => this.flushAll());

    await this.firstRunSetup(shortcut?.registered ?? true, shortcut?.wayland ?? false);
  }

  private async firstRunSetup(shortcutOk: boolean, wayland: boolean): Promise<void> {
    if (!this.state.get('autostartInitialized')) {
      this.state.set('autostartInitialized', true);
      try {
        await this.backend.setAutostart(true);
        this.toast.show('Inicio automático activado: Ctrl+Espacio funcionará siempre. /autostart para cambiarlo.', undefined, 6000);
      } catch (e) {
        console.error('autostart', e);
      }
    }
    if ((!shortcutOk || wayland) && !this.state.get('shortcutHintShown')) {
      this.state.set('shortcutHintShown', true);
      this.toast.show(
        'Ctrl+Espacio no está disponible para la app. Ejecuta: sh /usr/share/quicknotes/setup-shortcut.sh',
        undefined,
        10000,
      );
    }
  }

  recovered(count: number): void {
    if (count) this.toast.show(`Recuperado${count > 1 ? 's' : ''} ${count} cambio${count > 1 ? 's' : ''} sin guardar tras un cierre inesperado`);
  }

  // ── Eventos de ventana ──────────────────────────────────────────────────

  private async onSummoned(): Promise<void> {
    this.history.close();
    this.help.close();
    // Se sigue en la nota abierta: siempre es la última que se usó.
    if (this.ui.get().query) this.setQuery('');
    this.editor.focusBody();
    try {
      if (await this.backend.syncDisk()) await this.reloadFromDisk();
    } catch (e) {
      console.error('sync', e);
    }
  }

  /** Aplica cambios hechos por otros programas en ~/.quicknotes. */
  private async reloadFromDisk(): Promise<void> {
    const metas = await this.backend.listNotes();
    this.index = new Map(metas.map((m) => [m.id, m]));
    const cur = this.notes.current;
    if (cur?.persisted && !this.notes.dirty) {
      const doc = await this.backend.getNote(cur.id);
      if (!doc) this.newNote();
      else if (doc.body !== cur.body || doc.rawTitle !== cur.title || doc.pinned !== cur.pinned) {
        this.notes.open(doc);
        this.editor.load(this.notes.current!);
      }
    }
    void this.runQuery(false);
    this.renderStatus();
  }

  private onSaved(meta: NoteMeta): void {
    const isNew = !this.index.has(meta.id);
    this.index.set(meta.id, meta);
    if (isNew && this.notes.current?.id === meta.id) this.state.touchRecent(meta.id);
    this.refreshSoon();
    this.renderStatus();
  }

  /** Al salir de una nota que se quedó vacía: quitarla de la lista y del disco. */
  private discardEmptyNote(): Promise<void> {
    return this.notes.discardIfEmpty().then((id) => {
      if (!id) return;
      this.index.delete(id);
      this.state.forget(id);
      void this.runQuery(false);
    });
  }

  private flushAll(): void {
    void this.notes.flush();
    this.state.flush();
  }

  // ── Búsqueda y lista ────────────────────────────────────────────────────

  private setQuery(query: string, updateInput = true): void {
    if (updateInput) this.search.value = query;
    this.ui.set({ query, recentOnly: false });
    void this.runQuery();
  }

  /** Recalcula la lista según la consulta. `resetSelection` = volver al primero. */
  private async runQuery(resetSelection = true): Promise<void> {
    const { query, recentOnly } = this.ui.get();
    const q = query.trim();
    const seq = ++this.searchSeq;
    let items: ListItem[];

    if (q.startsWith('/')) {
      const matches = this.commands.match(q);
      items = matches.length
        ? matches.map(({ command, args }) => ({ kind: 'command', command, args }))
        : [{ kind: 'empty', label: 'Ningún comando coincide' }];
    } else if (/^#\S*$/.test(q)) {
      items = this.tagItems(q.slice(1).toLowerCase());
    } else if (!q) {
      items = recentOnly ? this.recentItems() : this.defaultItems();
    } else {
      const results = await this.backend.search(q, 200);
      if (seq !== this.searchSeq) return; // llegó una consulta más nueva
      const numbers = this.numbers();
      items = results.map((note) => ({ kind: 'note', note, number: numbers.get(note.id) }));
      const exact = results.some((n) => n.title.toLowerCase() === q.toLowerCase());
      if (!exact && !q.startsWith('#')) items.push({ kind: 'create', title: q });
    }
    this.setItems(items, resetSelection);
  }

  private setItems(items: ListItem[], resetSelection: boolean): void {
    let selected = this.ui.get().selected;
    if (resetSelection || !items[selected] || !isSelectable(items[selected])) {
      selected = items.findIndex(isSelectable);
    }
    this.ui.set({ items, selected });
  }

  /**
   * Todas las notas en un orden estable, que define su número (Ctrl + 1–9):
   * fijadas primero (por título) y luego de la más nueva a la más antigua.
   * Abrir o editar una nota no cambia los números; crear una nueva, sí.
   */
  private numberedNotes(): NoteMeta[] {
    const byTitle = (a: NoteMeta, b: NoteMeta) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' });
    const all = [...this.index.values()];
    return [
      ...all.filter((n) => n.pinned).sort(byTitle),
      ...all.filter((n) => !n.pinned).sort((a, b) => b.created - a.created),
    ];
  }

  private numbers(): Map<string, number> {
    return new Map(this.numberedNotes().slice(0, 9).map((n, i) => [n.id, i + 1]));
  }

  private recentIds(): string[] {
    return this.state.recent.filter((id) => this.index.has(id));
  }

  /**
   * Lista bajo el editor sin búsqueda: todas las notas, solo títulos y
   * numeradas. La nota abierta también aparece, resaltada (clase .active).
   */
  private defaultItems(): ListItem[] {
    const items: ListItem[] = this.numberedNotes()
      .slice(0, LIST_LIMIT)
      .map((note, i): ListItem => ({ kind: 'note', note, number: i < 9 ? i + 1 : undefined }));
    if (!items.length) items.push({ kind: 'empty', label: 'Aún no hay notas. Escribe: se guarda solo.' });
    return items;
  }

  private recentItems(): ListItem[] {
    const ids = this.recentIds();
    if (!ids.length) return [{ kind: 'empty', label: 'Aún no has abierto ninguna nota' }];
    const numbers = this.numbers();
    return [
      { kind: 'header', label: 'Abiertas recientemente' },
      ...ids.map((id): ListItem => ({ kind: 'note', note: this.index.get(id)!, number: numbers.get(id) })),
    ];
  }

  private tagItems(prefix: string): ListItem[] {
    const counts = new Map<string, number>();
    for (const n of this.index.values()) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const tags = [...counts]
      .filter(([t]) => t.startsWith(prefix))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!tags.length) return [{ kind: 'empty', label: prefix ? `Sin etiquetas «#${prefix}…»` : 'Aún no hay etiquetas. Escribe #algo en una nota.' }];
    return [{ kind: 'header', label: 'Etiquetas' }, ...tags.map(([tag, count]): ListItem => ({ kind: 'tag', tag, count }))];
  }

  private move(delta: number): void {
    const { items, selected } = this.ui.get();
    let i = selected;
    let target = selected;
    for (let steps = Math.abs(delta); steps > 0; ) {
      i += Math.sign(delta);
      if (i < 0 || i >= items.length) break;
      if (isSelectable(items[i])) {
        target = i;
        steps--;
      }
    }
    if (target !== selected) this.ui.set({ selected: target });
  }

  private pick(index: number): void {
    const item = this.ui.get().items[index];
    if (!item) return;
    switch (item.kind) {
      case 'note':
        void this.openNote(item.note.id);
        break;
      case 'create':
        this.setQuery('');
        this.newNote(item.title);
        break;
      case 'command':
        this.setQuery('');
        this.editor.focusBody();
        item.command.run(this, item.args);
        break;
      case 'tag':
        this.focusSearch(`#${item.tag} `);
        break;
    }
  }

  private onSearchKey(e: KeyboardEvent): boolean {
    const { query, selected, items } = this.ui.get();
    switch (e.key) {
      case 'ArrowDown':
        this.move(1);
        return true;
      case 'ArrowUp':
        this.move(-1);
        return true;
      case 'PageDown':
        this.move(8);
        return true;
      case 'PageUp':
        this.move(-8);
        return true;
      case 'Enter': {
        const q = query.trim();
        if (e.ctrlKey && q && !q.startsWith('/')) {
          this.setQuery('');
          this.newNote(q);
        } else if (selected >= 0) {
          this.pick(selected);
        } else if (q && !q.startsWith('/') && !items.length) {
          this.setQuery('');
          this.newNote(q);
        }
        return true;
      }
      case 'Escape':
        if (query) this.setQuery('');
        else this.editor.focusBody();
        return true;
      case 'Tab':
        if (e.shiftKey) return false;
        this.editor.focusBody();
        return true;
    }
    return false;
  }

  // ── Comandos (CommandContext) ───────────────────────────────────────────

  /** Al arrancar: la última nota abierta, o la última editada, o una en blanco. */
  private async openLastNote(): Promise<void> {
    const lastEdited = [...this.index.values()].sort((a, b) => b.updated - a.updated)[0];
    const id = this.recentIds()[0] ?? lastEdited?.id;
    if (id) await this.openNote(id);
    if (!this.notes.current) this.newNote();
  }

  newNote(title = ''): void {
    void this.discardEmptyNote(); // si estaba vacía, se reutiliza como nota en blanco
    const cur = this.notes.current;
    if (cur && !cur.persisted && this.notes.isEmpty()) {
      if (title) this.notes.update({ title });
    } else {
      this.notes.openBlank(title);
    }
    this.editor.load(this.notes.current!);
    void this.runQuery(false);
    this.renderStatus();
    this.editor.focusBody();
  }

  async openNote(id: string): Promise<void> {
    if (this.notes.current?.id === id) {
      this.editor.focusBody();
      return;
    }
    await this.discardEmptyNote();
    await this.notes.flush(); // que getNote lea lo último guardado
    const doc = await this.backend.getNote(id);
    if (!doc) {
      this.index.delete(id);
      this.state.forget(id);
      void this.runQuery(false);
      this.toast.show('Esa nota ya no existe');
      return;
    }
    this.notes.open(doc);
    this.editor.load(this.notes.current!);
    this.state.touchRecent(id);
    void this.runQuery(false);
    this.renderStatus();
    this.editor.focusBody();
  }

  focusSearch(query?: string): void {
    if (query !== undefined) this.setQuery(query);
    this.search.focus(query === undefined);
  }

  async togglePin(): Promise<void> {
    const cur = this.notes.current;
    if (!cur) return;
    const pinned = !cur.pinned;
    if (!cur.persisted) {
      if (this.notes.isEmpty()) {
        this.toast.show('Escribe algo antes de fijar la nota');
        return;
      }
      this.notes.update({ pinned });
    } else {
      await this.notes.flush();
      try {
        const meta = await this.backend.setPinned(cur.id, pinned);
        cur.pinned = pinned;
        this.index.set(meta.id, meta);
      } catch (e) {
        this.toast.show(`No se pudo fijar: ${e}`);
        return;
      }
    }
    this.toast.show(pinned ? '📌 Nota fijada' : 'Nota desfijada');
    void this.runQuery(false);
  }

  async deleteCurrent(): Promise<void> {
    const cur = this.notes.current;
    if (!cur) return;
    await this.notes.flush();
    if (!cur.persisted) {
      this.newNote();
      return;
    }
    const { id } = cur;
    const title = displayTitle(cur.title, cur.body);
    try {
      await this.backend.deleteNote(id);
    } catch (e) {
      this.toast.show(`No se pudo eliminar: ${e}`);
      return;
    }
    this.index.delete(id);
    this.state.forget(id);
    this.newNote();
    void this.runQuery(false);
    this.toast.show(
      `«${title}» movida a la papelera`,
      {
        label: 'Deshacer',
        run: async () => {
          try {
            const meta = await this.backend.restoreNote(id);
            this.index.set(meta.id, meta);
            await this.openNote(id);
            void this.runQuery(false);
          } catch (e) {
            this.toast.show(`No se pudo restaurar: ${e}`);
          }
        },
      },
      6000,
    );
  }

  openToday(): void {
    const title = todayTitle();
    const existing = [...this.index.values()].find((n) => n.title === title);
    if (existing) void this.openNote(existing.id);
    else this.newNote(title);
  }

  showRecent(): void {
    this.search.value = '';
    this.ui.set({ query: '', recentOnly: true });
    void this.runQuery();
    this.search.focus();
  }

  async showHistory(): Promise<void> {
    const cur = this.notes.current;
    if (!cur?.persisted) {
      this.toast.show('Esta nota todavía no tiene historial');
      return;
    }
    await this.notes.flush();
    const { id } = cur;
    const entries = await this.backend.listHistory(id);
    this.history.open({
      title: displayTitle(cur.title, cur.body),
      entries,
      load: async (stamp) => (await this.backend.readHistory(id, stamp)).body,
      restore: (stamp) => void this.restoreVersion(id, stamp),
    });
  }

  private async restoreVersion(id: string, stamp: number): Promise<void> {
    try {
      const version = await this.backend.readHistory(id, stamp);
      await this.notes.flush();
      const pinned = this.notes.current?.id === id ? this.notes.current.pinned : version.pinned;
      // snapshot=true: la versión que se sustituye también queda en el historial.
      await this.backend.saveNote({ id, title: version.rawTitle, body: version.body, pinned }, true);
      const doc = await this.backend.getNote(id);
      if (doc && this.notes.current?.id === id) {
        this.notes.open(doc);
        this.editor.load(this.notes.current);
        this.index.set(doc.id, doc);
      }
      void this.runQuery(false);
      this.renderStatus();
      this.toast.show('Versión restaurada. La anterior se guardó en el historial.');
    } catch (e) {
      this.toast.show(`No se pudo restaurar: ${e}`);
    }
  }

  showTags(): void {
    this.focusSearch('#');
  }

  openFolder(): void {
    this.backend.openFolder().catch((e) => this.toast.show(`No se pudo abrir la carpeta: ${e}`));
  }

  async toggleAutostart(): Promise<void> {
    try {
      const enabled = await this.backend.setAutostart(!(await this.backend.getAutostart()));
      this.toast.show(enabled ? 'Inicio automático activado' : 'Inicio automático desactivado');
    } catch (e) {
      this.toast.show(`No se pudo cambiar el inicio automático: ${e}`);
    }
  }

  toggleSidebar(): void {
    const sidebar = !this.ui.get().sidebar;
    this.ui.set({ sidebar });
    this.state.set('sidebar', sidebar);
  }

  dockWindow(): void {
    void this.backend.dockWindow();
  }

  showHelp(): void {
    this.help.open();
  }

  hide(): void {
    this.flushAll();
    void this.backend.hideWindow();
  }

  async quit(): Promise<void> {
    await this.discardEmptyNote();
    await this.notes.flush();
    this.state.flush();
    await this.backend.quit();
  }

  private openPrevious(): void {
    const prev = this.recentIds().find((id) => id !== this.notes.current?.id);
    if (prev) void this.openNote(prev);
  }

  /** Ctrl + número: abre la nota con ese número en la lista. */
  private openNumbered(n: number): void {
    const note = this.numberedNotes()[n - 1];
    if (note) void this.openNote(note.id);
  }

  // ── Teclado ─────────────────────────────────────────────────────────────

  private bindKeys(): void {
    // Con un panel abierto, las teclas van solo al panel.
    window.addEventListener(
      'keydown',
      (e) => {
        const modal: Modal | null = this.history.isOpen ? this.history : this.help.isOpen ? this.help : null;
        if (!modal) return;
        modal.handleKey(e);
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true },
    );

    const numberKeys = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`ctrl+${i + 1}`, () => this.openNumbered(i + 1)]),
    );
    useHotkeys(window, {
      'ctrl+n': () => this.newNote(),
      'ctrl+k, ctrl+p, ctrl+l': () => this.focusSearch(),
      'ctrl+shift+p': () => this.focusSearch('/'),
      'ctrl+d': () => void this.togglePin(),
      'ctrl+shift+backspace, ctrl+shift+delete': () => void this.deleteCurrent(),
      'ctrl+t': () => this.openToday(),
      'ctrl+e': () => this.showRecent(),
      'ctrl+h': () => void this.showHistory(),
      'ctrl+b': () => this.toggleSidebar(),
      'ctrl+tab': () => this.openPrevious(),
      'ctrl+s': () => this.flushAll(),
      'ctrl+w': () => this.hide(),
      'ctrl+q': () => void this.quit(),
      escape: () => this.hide(),
      'f1, ctrl+/': () => this.showHelp(),
      'f5, ctrl+r': () => {}, // evitar recargas accidentales del webview
      ...numberKeys,
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  private renderLayout(): void {
    const { sidebar, searchFocused, query } = this.ui.get();
    this.root.classList.toggle('sidebar-hidden', !sidebar);
    this.root.classList.toggle('searching', searchFocused || query !== '');
  }

  private renderList(): void {
    const { items, selected } = this.ui.get();
    this.list.render(items, selected, this.notes.current?.id ?? null);
  }

  private scheduleStatus(): void {
    cancelAnimationFrame(this.statusFrame);
    this.statusFrame = requestAnimationFrame(() => this.renderStatus());
  }

  private renderStatus(): void {
    const cur = this.notes.current;
    this.status.render({
      status: this.notes.status,
      file: cur?.file ?? '',
      created: cur?.persisted ? cur.created : null,
      updated: cur?.persisted ? cur.updated : null,
      words: cur ? wordCount(cur.title) + wordCount(this.editor.text) : 0,
    });
  }
}
