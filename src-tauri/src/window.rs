// Gestión de la ventana principal y del atajo global.

use serde::Serialize;
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const MAIN: &str = "main";
pub const EVENT_SUMMONED: &str = "qn://summoned";
pub const EVENT_HIDING: &str = "qn://hiding";
pub const EVENT_QUIT: &str = "qn://quit";

const DEFAULT_SHORTCUT: &str = "ctrl+space";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub accelerator: String,
    pub registered: bool,
    pub wayland: bool,
    pub error: Option<String>,
}

pub fn shortcut_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .build()
}

/// Registra Ctrl+Espacio (o `QUICKNOTES_SHORTCUT`). Si falla (otro programa lo
/// usa, o Wayland), la app sigue funcionando y el frontend sugiere el atajo
/// del escritorio que ejecuta `quicknotes --toggle`.
pub fn register_summon_shortcut<R: Runtime>(app: &AppHandle<R>) {
    let accelerator =
        std::env::var("QUICKNOTES_SHORTCUT").unwrap_or_else(|_| DEFAULT_SHORTCUT.to_string());
    let wayland = std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s == "wayland");

    let result = accelerator
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())
        .and_then(|s| app.global_shortcut().register(s).map_err(|e| e.to_string()));

    if let Err(e) = &result {
        eprintln!("quicknotes: no se pudo registrar {accelerator}: {e}");
    }
    app.manage(ShortcutStatus {
        accelerator,
        registered: result.is_ok(),
        wayland,
        error: result.err(),
    });
}

/// Argumentos recibidos de una segunda instancia (p. ej. un atajo del escritorio).
pub fn handle_cli<R: Runtime>(app: &AppHandle<R>, args: &[String]) {
    let has = |flag: &str| args.iter().any(|a| a == flag);
    if has("--quit") {
        let _ = app.emit(EVENT_QUIT, ());
    } else if has("--hidden") {
        // Autoarranque duplicado: no hacer nada.
    } else if has("--toggle") {
        toggle(app);
    } else {
        summon(app);
    }
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    let visible = w.is_visible().unwrap_or(false);
    let focused = is_focused(&w);
    let minimized = w.is_minimized().unwrap_or(false);
    if visible && focused && !minimized {
        hide(&w);
    } else {
        show(&w);
    }
}

pub fn summon<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(MAIN) {
        show(&w);
    }
}

pub fn hide<R: Runtime>(w: &WebviewWindow<R>) {
    let _ = w.emit(EVENT_HIDING, ());
    let _ = w.hide();
}

fn show<R: Runtime>(w: &WebviewWindow<R>) {
    let _ = w.unminimize();
    let _ = w.show();
    // Algunos gestores de ventanas bloquean el robo de foco; subir la ventana
    // brevemente por encima de las demás lo evita sin dejarla fijada.
    let _ = w.set_always_on_top(true);
    let _ = w.set_focus();
    let _ = w.set_always_on_top(false);
    #[cfg(target_os = "linux")]
    crate::x11::activate_own_window_soon();
    let _ = w.emit(EVENT_SUMMONED, ());
}

/// En X11 se pregunta al gestor de ventanas: el foco que informa GTK no es
/// fiable mientras GNOME procesa un atajo de teclado.
fn is_focused<R: Runtime>(w: &WebviewWindow<R>) -> bool {
    #[cfg(target_os = "linux")]
    if let Some(active) = crate::x11::is_own_window_active() {
        return active;
    }
    w.is_focused().unwrap_or(false)
}
