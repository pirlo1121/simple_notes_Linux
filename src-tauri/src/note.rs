// Modelo de nota y formato de fichero.
//
// Cada nota es un Markdown legible fuera de la app:
//
//   ---
//   id: lx3k2-9f1a
//   title: "MongoDB"
//   created: 2026-09-24T10:12:00+02:00
//   updated: 2026-09-24T10:30:41+02:00
//   pinned: true
//   ---
//
//   contenido…
//
// `title` se omite cuando la nota no tiene título explícito: entonces se usa
// la primera línea del contenido. Los ficheros sin frontmatter también se leen.

use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, Local, SecondsFormat, TimeZone};
use serde::{Deserialize, Serialize};

use crate::tags;

pub const UNTITLED: &str = "Sin título";
const TITLE_MAX_CHARS: usize = 80;
const SNIPPET_MAX_CHARS: usize = 140;

#[derive(Debug, Clone)]
pub struct Note {
    pub id: String,
    /// Título explícito (puede estar vacío).
    pub title: String,
    pub body: String,
    pub created: i64,
    pub updated: i64,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub path: PathBuf,
    pub mtime: Option<SystemTime>,
    // Índice de búsqueda en minúsculas.
    pub title_lc: String,
    pub body_lc: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub created: i64,
    pub updated: i64,
    pub snippet: String,
    pub file: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDoc {
    #[serde(flatten)]
    pub meta: NoteMeta,
    pub raw_title: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NoteInput {
    pub id: String,
    pub title: String,
    pub body: String,
    pub pinned: bool,
}

impl Note {
    pub fn new(
        id: String,
        title: String,
        body: String,
        created: i64,
        updated: i64,
        pinned: bool,
        path: PathBuf,
    ) -> Self {
        let mut note = Note {
            id,
            title,
            body,
            created,
            updated,
            pinned,
            tags: Vec::new(),
            path,
            mtime: None,
            title_lc: String::new(),
            body_lc: String::new(),
        };
        note.reindex();
        note
    }

    fn reindex(&mut self) {
        self.tags = tags::extract(&self.title, &self.body);
        self.title_lc = self.display_title().to_lowercase();
        self.body_lc = self.body.to_lowercase();
    }

    pub fn display_title(&self) -> String {
        if !self.title.is_empty() {
            return self.title.clone();
        }
        let derived = derive_title(&self.body);
        if derived.is_empty() {
            UNTITLED.to_string()
        } else {
            derived
        }
    }

    pub fn snippet(&self) -> String {
        let mut lines = self.body.lines().map(str::trim).filter(|l| !l.is_empty());
        if self.title.is_empty() {
            lines.next(); // la primera línea ya es el título
        }
        let joined = lines.take(4).collect::<Vec<_>>().join("  ");
        truncate_chars(&joined, SNIPPET_MAX_CHARS)
    }

    pub fn meta(&self) -> NoteMeta {
        NoteMeta {
            id: self.id.clone(),
            title: self.display_title(),
            pinned: self.pinned,
            tags: self.tags.clone(),
            created: self.created,
            updated: self.updated,
            snippet: self.snippet(),
            file: self
                .path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        }
    }

    pub fn doc(&self) -> NoteDoc {
        NoteDoc {
            meta: self.meta(),
            raw_title: self.title.clone(),
            body: self.body.clone(),
        }
    }

    pub fn load(path: &Path) -> io::Result<Note> {
        let raw = fs::read_to_string(path)?;
        let meta = fs::metadata(path)?;
        let mtime = meta.modified().ok();
        let modified_ms = mtime.and_then(system_ms).unwrap_or_else(now_ms);
        let created_ms = meta.created().ok().and_then(system_ms).unwrap_or(modified_ms);

        let (fields, body) = split_frontmatter(&raw);
        let get = |key: &str| field(&fields, key);
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();

        let id = get("id")
            .map(safe_component)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("f-{}", safe_component(&stem)));
        let title = get("title").map(sanitize_title).unwrap_or_default();
        let created = get("created").and_then(parse_ts).unwrap_or(created_ms);
        let updated = get("updated").and_then(parse_ts).unwrap_or(modified_ms);
        let pinned = get("pinned").is_some_and(|v| matches!(v, "true" | "yes" | "1"));

        let mut note = Note::new(
            id,
            title,
            body.to_string(),
            created,
            updated,
            pinned,
            path.to_path_buf(),
        );
        note.mtime = mtime;
        Ok(note)
    }

    pub fn to_markdown(&self) -> String {
        let mut s = String::with_capacity(self.body.len() + 192);
        s.push_str("---\n");
        s.push_str(&format!("id: {}\n", self.id));
        if !self.title.is_empty() {
            // Una cadena JSON es también un escalar YAML válido.
            let quoted = serde_json::to_string(&self.title).unwrap_or_default();
            s.push_str(&format!("title: {quoted}\n"));
        }
        s.push_str(&format!("created: {}\n", format_ts(self.created)));
        s.push_str(&format!("updated: {}\n", format_ts(self.updated)));
        if self.pinned {
            s.push_str("pinned: true\n");
        }
        s.push_str("---\n\n");
        s.push_str(&self.body);
        s
    }
}

/// Primera línea con texto, sin marcas de Markdown (#, >, -, [ ]).
pub fn derive_title(body: &str) -> String {
    for line in body.lines() {
        let mut t = line.trim().trim_start_matches(['#', '>']).trim();
        for marker in ["- [ ] ", "- [x] ", "- ", "* ", "+ "] {
            if let Some(rest) = t.strip_prefix(marker) {
                t = rest.trim();
                break;
            }
        }
        if !t.is_empty() {
            return truncate_chars(t, TITLE_MAX_CHARS);
        }
    }
    String::new()
}

pub fn sanitize_title(title: &str) -> String {
    let single_line: String = title
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    truncate_chars(single_line.trim(), 200)
}

/// Solo [A-Za-z0-9_-]: seguro para usar como nombre de directorio.
pub fn safe_component(s: &str) -> String {
    s.trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// "Comandos Linux: SSH" -> "comandos-linux-ssh"
pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut len = 0;
    let mut pending_dash = false;
    for c in s.chars().flat_map(char::to_lowercase).map(fold_accent) {
        if c.is_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
                len += 1;
            }
            pending_dash = false;
            out.push(c);
            len += 1;
            if len >= 60 {
                break;
            }
        } else {
            pending_dash = true;
        }
    }
    if out.is_empty() {
        "nota".to_string()
    } else {
        out
    }
}

