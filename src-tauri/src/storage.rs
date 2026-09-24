// Almacén de notas: ficheros Markdown en ~/.quicknotes + índice en memoria.
//
//   ~/.quicknotes/
//     mongodb.md            notas (nombre = título normalizado)
//     .history/<id>/…       versiones anteriores
//     .trash/…              notas eliminadas (recuperables)
//     .state.json           recientes y preferencias de la interfaz

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    thread::JoinHandle,
    time::SystemTime,
};

use crate::{
    history::{self, HistoryEntry, HISTORY_DIR},
    note::{now_ms, safe_component, sanitize_title, slugify, Note, NoteDoc, NoteInput, NoteMeta},
    search,
};

const TRASH_DIR: &str = ".trash";
const STATE_FILE: &str = ".state.json";

pub fn default_root() -> PathBuf {
    if let Some(dir) = std::env::var_os("QUICKNOTES_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    home.join(".quicknotes")
}

pub struct Store {
    root: PathBuf,
    notes: HashMap<String, Note>,
    loading: Option<JoinHandle<Vec<Note>>>,
}

impl Store {
    /// Crea los directorios y lanza la carga en segundo plano.
    pub fn open(root: PathBuf) -> io::Result<Self> {
        for dir in [root.clone(), root.join(HISTORY_DIR), root.join(TRASH_DIR)] {
            fs::create_dir_all(dir)?;
        }
        let dir = root.clone();
        let loading = std::thread::spawn(move || load_dir(&dir));
        Ok(Store { root, notes: HashMap::new(), loading: Some(loading) })
    }

    /// Espera a que termine la carga inicial (solo bloquea la primera vez).
    fn ready(&mut self) {
        if let Some(handle) = self.loading.take() {
            for note in handle.join().unwrap_or_default() {
                self.insert_loaded(note);
            }
        }
    }

    /// Inserta una nota leída de disco. Si su id ya existe (un fichero
    /// duplicado a mano), se le asigna uno derivado del nombre de fichero.
    fn insert_loaded(&mut self, mut note: Note) {
        if self.notes.get(&note.id).is_some_and(|other| other.path != note.path) {
            let stem = note.path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            note.id = format!("f-{}", safe_component(&stem));
        }
        self.notes.insert(note.id.clone(), note);
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list(&mut self) -> Vec<NoteMeta> {
        self.ready();
        let mut notes: Vec<&Note> = self.notes.values().collect();
        notes.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated.cmp(&a.updated)));
        notes.into_iter().map(Note::meta).collect()
    }

    pub fn search(&mut self, query: &str, limit: usize) -> Vec<NoteMeta> {
        self.ready();
        if search::Query::parse(query).is_empty() {
            let mut all = self.list();
            all.truncate(limit);
            return all;
        }
        search::search(self.notes.values(), query, limit)
    }

    pub fn get(&mut self, id: &str) -> Option<NoteDoc> {
        self.ready();
        self.notes.get(id).map(Note::doc)
    }

    /// Crea o actualiza una nota. No escribe nada si no hay cambios.
    /// Con `force_snapshot` la versión en disco se copia siempre al historial.
    pub fn save(&mut self, input: NoteInput, force_snapshot: bool) -> io::Result<NoteMeta> {
        self.ready();
        let title = sanitize_title(&input.title);
        let existing = self.notes.get(&input.id);
        if let Some(n) = existing {
            if n.title == title && n.body == input.body && n.pinned == input.pinned {
                return Ok(n.meta());
            }
        } else {
            if safe_component(&input.id) != input.id || input.id.is_empty() {
                return Err(invalid("id de nota no válido"));
            }
            if title.is_empty() && input.body.trim().is_empty() {
                return Err(invalid("la nota está vacía"));
            }
        }
        let now = now_ms();
        let created = existing.map_or(now, |n| n.created);
        let note = Note::new(input.id, title, input.body, created, now, input.pinned, PathBuf::new());
        self.persist(note, force_snapshot)
    }

    /// Fijar no cuenta como edición: no cambia la fecha de modificación.
    pub fn set_pinned(&mut self, id: &str, pinned: bool) -> io::Result<NoteMeta> {
        self.ready();
        let mut note = self.notes.get(id).cloned().ok_or_else(not_found)?;
        if note.pinned == pinned {
            return Ok(note.meta());
        }
        note.pinned = pinned;
        self.persist(note, false)
    }

    /// Escribe la nota en disco (renombrando el fichero si cambió el título).
    fn persist(&mut self, mut note: Note, force_snapshot: bool) -> io::Result<NoteMeta> {
        let old_path = self.notes.get(&note.id).map(|n| n.path.clone());
        let path = self.path_for(&note, old_path.as_deref());
        if let Some(old) = &old_path {
            if let Err(e) = history::snapshot(&self.root, &note.id, old, force_snapshot) {
                eprintln!("quicknotes: no se pudo guardar el historial: {e}");
            }
        }
        write_atomic(&path, note.to_markdown().as_bytes())?;
        if let Some(old) = old_path.filter(|old| *old != path) {
            let _ = fs::remove_file(old);
        }
        note.mtime = modified(&path);
        note.path = path;
        let meta = note.meta();
        self.notes.insert(note.id.clone(), note);
        Ok(meta)
    }

    /// Nombre de fichero a partir del título: "MongoDB" -> mongodb.md,
    /// con sufijo -2, -3… si ya existe otro con el mismo nombre.
    fn path_for(&self, note: &Note, current: Option<&Path>) -> PathBuf {
        let base = slugify(&note.display_title());
        if let Some(stem) = current.and_then(|p| p.file_stem()).and_then(|s| s.to_str()) {
            let same_base = stem == base
                || stem
                    .strip_prefix(base.as_str())
                    .and_then(|rest| rest.strip_prefix('-'))
                    .is_some_and(|n| n.parse::<u32>().is_ok());
            if same_base {
                return current.map(Path::to_path_buf).unwrap_or_default();
            }
        }
        (1..)
            .map(|i| {
                let name = if i == 1 { format!("{base}.md") } else { format!("{base}-{i}.md") };
                self.root.join(name)
            })
            .find(|p| !p.exists() || Some(p.as_path()) == current)
            .expect("rango infinito")
    }

    /// Mueve la nota a la papelera (~/.quicknotes/.trash).
    pub fn delete(&mut self, id: &str) -> io::Result<()> {
        self.ready();
        let path = self.notes.get(id).map(|n| n.path.clone()).ok_or_else(not_found)?;
        if path.exists() {
            let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let target = self.root.join(TRASH_DIR).join(format!("{}__{}__{}", safe_component(id), now_ms(), file));
            fs::create_dir_all(self.root.join(TRASH_DIR))?;
            fs::rename(&path, target)?;
        }
        self.notes.remove(id);
        Ok(())
    }

    /// Recupera la última copia de la nota enviada a la papelera.
    pub fn restore(&mut self, id: &str) -> io::Result<NoteMeta> {
        self.ready();
        let trash = self.root.join(TRASH_DIR);
        let prefix = format!("{}__", safe_component(id));
        let stamp_of = |name: &str| -> i64 {
            name[prefix.len()..].split("__").next().and_then(|s| s.parse().ok()).unwrap_or(0)
        };
        let latest = fs::read_dir(&trash)?
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(&prefix))
            .max_by_key(|name| stamp_of(name))
            .ok_or_else(not_found)?;
        let source = trash.join(latest);
        let mut note = Note::load(&source)?;
        note.id = id.to_string();
        let dest = self.path_for(&note, None);
        fs::rename(&source, &dest)?;
        note.mtime = modified(&dest);
        note.path = dest;
        let meta = note.meta();
        self.notes.insert(note.id.clone(), note);
        Ok(meta)
    }

    /// Detecta cambios hechos fuera de la app (editor externo, git, sync…).
    /// Solo compara fechas de modificación; relee lo que cambió.
    pub fn sync_disk(&mut self) -> io::Result<bool> {
        self.ready();
        let by_path: HashMap<PathBuf, String> =
            self.notes.values().map(|n| (n.path.clone(), n.id.clone())).collect();
        let mut seen = HashSet::new();
        let mut changed = false;

        for path in note_files(&self.root) {
            let mtime = modified(&path);
            let known = by_path.get(&path);
            let stale = match known {
                Some(id) => self.notes.get(id).map(|n| n.mtime) != Some(mtime),
                None => true,
            };
            if stale {
                if let Ok(note) = Note::load(&path) {
                    if let Some(id) = known {
                        self.notes.remove(id);
                    }
                    self.insert_loaded(note);
                    changed = true;
                }
            }
            seen.insert(path);
        }

        let gone: Vec<String> =
            self.notes.values().filter(|n| !seen.contains(&n.path)).map(|n| n.id.clone()).collect();
        for id in &gone {
            self.notes.remove(id);
        }
        Ok(changed || !gone.is_empty())
    }

    pub fn history(&mut self, id: &str) -> Vec<HistoryEntry> {
        history::list(&self.root, id)
    }

    pub fn history_version(&mut self, id: &str, stamp: i64) -> io::Result<NoteDoc> {
        history::read(&self.root, id, stamp).map(|n| n.doc())
    }

    pub fn read_state(&self) -> serde_json::Value {
        fs::read_to_string(self.root.join(STATE_FILE))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::Value::Null)
    }

    pub fn write_state(&self, value: &serde_json::Value) -> io::Result<()> {
        let data = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
        write_atomic(&self.root.join(STATE_FILE), &data)
    }
}

