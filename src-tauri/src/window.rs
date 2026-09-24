// Gestión de la ventana principal y del atajo global.

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::TauriPlugin, AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize,
    Runtime, WebviewWindow, Window,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const MAIN: &str = "main";
pub const EVENT_SUMMONED: &str = "qn://summoned";
pub const EVENT_HIDING: &str = "qn://hiding";
pub const EVENT_QUIT: &str = "qn://quit";
/// Carga: `true` si la ventana está acoplada a la derecha, `false` si flota.
pub const EVENT_PLACEMENT: &str = "qn://placement";

const DEFAULT_SHORTCUT: &str = "ctrl+space";
/// Ancho inicial del panel acoplado (píxeles lógicos).
const PANEL_WIDTH: f64 = 440.0;
const PANEL_MIN_WIDTH: f64 = 340.0;
/// Tolerancia (px) para considerar que la ventana sigue pegada a la esquina
/// superior derecha del área útil (= acoplada).
const DOCK_TOLERANCE: i32 = 16;
/// Pausa sin movimientos ni cambios de tamaño tras la que se guarda la colocación.
const SAVE_DELAY: Duration = Duration::from_millis(600);
const WINDOW_FILE: &str = ".window.json";

// ── Colocación ──────────────────────────────────────────────────────────────
//
// Dos modos:
//   · acoplada (por defecto): panel pegado a la esquina superior derecha del
//     área útil. Se recuerdan ancho y alto (por defecto, todo el alto).
//   · flotante: si el usuario la arrastra lejos de esa esquina, se recuerdan
//     posición y tamaño.
// El modo se deduce de dónde quedó la ventana, así que redimensionarla desde
// el borde izquierdo (lo que también cambia su posición) no la hace flotar.
// `/dock` vuelve a acoplarla. Todo se guarda en ~/.quicknotes/.window.json.
//
// El estado vive en memoria y no se le pregunta a GTK al mostrar: con la
// ventana oculta, GTK devuelve el tamaño y la posición iniciales.

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
struct Placement {
    /// Ancho del panel acoplado, en píxeles lógicos.
    width: f64,
    /// Alto del panel acoplado en píxeles lógicos; `None` = todo el alto útil.
    #[serde(default)]
    height: Option<f64>,
    /// Posición y tamaño en píxeles físicos si flota; `None` si está acoplada.
    #[serde(default)]
    floating: Option<Rect>,
}

static PLACEMENT: Mutex<Placement> =
    Mutex::new(Placement { width: PANEL_WIDTH, height: None, floating: None });
/// Si la ventana llegó a colocarse alguna vez (antes, GTK da tamaños iniciales).
static PLACED: Mutex<bool> = Mutex::new(false);
/// Último modo enviado al frontend, para no repetir el evento en cada píxel.
static DOCKED_SENT: Mutex<Option<bool>> = Mutex::new(None);
/// Generación del guardado diferido: solo guarda el último de una ráfaga.
static SAVE_GENERATION: AtomicU64 = AtomicU64::new(0);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

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
    remember_placement(w.outer_position(), w.outer_size(), w.scale_factor(), w.available_monitors());
    let _ = w.emit(EVENT_HIDING, ());
    let _ = w.hide();
}

/// Lee la colocación guardada. Acepta también el formato antiguo `{"width": 440}`.
pub fn load_placement() {
    let saved = std::fs::read_to_string(crate::storage::default_root().join(WINDOW_FILE))
        .ok()
        .and_then(|s| serde_json::from_str::<Placement>(&s).ok());
    if let Some(mut p) = saved {
        if !p.width.is_finite() || p.width < PANEL_MIN_WIDTH {
            p.width = PANEL_WIDTH;
        }
        *lock(&PLACEMENT) = p;
    }
}

fn save_placement(p: &Placement) {
    let path = crate::storage::default_root().join(WINDOW_FILE);
    let Ok(data) = serde_json::to_string(p) else { return };
    if std::fs::read_to_string(&path).ok().as_deref() != Some(data.as_str()) {
        let _ = std::fs::write(path, data);
    }
}

/// Guarda cómo dejó el usuario la ventana. Recibe los valores sueltos para
/// servir tanto a `Window` como a `WebviewWindow`.
pub fn remember_placement(
    pos: tauri::Result<PhysicalPosition<i32>>,
    size: tauri::Result<PhysicalSize<u32>>,
    scale: tauri::Result<f64>,
    monitors: tauri::Result<Vec<Monitor>>,
) {
    let (Ok(pos), Ok(size), Ok(scale)) = (pos, size, scale) else { return };
    if !*lock(&PLACED) {
        return;
    }
    let current = Rect { x: pos.x, y: pos.y, width: size.width, height: size.height };
    let mut p = lock(&PLACEMENT);
    match dock_area(&current, &monitors.unwrap_or_default()) {
        Some(area) => {
            p.floating = None;
            let width = (size.width as f64 / scale).round();
            if width >= PANEL_MIN_WIDTH {
                p.width = width;
            }
            let full = size.height as i32 + DOCK_TOLERANCE >= area.size.height as i32;
            p.height = (!full).then(|| (size.height as f64 / scale).round());
        }
        None => p.floating = Some(current),
    }
    save_placement(&p);
}

