// Activación de la ventana en X11.
//
// GNOME (mutter) impide que una ventana recién mostrada robe el foco: la marca
// como "requiere atención" en lugar de activarla. Pedir la activación con
// _NET_ACTIVE_WINDOW como lo hace un paginador (igual que `wmctrl -a`), una vez
// que la ventana ya está gestionada, sí la trae al frente con el foco.
// En Wayland no hay nada que hacer aquí: devuelve None/false.

use std::{error::Error, thread, time::Duration};

use x11rb::{
    connection::Connection,
    protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, Window},
    rust_connection::RustConnection,
};

type Res<T> = Result<T, Box<dyn Error>>;

/// Origen "paginador" en _NET_ACTIVE_WINDOW: mutter no aplica la prevención de robo de foco.
const SOURCE_PAGER: u32 = 2;

struct X {
    conn: RustConnection,
    root: Window,
}

impl X {
    fn connect() -> Option<X> {
        if std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s == "wayland")
            || std::env::var_os("DISPLAY").is_none()
        {
            return None;
        }
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots[screen].root;
        Some(X { conn, root })
    }

    fn atom(&self, name: &str) -> Res<u32> {
        Ok(self.conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
    }

    fn windows(&self, property: &str, window: Window) -> Res<Vec<Window>> {
        let reply = self
            .conn
            .get_property(false, window, self.atom(property)?, AtomEnum::WINDOW, 0, u32::MAX)?
            .reply()?;
        Ok(reply.value32().map(|v| v.collect()).unwrap_or_default())
    }

    /// La ventana gestionada por el gestor de ventanas que pertenece a este proceso.
    fn own_window(&self) -> Res<Option<Window>> {
        let pid_atom = self.atom("_NET_WM_PID")?;
        let pid = std::process::id();
        for win in self.windows("_NET_CLIENT_LIST", self.root)? {
            let reply = self
                .conn
                .get_property(false, win, pid_atom, AtomEnum::CARDINAL, 0, 1)?
                .reply()?;
            if reply.value32().and_then(|mut v| v.next()) == Some(pid) {
                return Ok(Some(win));
            }
        }
        Ok(None)
    }

    fn active_window(&self) -> Res<Option<Window>> {
        Ok(self.windows("_NET_ACTIVE_WINDOW", self.root)?.first().copied())
    }

    fn request_activation(&self, win: Window) -> Res<()> {
        let event = ClientMessageEvent::new(
            32,
            win,
            self.atom("_NET_ACTIVE_WINDOW")?,
            [SOURCE_PAGER, 0, 0, 0, 0],
        );
        self.conn.send_event(
            false,
            self.root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
            event,
        )?;
        self.conn.flush()?;
        Ok(())
    }
}

/// ¿Es nuestra ventana la activa? None si no se puede saber (Wayland).
pub fn is_own_window_active() -> Option<bool> {
    let x = X::connect()?;
    let own = x.own_window().ok()??;
    Some(x.active_window().ok()? == Some(own))
}

/// Activa nuestra ventana en cuanto el gestor de ventanas la tenga mapeada.
/// Se ejecuta en un hilo aparte para no bloquear el bucle de eventos.
pub fn activate_own_window_soon() {
    thread::spawn(|| {
        let Some(x) = X::connect() else { return };
        for _ in 0..40 {
            thread::sleep(Duration::from_millis(15));
            let Ok(Some(win)) = x.own_window() else { continue };
            if x.active_window().ok().flatten() == Some(win) {
                return;
            }
            let _ = x.request_activation(win);
        }
    });
}
