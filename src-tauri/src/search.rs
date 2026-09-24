// Búsqueda en memoria. Recorre el índice en minúsculas de cada nota:
// con miles de notas sigue tardando pocos milisegundos por pulsación.
//
// Sintaxis: palabras (todas deben aparecer) y #etiquetas (prefijo).
//   "mongo #backend"  -> notas con #backend… que contengan "mongo"

use crate::note::{Note, NoteMeta};

pub struct Query {
    terms: Vec<String>,
    tags: Vec<String>,
}

impl Query {
    pub fn parse(q: &str) -> Self {
        let mut terms = Vec::new();
        let mut tags = Vec::new();
        for tok in q.to_lowercase().split_whitespace() {
            match tok.strip_prefix('#') {
                Some("") => {}
                Some(tag) => tags.push(tag.to_string()),
                None => terms.push(tok.to_string()),
            }
        }
        Query { terms, tags }
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty() && self.tags.is_empty()
    }

    fn score(&self, n: &Note) -> Option<i64> {
        for tag in &self.tags {
            if !n.tags.iter().any(|t| t.starts_with(tag.as_str())) {
                return None;
            }
        }
        let mut total = 0;
        for term in &self.terms {
            let t = term.as_str();
            total += if n.title_lc.starts_with(t) {
                120
            } else if let Some(pos) = n.title_lc.find(t) {
                if at_word_start(&n.title_lc, pos) { 90 } else { 70 }
            } else if n.tags.iter().any(|tag| tag.starts_with(t)) {
                50
            } else if let Some(pos) = n.body_lc.find(t) {
                let boundary = if at_word_start(&n.body_lc, pos) { 10 } else { 0 };
                let hits = n.body_lc.matches(t).take(5).count() as i64;
                20 + boundary + hits * 2
            } else if t.chars().count() >= 3 && is_subsequence(&n.title_lc, t) {
                10
            } else {
                return None;
            };
        }
        Some(total + if n.pinned { 5 } else { 0 })
    }

    /// Fragmento del contenido alrededor del primer término encontrado.
    fn snippet(&self, n: &Note) -> Option<String> {
        self.terms
            .iter()
            .filter(|t| n.body_lc.contains(t.as_str()))
            .find_map(|t| snippet_around(&n.body, t))
    }
}

pub fn search<'a>(notes: impl Iterator<Item = &'a Note>, query: &str, limit: usize) -> Vec<NoteMeta> {
    let q = Query::parse(query);
    let mut hits: Vec<(i64, &Note)> = notes.filter_map(|n| q.score(n).map(|s| (s, n))).collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.updated.cmp(&a.1.updated)));
    hits.truncate(limit);
    hits.into_iter()
        .map(|(_, n)| {
            let mut meta = n.meta();
            if let Some(s) = q.snippet(n) {
                meta.snippet = s;
            }
            meta
        })
        .collect()
}

fn at_word_start(hay: &str, pos: usize) -> bool {
    hay[..pos].chars().next_back().map_or(true, |c| !c.is_alphanumeric())
}

fn is_subsequence(hay: &str, needle: &str) -> bool {
    let mut it = hay.chars();
    needle.chars().all(|c| it.any(|h| h == c))
}

fn snippet_around(body: &str, term: &str) -> Option<String> {
    for line in body.lines() {
        let lc = line.to_lowercase();
        let Some(pos) = lc.find(term) else { continue };
        let chars: Vec<char> = line.trim_end().chars().collect();
        let at = lc[..pos].chars().count();
        let start = at.saturating_sub(40).min(chars.len());
        let end = (start + 140).min(chars.len());
        let mut s: String = chars[start..end].iter().collect::<String>().trim().to_string();
        if start > 0 {
            s.insert(0, '…');
        }
        if end < chars.len() {
            s.push('…');
        }
        return Some(s);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn note(id: &str, title: &str, body: &str) -> Note {
        Note::new(id.into(), title.into(), body.into(), 0, 0, false, PathBuf::from("x.md"))
    }

    #[test]
    fn ranks_title_above_body() {
        let notes = [
            note("a", "Recetas", "usar mongodb para guardar"),
            note("b", "MongoDB índices", "crear índices compuestos #backend"),
        ];
        let r = search(notes.iter(), "mongodb", 10);
        assert_eq!(r.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        let r = search(notes.iter(), "#back índices", 10);
        assert_eq!(r.len(), 1);
    }
}
