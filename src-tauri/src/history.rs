// Historial de versiones: ~/.quicknotes/.history/<id>/<epoch_ms>.md
//
// Antes de sobrescribir una nota se copia la versión en disco, como mucho una
// vez cada 5 minutos. Así cada sesión de edición deja un punto de restauración.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::note::{now_ms, safe_component, split_frontmatter, truncate_chars, Note};

pub const HISTORY_DIR: &str = ".history";
const MIN_INTERVAL_MS: i64 = 5 * 60 * 1000;
const MAX_VERSIONS: usize = 50;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub stamp: i64,
    pub size: u64,
    pub preview: String,
}

fn dir_for(root: &Path, id: &str) -> PathBuf {
    root.join(HISTORY_DIR).join(safe_component(id))
}

fn version_path(dir: &Path, stamp: i64) -> PathBuf {
    dir.join(format!("{stamp}.md"))
}

fn stamps(dir: &Path) -> Vec<i64> {
    let mut v: Vec<i64> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .filter_map(|e| e.path().file_stem()?.to_str()?.parse().ok())
                .collect()
        })
        .unwrap_or_default();
    v.sort_unstable();
    v
}

/// `force` ignora el intervalo mínimo (p. ej. antes de restaurar una versión).
pub fn snapshot(root: &Path, id: &str, current: &Path, force: bool) -> io::Result<()> {
    if !current.exists() {
        return Ok(());
    }
    let dir = dir_for(root, id);
    fs::create_dir_all(&dir)?;
    let existing = stamps(&dir);
    let now = now_ms();
    if !force && existing.last().is_some_and(|&last| now - last < MIN_INTERVAL_MS) {
        return Ok(());
    }
    fs::copy(current, version_path(&dir, now))?;
    let excess = (existing.len() + 1).saturating_sub(MAX_VERSIONS);
    for stamp in &existing[..excess] {
        let _ = fs::remove_file(version_path(&dir, *stamp));
    }
    Ok(())
}

pub fn list(root: &Path, id: &str) -> Vec<HistoryEntry> {
    let dir = dir_for(root, id);
    stamps(&dir)
        .into_iter()
        .rev()
        .filter_map(|stamp| {
            let raw = fs::read_to_string(version_path(&dir, stamp)).ok()?;
            let (_, body) = split_frontmatter(&raw);
            let flat = body.split_whitespace().collect::<Vec<_>>().join(" ");
            Some(HistoryEntry {
                stamp,
                size: raw.len() as u64,
                preview: truncate_chars(&flat, 120),
            })
        })
        .collect()
}

pub fn read(root: &Path, id: &str, stamp: i64) -> io::Result<Note> {
    Note::load(&version_path(&dir_for(root, id), stamp))
}