fn note_files(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| is_note_file(p))
                .collect()
        })
        .unwrap_or_default()
}

fn is_note_file(p: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    !name.starts_with('.') && p.extension().is_some_and(|e| e == "md") && p.is_file()
}

/// Lee todas las notas en paralelo.
fn load_dir(dir: &Path) -> Vec<Note> {
    let paths = note_files(dir);
    let threads = std::thread::available_parallelism().map_or(2, |n| n.get()).min(8);
    let chunk = paths.len().div_ceil(threads).max(64);
    std::thread::scope(|s| {
        let handles: Vec<_> = paths
            .chunks(chunk)
            .map(|part| s.spawn(move || part.iter().filter_map(|p| Note::load(p).ok()).collect::<Vec<_>>()))
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

/// Escritura atómica: fichero temporal + fsync + rename. Un corte de luz
/// deja la versión anterior o la nueva, nunca un fichero a medias.
fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn modified(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}

fn not_found() -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, "nota no encontrada")
}

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("qn-test-{name}-{}", now_ms()));
        (Store::open(dir.clone()).unwrap(), dir)
    }

    fn input(id: &str, title: &str, body: &str) -> NoteInput {
        NoteInput { id: id.into(), title: title.into(), body: body.into(), pinned: false }
    }

    #[test]
    fn save_rename_delete_restore() {
        let (mut store, dir) = temp_store("save");
        let m = store.save(input("n1", "", "MongoDB tips\nusar índices #backend"), false).unwrap();
        assert_eq!(m.file, "mongodb-tips.md");
        assert_eq!(m.tags, vec!["backend"]);

        let m = store.save(input("n1", "Mongo", "otro"), false).unwrap();
        assert_eq!(m.file, "mongo.md");
        assert!(!dir.join("mongodb-tips.md").exists());

        let m2 = store.save(input("n2", "Mongo", "duplicado"), false).unwrap();
        assert_eq!(m2.file, "mongo-2.md");

        store.delete("n1").unwrap();
        assert!(store.get("n1").is_none());
        let restored = store.restore("n1").unwrap();
        assert_eq!(restored.file, "mongo.md");

        let mut reopened = Store::open(dir.clone()).unwrap();
        assert_eq!(reopened.list().len(), 2);
        assert_eq!(reopened.get("n1").unwrap().body, "otro");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn detects_external_files() {
        let (mut store, dir) = temp_store("sync");
        assert!(store.list().is_empty());
        fs::write(dir.join("linux.md"), "# Comandos\nls -la #linux").unwrap();
        assert!(store.sync_disk().unwrap());
        let all = store.list();
        assert_eq!(all[0].title, "Comandos");
        assert_eq!(all[0].id, "f-linux");
        fs::remove_dir_all(dir).unwrap();
    }
}
