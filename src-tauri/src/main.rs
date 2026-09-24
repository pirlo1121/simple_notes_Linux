// QuickNotes — proceso residente con una sola ventana.
//
// El proceso vive en segundo plano: cerrar la ventana solo la oculta, así
// Ctrl+Espacio la muestra al instante sin volver a arrancar WebKit.

mod commands;
mod history;
mod note;
mod search;
mod storage;
mod tags;
mod window;
#[cfg(target_os = "linux")]
mod x11;

use std::sync::Mutex;

use tauri::{Emitter, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

pub struct AppState {
    pub store: Mutex<storage::Store>,
}

fn main() {
    // La carga de notas empieza en un hilo aparte mientras WebKit arranca.
    let store = storage::Store::open(storage::default_root())
        .expect("no se pudo crear el directorio de notas");
    let args: Vec<String> = std::env::args().collect();

    tauri::Builder::default()
        // Debe ser el primer plugin: una segunda instancia reenvía sus
        // argumentos a esta y termina.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            window::handle_cli(app, &args);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(window::shortcut_plugin())
        .manage(AppState {
            store: Mutex::new(store),
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_notes,
            commands::search_notes,
            commands::get_note,
            commands::save_note,
            commands::set_pinned,
            commands::delete_note,
            commands::restore_note,
            commands::sync_disk,
            commands::list_history,
            commands::read_history,
            commands::read_state,
            commands::write_state,
            commands::notes_dir,
            commands::open_folder,
            commands::get_autostart,
            commands::set_autostart,
            commands::shortcut_status,
            commands::hide_window,
            commands::dock_window,
            commands::quit_app,
        ])
        .setup(move |app| {
            if args.iter().any(|a| a == "--quit") {
                app.handle().exit(0);
                return Ok(());
            }
            window::register_summon_shortcut(app.handle());
            window::load_placement();
            if !args.iter().any(|a| a == "--hidden") {
                window::summon(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar = ocultar. Sin diálogos: el frontend guarda al recibir el evento.
            if let WindowEvent::Moved(pos) = event {
                window::on_moved(window, *pos);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window::remember_placement(window.outer_position(), window.outer_size(), window.scale_factor());
                let _ = window.emit(window::EVENT_HIDING, ());
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar QuickNotes");
}
