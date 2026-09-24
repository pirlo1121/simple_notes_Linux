import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Backend, BackendEvent } from './backend';

export const tauriBackend: Backend = {
  listNotes: () => invoke('list_notes'),
  search: (query, limit = 200) => invoke('search_notes', { query, limit }),
  getNote: (id) => invoke('get_note', { id }),
  saveNote: (note, snapshot = false) => invoke('save_note', { note, snapshot }),
  setPinned: (id, pinned) => invoke('set_pinned', { id, pinned }),
  deleteNote: (id) => invoke('delete_note', { id }),
  restoreNote: (id) => invoke('restore_note', { id }),
  syncDisk: () => invoke('sync_disk'),
  listHistory: (id) => invoke('list_history', { id }),
  readHistory: (id, stamp) => invoke('read_history', { id, stamp }),
  readState: () => invoke('read_state'),
  writeState: (value) => invoke('write_state', { value }),
  notesDir: () => invoke('notes_dir'),
  openFolder: () => invoke('open_folder'),
  getAutostart: () => invoke('get_autostart'),
  setAutostart: (enabled) => invoke('set_autostart', { enabled }),
  shortcutStatus: () => invoke('shortcut_status'),
  hideWindow: () => invoke('hide_window'),
  dockWindow: () => invoke('dock_window'),
  quit: () => invoke('quit_app'),
  on: (event: BackendEvent, fn) => listen(`qn://${event}`, (e) => fn(e.payload)),
};