/// Al mover o redimensionar: avisa al frontend si cambió el modo (para las
/// esquinas) y guarda en cuanto el usuario suelta, sin esperar a ocultar.
pub fn on_geometry_changed<R: Runtime>(w: &Window<R>) {
    if !*lock(&PLACED) || !w.is_visible().unwrap_or(false) {
        return;
    }
    if let (Ok(pos), Ok(size), Ok(monitors)) = (w.outer_position(), w.outer_size(), w.available_monitors()) {
        let rect = Rect { x: pos.x, y: pos.y, width: size.width, height: size.height };
        send_docked(w, dock_area(&rect, &monitors).is_some());
    }
    let generation = SAVE_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    let w = w.clone();
    thread::spawn(move || {
        thread::sleep(SAVE_DELAY);
        if SAVE_GENERATION.load(Ordering::Relaxed) == generation && w.is_visible().unwrap_or(false) {
            remember_placement(w.outer_position(), w.outer_size(), w.scale_factor(), w.available_monitors());
        }
    });
}

fn send_docked<E: Emitter<R>, R: Runtime>(emitter: &E, docked: bool) {
    let mut sent = lock(&DOCKED_SENT);
    if *sent != Some(docked) {
        *sent = Some(docked);
        let _ = emitter.emit(EVENT_PLACEMENT, docked);
    }
}

/// `/dock`: vuelve a acoplar la ventana (conserva el ancho y alto del panel).
pub fn dock<R: Runtime>(w: &WebviewWindow<R>) {
    {
        let mut p = lock(&PLACEMENT);
        p.floating = None;
        save_placement(&p);
    }
    let docked = place(w);
    send_docked(w, docked);
}

/// Área útil del monitor en cuya esquina superior derecha está pegada la
/// ventana, si lo está.
fn dock_area(r: &Rect, monitors: &[Monitor]) -> Option<tauri::PhysicalRect<i32, u32>> {
    monitors.iter().map(|m| *m.work_area()).find(|a| {
        let right = r.x + r.width as i32;
        let area_right = a.position.x + a.size.width as i32;
        (right - area_right).abs() <= DOCK_TOLERANCE && (r.y - a.position.y).abs() <= DOCK_TOLERANCE
    })
}

fn show<R: Runtime>(w: &WebviewWindow<R>) {
    let _ = w.unminimize();
    let docked = place(w);
    let _ = w.show();
    place(w); // algunos gestores de ventanas recolocan al mapear
    *lock(&PLACED) = true;
    // Siempre por encima de las demás ventanas hasta que el usuario la cierre.
    let _ = w.set_always_on_top(true);
    let _ = w.set_focus();
    #[cfg(target_os = "linux")]
    crate::x11::activate_own_window_soon();
    *lock(&DOCKED_SENT) = None; // el frontend puede haberse recargado: reenviar
    send_docked(w, docked);
    let _ = w.emit(EVENT_SUMMONED, ());
}

/// Coloca la ventana donde la dejó el usuario o, si no, acoplada a la derecha.
/// Devuelve `true` si quedó acoplada.
fn place<R: Runtime>(w: &WebviewWindow<R>) -> bool {
    let floating = lock(&PLACEMENT).floating.filter(|r| on_screen(w, r));
    let (rect, docked) = match floating {
        Some(r) => (r, false),
        None => match docked_rect(w) {
            Some(r) => (r, true),
            None => return true,
        },
    };
    let _ = w.set_size(PhysicalSize::new(rect.width, rect.height));
    let _ = w.set_position(PhysicalPosition::new(rect.x, rect.y));
    docked
}

/// Panel lateral: borde derecho del monitor donde está el puntero, todo el
/// alto útil (sin la barra superior).
fn docked_rect<R: Runtime>(w: &WebviewWindow<R>) -> Option<Rect> {
    let monitor = w
        .cursor_position()
        .ok()
        .and_then(|p| w.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let (width, height) = {
        let p = lock(&PLACEMENT);
        (p.width, p.height)
    };
    let scale = monitor.scale_factor();
    let width = ((width * scale) as u32).min(area.size.width);
    let height = height.map_or(area.size.height, |h| ((h * scale) as u32).min(area.size.height));
    Some(Rect {
        x: area.position.x + area.size.width as i32 - width as i32,
        y: area.position.y,
        width,
        height,
    })
}

/// La barra superior de la ventana cae dentro de algún monitor (p. ej. no se
/// desconectó el monitor donde estaba).
fn on_screen<R: Runtime>(w: &WebviewWindow<R>, r: &Rect) -> bool {
    let (cx, cy) = (r.x + r.width as i32 / 2, r.y + 20);
    w.available_monitors().is_ok_and(|monitors| {
        monitors.iter().any(|m| {
            let a = m.work_area();
            cx >= a.position.x
                && cx < a.position.x + a.size.width as i32
                && cy >= a.position.y
                && cy < a.position.y + a.size.height as i32
        })
    })
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
