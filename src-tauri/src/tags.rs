// Detección de etiquetas (#backend, #linux/redes …).
// Debe mantenerse equivalente a src/utils/tags.ts.

use std::collections::BTreeSet;

pub fn extract(title: &str, body: &str) -> Vec<String> {
    let mut out = BTreeSet::new();
    scan_line(title, &mut out);
    let mut in_fence = false;
    for line in body.lines() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence {
            scan_line(line, &mut out);
        }
    }
    out.into_iter().collect()
}

fn is_boundary(c: char) -> bool {
    c.is_whitespace() || "([{,;:!¡¿?\"'".contains(c)
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

fn scan_line(line: &str, out: &mut BTreeSet<String>) {
    let chars: Vec<char> = line.chars().collect();
    let mut in_code = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '`' {
            in_code = !in_code;
            i += 1;
            continue;
        }
        if in_code || c != '#' || (i > 0 && !is_boundary(chars[i - 1])) {
            i += 1;
            continue;
        }
        let start = i + 1;
        let mut j = start;
        while j < chars.len() && is_tag_char(chars[j]) {
            j += 1;
        }
        let mut end = j;
        while end > start && matches!(chars[end - 1], '-' | '/') {
            end -= 1;
        }
        if end > start {
            let tag: String = chars[start..end].iter().collect();
            if is_tag(&tag) {
                out.insert(tag.to_lowercase());
            }
        }
        i = j.max(i + 1);
    }
}

/// Descarta números (#123) y colores hexadecimales (#1e1e2e).
fn is_tag(tag: &str) -> bool {
    if !tag.chars().any(char::is_alphabetic) {
        return false;
    }
    let is_hex_color = matches!(tag.len(), 3 | 4 | 6 | 8)
        && tag.chars().all(|c| c.is_ascii_hexdigit())
        && tag.chars().any(|c| c.is_ascii_digit());
    !is_hex_color
}

#[cfg(test)]
mod tests {
    use super::extract;

    #[test]
    fn detects_tags() {
        let body = "Ideas #Backend y #linux/redes.\n# Encabezado\n```\n#no\n```\n`#nocode` #1e1e2e #123 url.com/#x";
        assert_eq!(extract("", body), vec!["backend", "linux/redes"]);
    }
}