fn fold_accent(c: char) -> char {
    match c {
        'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        _ => c,
    }
}

pub fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((idx, _)) => format!("{}…", s[..idx].trim_end()),
        None => s.to_string(),
    }
}

/// Separa el frontmatter `---` del cuerpo. Devuelve pares clave/valor.
pub fn split_frontmatter(raw: &str) -> (Vec<(String, String)>, &str) {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let Some(rest) = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))
    else {
        return (Vec::new(), raw);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let fields = parse_fields(&rest[..offset]);
            let body = &rest[offset + line.len()..];
            let body = body
                .strip_prefix("\r\n")
                .or_else(|| body.strip_prefix('\n'))
                .unwrap_or(body);
            return (fields, body);
        }
        offset += line.len();
    }
    (Vec::new(), raw)
}

fn field<'a>(fields: &'a [(String, String)], key: &str) -> Option<&'a str> {
    fields.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn parse_fields(block: &str) -> Vec<(String, String)> {
    block
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let value = value.trim();
            let value = if value.starts_with('"') {
                serde_json::from_str::<String>(value)
                    .unwrap_or_else(|_| value.trim_matches('"').to_string())
            } else if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
                value[1..value.len() - 1].replace("''", "'")
            } else {
                value.to_string()
            };
            Some((key.trim().to_string(), value))
        })
        .collect()
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn system_ms(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn format_ts(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|d| d.to_rfc3339_opts(SecondsFormat::Secs, false))
        .unwrap_or_default()
}

fn parse_ts(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .map(|d| d.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_roundtrip() {
        let n = Note::new(
            "abc".into(),
            "Título: \"raro\"".into(),
            "hola #rust\n".into(),
            1_700_000_000_000,
            1_700_000_100_000,
            true,
            PathBuf::from("x.md"),
        );
        let md = n.to_markdown();
        let (fields, body) = split_frontmatter(&md);
        assert_eq!(body, "hola #rust\n");
        let title = fields.iter().find(|(k, _)| k == "title").unwrap();
        assert_eq!(title.1, "Título: \"raro\"");
        assert_eq!(parse_ts(&format_ts(n.created)), Some(n.created));
    }

    #[test]
    fn plain_markdown_has_no_frontmatter() {
        let (fields, body) = split_frontmatter("# Hola\ntexto");
        assert!(fields.is_empty());
        assert_eq!(body, "# Hola\ntexto");
    }

    #[test]
    fn slugs_and_titles() {
        assert_eq!(slugify("Comandos Linux: SSH & más"), "comandos-linux-ssh-mas");
        assert_eq!(slugify("!!!"), "nota");
        assert_eq!(derive_title("\n\n## - [ ] Comprar café\nresto"), "Comprar café");
    }
}
