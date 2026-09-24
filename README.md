# QuickNotes

> Capturar ideas en segundos, sin distracciones.

Notas rápidas para Debian/Linux. Pulsa **Ctrl+Espacio**, escribe y cierra: todo queda guardado como Markdown en `~/.quicknotes/`.

- Tauri 2 + Rust + TypeScript sin framework (≈35 KB de JS).
- Autoguardado, historial de versiones y recuperación ante cierres inesperados.
- Búsqueda instantánea, `#etiquetas` automáticas, notas fijadas y paleta de comandos.
- Sin nube, sin IA, sin cuentas, sin base de datos.

---

## Uso

| Acción | Tecla |
|---|---|
| Mostrar / ocultar (global) | `Ctrl Espacio` |
| Nueva nota | `Ctrl N` |
| Buscar (o crear con `↵`) | `Ctrl K` / `Ctrl P` |
| Paleta de comandos | `Ctrl ⇧ P` o escribir `/` en la búsqueda |
| Nota anterior | `Ctrl Tab` |
| Recientes | `Ctrl E` |
| Abrir nota fijada 1…9 | `Ctrl 1…9` |
| Fijar / desfijar | `Ctrl D` |
| Nota de hoy (`2026-09-24.md`) | `Ctrl T` |
| Historial de cambios | `Ctrl H` |
| Eliminar (con «Deshacer») | `Ctrl ⇧ ⌫` |
| Mostrar / ocultar la lista | `Ctrl B` |
| Ocultar ventana | `Esc` / `Ctrl W` |
| Salir del todo | `Ctrl Q` |
| Ayuda | `F1` |

**Flujo:** `Ctrl+Espacio` abre una nota en blanco con el cursor listo. Si vuelves antes de 90 s, sigues en la nota en la que estabas. La primera línea hace de título si no escribes uno.

**Búsqueda:** `mongodb` busca en títulos, etiquetas y contenido. `#backend` filtra por etiqueta. `mongo #backend` combina ambas. Escribir solo `#` lista todas las etiquetas. Si nada coincide, `↵` crea una nota con ese título.

**Comandos:** `/new [título]`, `/search`, `/pin`, `/delete`, `/today`, `/recent`, `/history`, `/tags`, `/folder`, `/sidebar`, `/autostart`, `/help`, `/hide`, `/quit`. También en español: `/nueva`, `/hoy`, `/fijar`, `/borrar`…

**Editor:** Markdown en texto plano. `Tab` / `⇧ Tab` indentan, y `↵` continúa listas (`-`, `1.`, `- [ ]`).

## Formato de las notas

```
~/.quicknotes/
├── mongodb.md          ← nombre = título normalizado
├── comandos-linux.md
├── 2026-09-24.md
├── .history/<id>/…     ← versiones anteriores (1 cada 5 min de edición, máx. 50)
├── .trash/…            ← notas eliminadas
└── .state.json         ← recientes y preferencias
```

```markdown
---
id: m1abc2-9f1a
title: "MongoDB"
created: 2026-09-24T10:12:00+02:00
updated: 2026-09-24T10:30:41+02:00
pinned: true
---

Índices compuestos: igualdad, orden, rango. #backend #mongodb
```

Puedes editar, crear o copiar ficheros `.md` con cualquier editor, o sincronizarlos con git o Syncthing. Los cambios se detectan cada vez que se muestra la ventana. Se aceptan ficheros sin frontmatter.

Variables de entorno opcionales:

- `QUICKNOTES_DIR`: otra carpeta de notas.
- `QUICKNOTES_SHORTCUT`: otro atajo para la app (p. ej. `super+j`, `ctrl+alt+n`). Para el atajo del escritorio: `sh setup-shortcut.sh '<Super>j'`.

---

## Compilar e instalar en Debian 12/13

### 1. Dependencias (una sola vez)

```sh
sudo apt update
sudo apt install -y build-essential curl wget file pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
# Node.js ≥ 18 (apt install nodejs npm, o nvm)
npm install
```

También puedes usar `make deps`.

### 2. Desarrollo

```sh
npm run tauri dev      # app completa con recarga en caliente
npm run dev            # solo la interfaz en el navegador, con datos simulados
cd src-tauri && cargo test
```

### 3. Paquete `.deb`

```sh
make deb               # = npm run tauri build -- --bundles deb
make install           # sudo apt install ./src-tauri/target/release/bundle/deb/QuickNotes_0.1.0_amd64.deb
```

El paquete instala:

- `/usr/bin/quicknotes`
- la entrada de menú `QuickNotes` y sus iconos
- `/usr/share/quicknotes/setup-shortcut.sh`

Depende solo de `libwebkit2gtk-4.1-0` y `libgtk-3-0`.

### 4. Atajo Ctrl+Espacio

La app registra Ctrl+Espacio por sí misma y se activa sola al iniciar sesión, porque el primer arranque configura el autoarranque (`/autostart` para desactivarlo). Así funciona aunque la ventana esté oculta, minimizada o en segundo plano.

Hay dos casos en los que hace falta un atajo del escritorio:

- **GNOME**: el atajo del escritorio es más fiable que el de la app.
- **Wayland**: las aplicaciones no pueden capturar atajos globales.

En ambos casos, ejecuta una vez:

```sh
sh /usr/share/quicknotes/setup-shortcut.sh      # o: make shortcut
```

El script crea un atajo que ejecuta `quicknotes --toggle`. Si la app no está abierta, se abre. Si ya lo está, la instancia única la muestra y la enfoca. En KDE, XFCE, i3, sway o Hyprland, el script indica qué añadir.

Opciones de línea de comandos:

- `--toggle`: mostrar u ocultar.
- `--hidden`: arrancar en segundo plano.
- `--quit`: guardar y salir.

### Problemas conocidos

- **Ventana en blanco** con algunos drivers NVIDIA: `WEBKIT_DISABLE_DMABUF_RENDERER=1 quicknotes`.
- **Ctrl+Espacio no responde**: ejecuta `setup-shortcut.sh`. El aviso de la app aparece una sola vez.

## Rendimiento

| Objetivo | Cómo se consigue |
|---|---|
| Apertura instantánea | El proceso queda residente: cerrar solo oculta la ventana. Ctrl+Espacio muestra una ventana ya cargada, sin arrancar nada. |
| Arranque en frío < 300 ms | Binario Rust con LTO. Interfaz sin framework, CSS en línea y ventana oculta hasta el primer render. La lectura de notas empieza en paralelo con WebKit. Mídelo en tu equipo: WebKitGTK es la parte más lenta. |
| Poca memoria | Un solo WebView (WebKitGTK del sistema, sin Chromium empaquetado). Índice en memoria de solo texto. |
| Búsqueda instantánea con miles de notas | Índice en minúsculas en Rust. Una búsqueda recorre ~25 MB de texto en pocos ms, sin IPC por nota. |
| Guardado seguro | Escritura atómica (tmp + fsync + rename) en un hilo de trabajo, más un diario de borradores en cada pulsación. |

Detalles de diseño en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Cómo cerrar, desarrollar y actualizar la app: [GUIA.md](GUIA.md).
