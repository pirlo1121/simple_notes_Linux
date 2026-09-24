# Arquitectura

## Principios

1. **La ventana nunca se destruye.** Arrancar WebKit es lo único caro. Por eso el proceso queda residente (autoarranque con `--hidden`) y Ctrl+Espacio solo hace `show()` + `focus()`.
2. **Rust es dueño de los datos, el frontend de la interacción.** Rust lee y escribe ficheros, mantiene el índice y busca. El frontend nunca carga el contenido de todas las notas.
3. **Ficheros como fuente de verdad.** No hay base de datos. El índice en memoria se reconstruye desde `~/.quicknotes` en cada arranque y se sincroniza al mostrar la ventana.
4. **Nada de diálogos.** Guardar es automático, eliminar se puede deshacer y cerrar solo oculta.

## Procesos y flujo

```
Ctrl+Space┬─► plugin global-shortcut ───────────┐
          └─► atajo del escritorio              │
               └─ quicknotes --toggle           │
                   └─ single-instance ──────────┤
                                                ▼
                                   window::toggle()  (Rust)
                                   show + focus + emit qn://summoned
                                                │
 ┌──────────── WebView (TypeScript) ────────────▼───────────────────┐
 │ App.onSummoned → enfoca el editor (nota en blanco, o la misma    │
 │                  si pasaron < 90 s) → sync_disk                  │
 │ Editor input → NotesService.update                               │
 │                 ├─ DraftJournal.put (localStorage, síncrono)     │
 │                 └─ debounce 400 ms / máx. 2 s → invoke save_note │
 └───────────────────────────────┬──────────────────────────────────┘
                                 ▼
 ┌──────────────────────── Rust (hilo de trabajo) ──────────────────┐
 │ Store::save → history::snapshot → write_atomic → renombrar si     │
 │               cambió el título → actualizar índice               │
 └──────────────────────────────────────────────────────────────────┘
```

## Estructura

```
src/                         Frontend (TypeScript, sin framework)
├── main.ts                  Arranque: backend → recuperación → App
├── app.ts                   Orquestador: lista, editor, comandos, teclado
├── types.ts                 Tipos compartidos con Rust (NoteMeta, NoteDoc…)
├── components/              Vistas: crean su DOM y exponen métodos render()
│   ├── SearchBar.ts         Barra superior (zona de arrastre de la ventana)
│   ├── NoteList.ts          Resultados, comandos, etiquetas
│   ├── Editor.ts            Título + textarea, listas, etiquetas en vivo
│   ├── StatusBar.ts         Estado de guardado, fechas y palabras
│   ├── Toast.ts             Avisos con acción (Deshacer)
│   ├── Modal.ts             Base para paneles
│   ├── HistoryPanel.ts      Versiones anteriores y restaurar
│   └── HelpPanel.ts         Atajos
├── hooks/                   Primitivas reutilizables
│   ├── createStore.ts       Estado reactivo mínimo (get/set/select)
│   ├── useDebounce.ts       Debounce con maxWait
│   └── useHotkeys.ts        Atajos de teclado declarativos
├── services/
│   ├── backend.ts           Contrato con Rust y fábrica
│   ├── tauriBackend.ts      Implementación IPC (invoke/listen)
│   ├── mockBackend.ts       Implementación en memoria (npm run dev)
│   └── notes.ts             Nota en edición y autoguardado encadenado
├── storage/
│   ├── drafts.ts            Diario de borradores (recuperación ante fallos)
│   └── appState.ts          Recientes y preferencias → .state.json
├── commands/
│   ├── registry.ts          Parser "/cmd args" y ranking
│   └── builtin.ts           /new /search /pin /delete /today …
├── utils/                   dom, tags, texto, fechas, ids
└── styles/main.css          Tema oscuro

src-tauri/src/               Backend (Rust)
├── main.rs                  Plugins, ventana, cerrar = ocultar
├── window.rs                Atajo global, toggle/summon/hide, CLI
├── commands.rs              Comandos IPC (async, fuera del hilo de UI)
├── storage.rs               Store: carga paralela, guardar, papelera, sync
├── note.rs                  Modelo, frontmatter, slug, título derivado
├── search.rs                Búsqueda y ranking
├── history.rs               Versiones en .history/
└── tags.rs                  Detección de #etiquetas
```

## Decisiones

**Tauri frente a Electron.** Usa el WebKitGTK del sistema. El `.deb` ocupa unos pocos MB en lugar de más de 80, y la memoria residente es mucho menor. Ninguna función necesita Chromium.

**Sin framework en el frontend.** La interfaz tiene cinco vistas. Un framework añadiría entre 40 y 150 KB y trabajo de hidratación al arranque sin aportar nada. `createStore` y `useHotkeys` cubren lo necesario.

**`<textarea>` en lugar de un editor enriquecido.** Escribir en él es lo más rápido que existe, deshacer es nativo y pegar código no tiene sorpresas. El Markdown es texto plano por diseño.

**Búsqueda en Rust.** El índice (`title_lc`, `body_lc`, `tags`) vive junto a los datos. La búsqueda exige todos los términos y puntúa así:

| Coincidencia | Puntos |
|---|---|
| Título empieza por el término | 120 |
| Término al inicio de una palabra del título | 90 |
| Término en otra parte del título | 70 |
| Etiqueta | 50 |
| Contenido | 20–40 |
| Subsecuencia del título | 10 |

El frontend descarta respuestas obsoletas con un número de secuencia.

**Nombre de fichero derivado del título.** `ideas.md` o `mongodb.md` se leen bien fuera de la app. El id estable vive en el frontmatter, así que renombrar el fichero no rompe el historial ni los recientes. Las colisiones reciben el sufijo `-2`, `-3`…

**Recuperación en dos capas:**

1. Escritura atómica: un corte deja la versión anterior o la nueva, nunca una a medias.
2. Diario en localStorage en cada pulsación: si el proceso muere antes del guardado (ventana de 400 ms), el siguiente arranque guarda el borrador.

**Historial.** Antes de sobrescribir se copia la versión en disco, como mucho una vez cada 5 minutos, con un máximo de 50 por nota. Restaurar fuerza una copia de la versión actual, para que restaurar también se pueda deshacer.

**Atajo global.** `tauri-plugin-global-shortcut` sirve en X11 cuando el atajo está libre. En GNOME y en Wayland se usa un atajo del escritorio que ejecuta `quicknotes --toggle`. `tauri-plugin-single-instance` reenvía esa orden al proceso vivo, o arranca la app si no lo estaba.

## Extender

- **Nuevo comando:** añade una entrada en `commands/builtin.ts`. Si necesita una acción nueva, declárala en `CommandContext` e impleméntala en `App`.
- **Nuevo dato persistente de la interfaz:** añádelo a `PersistedState` en `types.ts`.
- **Nuevo comando IPC:** función `async` en `commands.rs`, regístrala en `main.rs` y añádela a `Backend`, `tauriBackend` y `mockBackend`.
