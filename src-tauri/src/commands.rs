// Comandos IPC expuestos al frontend.
//
// Son `async` para ejecutarse fuera del hilo principal: la escritura con
// fsync nunca bloquea el bucle de eventos de la ventana.

use std::io;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    history::HistoryEntry,
    note::{NoteDoc, NoteInput, NoteMeta},
    storage::Store,
    window::{self, ShortcutStatus},
    AppState,
};

type CmdResult<T> = Result<T, String>;

fn with_store<T>(state: &AppState, f: impl FnOnce(&mut Store) -> io::Result<T>) -> CmdResult<T> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    f(&mut store).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>) -> CmdResult<Vec<NoteMeta>> {
    with_store(&state, |s| Ok(s.list()))
}

#[tauri::command]
pub async fn search_notes(state: State<'_, AppState>, query: String, limit: Option<usize>) -> CmdResult<Vec<NoteMeta>> {
    with_store(&state, |s| Ok(s.search(&query, limit.unwrap_or(200))))
}

#[tauri::command]
pub async fn get_note(state: State<'_, AppState>, id: String) -> CmdResult<Option<NoteDoc>> {
    with_store(&state, |s| Ok(s.get(&id)))
}

#[tauri::command]
pub async fn save_note(state: State<'_, AppState>, note: NoteInput, snapshot: Option<bool>) -> CmdResult<NoteMeta> {
    with_store(&state, |s| s.save(note, snapshot.unwrap_or(false)))
}

#[tauri::command]
pub async fn set_pinned(state: State<'_, AppState>, id: String, pinned: bool) -> CmdResult<NoteMeta> {
    with_store(&state, |s| s.set_pinned(&id, pinned))
}

#[tauri::command]
pub async fn delete_note(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    with_store(&state, |s| s.delete(&id))
}

#[tauri::command]
pub async fn restore_note(state: State<'_, AppState>, id: String) -> CmdResult<NoteMeta> {
    with_store(&state, |s| s.restore(&id))
}

#[tauri::command]
pub async fn sync_disk(state: State<'_, AppState>) -> CmdResult<bool> {
    with_store(&state, |s| s.sync_disk())
}

#[tauri::command]
pub async fn list_history(state: State<'_, AppState>, id: String) -> CmdResult<Vec<HistoryEntry>> {
    with_store(&state, |s| Ok(s.history(&id)))
}

#[tauri::command]
pub async fn read_history(state: State<'_, AppState>, id: String, stamp: i64) -> CmdResult<NoteDoc> {
    with_store(&state, |s| s.history_version(&id, stamp))
}

#[tauri::command]
pub async fn read_state(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    with_store(&state, |s| Ok(s.read_state()))
}

#[tauri::command]
pub async fn write_state(state: State<'_, AppState>, value: serde_json::Value) -> CmdResult<()> {
    with_store(&state, |s| s.write_state(&value))
}

#[tauri::command]
pub async fn notes_dir(state: State<'_, AppState>) -> CmdResult<String> {
    with_store(&state, |s| Ok(s.root().display().to_string()))
}

#[tauri::command]
pub async fn open_folder(state: State<'_, AppState>) -> CmdResult<()> {
    let dir = with_store(&state, |s| Ok(s.root().to_path_buf()))?;
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_autostart(app: AppHandle) -> CmdResult<bool> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> CmdResult<bool> {
    let manager = app.autolaunch();
    let result = if enabled { manager.enable() } else { manager.disable() };
    result.map(|_| enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn shortcut_status(app: AppHandle) -> CmdResult<Option<ShortcutStatus>> {
    Ok(app.try_state::<ShortcutStatus>().map(|s| s.inner().clone()))
}

#[tauri::command]
pub async fn hide_window(app: AppHandle) -> CmdResult<()> {
    if let Some(w) = app.get_webview_window(window::MAIN) {
        window::hide(&w);
    }
    Ok(())
}

#[tauri::command]
pub async fn dock_window(app: AppHandle) -> CmdResult<()> {
    if let Some(w) = app.get_webview_window(window::MAIN) {
        window::dock(&w);
    }
    Ok(())
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) {
    // Oculta, GTK puede informar un tamaño viejo: solo se guarda si está visible.
    if let Some(w) = app.get_webview_window(window::MAIN).filter(|w| w.is_visible().unwrap_or(false)) {
        window::remember_placement(w.outer_position(), w.outer_size(), w.scale_factor(), w.available_monitors());
    }
    app.exit(0);
}
