//! desktop/note-search.mjs: ranking every note for a query, and the lines
//! and snippets of the notes shown. Terms come lower-cased from parseQuery.

use crate::fast;
use crate::js::{self, Offsets};
use crate::parse::{atx, fence_open};
use crate::snippet::{protected_spans, safe_window};
use fancy_regex::Regex;
use memchr::memmem;
use std::sync::LazyLock;

const BEFORE: i64 = 24;
const WIDTH: i64 = 96;

static TABLE_ROW: LazyLock<Regex> = LazyLock::new(|| js::re(r"^\s*\|.*\|\s*$"));
static HEAD_MARK: LazyLock<Regex> = LazyLock::new(|| js::re(r"^\s{0,3}(?:#{1,6}\s+|>\s?)+"));
static LIST_MARK: LazyLock<Regex> =
    LazyLock::new(|| js::re(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?"));
static IMAGE: LazyLock<Regex> = LazyLock::new(|| js::re(r"!\[([^\]\n]*)\]\([^)\n]*\)"));
static LINK: LazyLock<Regex> =
    LazyLock::new(|| js::re(r#"\[([^\]\n]*)\]\((<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)"#));
static TAG: LazyLock<Regex> = LazyLock::new(|| js::re_i(r"<\/?[a-z][^>\n]*>"));
static TICKS: LazyLock<Regex> = LazyLock::new(|| js::re(r"`+"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| js::re(r"\s+"));
static ANGLE: LazyLock<Regex> = LazyLock::new(|| js::re(r"^<|>$"));

/// What a line reads as once rendered (note-search.mjs `readable`).
pub fn readable(line: &str, targets: bool) -> String {
    let mut line = line.to_string();
    if TABLE_ROW.is_match(&line).unwrap() {
        let t = js::trim(&line);
        let inner = &t[1..t.len() - 1];
        // split(/(?<!\\)\|/)
        let mut cells = Vec::new();
        let mut from = 0;
        let b = inner.as_bytes();
        for (i, &c) in b.iter().enumerate() {
            if c == b'|' && (i == 0 || b[i - 1] != b'\\') {
                cells.push(&inner[from..i]);
                from = i + 1;
            }
        }
        cells.push(&inner[from..]);
        line = cells
            .into_iter()
            .map(js::trim)
            .filter(|c| !c.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
    }
    let text = js::replace_all(&HEAD_MARK, &line, "");
    let text = js::replace_all(&LIST_MARK, &text, "");
    let text = IMAGE.replace_all(&text, "$1").into_owned();
    let text = LINK
        .replace_all(&text, |c: &fancy_regex::Captures| {
            if targets {
                let href = js::replace_all(&ANGLE, &c[2], "");
                let shown = js::decode_uri(&href, ";/?:@&=+$,#").unwrap_or(href);
                format!("{} ({shown})", &c[1])
            } else {
                c[1].to_string()
            }
        })
        .into_owned();
    let text = js::replace_all(&TAG, &text, "");
    // Emphasis markers go outside formulas only.
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let plain = |part: &str| {
        let p = fast::remove(part, &fast::strong_marks(part));
        let p = fast::remove(&p, &fast::em_marks(&p));
        js::replace_all(&TICKS, &p, "")
    };
    for (a, b) in fast::math(&text) {
        out.push_str(&plain(&text[last..a]));
        out.push_str(&text[a..b]);
        last = b;
    }
    out.push_str(&plain(&text[last..]));
    let out = js::replace_all(&SPACES, &out, " ");
    js::trim(&out).to_string()
}

/// Every [start, end) (UTF-16) where a term occurs in lower-cased text, in
/// order and without overlaps.
fn occurrences(lower: &str, terms: &[String]) -> Vec<(i64, i64)> {
    let offsets = Offsets::new(lower);
    let mut found = Vec::new();
    for term in terms {
        let mut at = 0;
        while let Some(p) = memmem::find(&lower.as_bytes()[at..], term.as_bytes()) {
            let s = at + p;
            found.push((offsets.at(s), offsets.at(s + term.len())));
            at = s + term.len();
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for r in found {
        if merged.last().is_none_or(|m| r.0 >= m.1) {
            merged.push(r);
        }
    }
    merged
}

pub type Part = (Vec<u16>, bool);

fn snippet(text: &str, ranges: &[(i64, i64)]) -> Vec<Part> {
    let u = js::utf16(text);
    let len = u.len() as i64;
    let mut start = 0;
    let mut end = len;
    if len > WIDTH {
        if let Some(&first) = ranges.first() {
            start = (first.0 - BEFORE).max(0);
            end = len.min(start + WIDTH);
            start = start.min(end - WIDTH).max(0);
            (start, end) = safe_window(len, start, end, first, 240, &protected_spans(text));
        }
    }
    let mut parts: Vec<Part> = Vec::new();
    let mut at = start;
    for &(from, to) in ranges {
        if to <= start || from >= end {
            continue;
        }
        let a = from.max(start);
        let b = to.min(end);
        if a > at {
            parts.push((js::slice16(&u, at, a).to_vec(), false));
        }
        parts.push((js::slice16(&u, a, b).to_vec(), true));
        at = b;
    }
    if at < end {
        parts.push((js::slice16(&u, at, end).to_vec(), false));
    }
    if start > 0 {
        parts.insert(0, (js::utf16("…"), false));
    }
    if end < len {
        parts.push((js::utf16("…"), false));
    }
    parts
}

/// The name without ".md" or ".markdown", lower-cased.
pub fn bare_name(name: &str) -> String {
    let l = name.to_ascii_lowercase();
    let cut = if l.ends_with(".md") {
        name.len() - 3
    } else if l.ends_with(".markdown") {
        name.len() - 9
    } else {
        name.len()
    };
    name[..cut].to_lowercase()
}

/// note-search.mjs `rank`: None when a term is missing.
pub fn rank(bare: &str, lower: &str, terms: &[String]) -> Option<u32> {
    if terms.is_empty()
        || !terms
            .iter()
            .all(|t| bare.contains(t.as_str()) || memmem::find(lower.as_bytes(), t.as_bytes()).is_some())
    {
        return None;
    }
    let bytes = lower.as_bytes();
    let mut count = 0u32;
    let mut headings: Vec<usize> = Vec::new();
    for term in terms {
        let finder = memmem::Finder::new(term.as_bytes());
        let mut at = 0;
        while count < 200 {
            let Some(p) = finder.find(&bytes[at..]) else { break };
            let s = at + p;
            count += 1;
            let line = memchr::memrchr(b'\n', &bytes[..=s]).map_or(0, |x| x + 1);
            if bytes.get(line) == Some(&b'#') && !headings.contains(&line) {
                headings.push(line);
            }
            at = s + term.len();
        }
    }
    let name_hit = terms.iter().all(|t| bare.contains(t.as_str()));
    Some(if name_hit { 1000 } else { 0 } + headings.len() as u32 * 20 + count.min(100))
}

pub struct Hit {
    pub line: u32,
    pub column: u32,
    pub section: String,
    pub heading: bool,
    pub snippet: Vec<Part>,
}

pub struct Found {
    pub name_hit: bool,
    pub count: u32,
    pub hits: Vec<Hit>,
}

/// note-search.mjs `searchNote`: None when a term is missing.
pub fn search_note(name: &str, text: &str, lower_text: &str, terms: &[String], max_hits: usize) -> Option<Found> {
    let bare = bare_name(name);
    if terms.is_empty()
        || !terms
            .iter()
            .all(|t| bare.contains(t.as_str()) || memmem::find(lower_text.as_bytes(), t.as_bytes()).is_some())
    {
        return None;
    }
    let mut hits: Vec<(Hit, usize)> = Vec::new();
    let mut fence: Option<String> = None;
    let mut section = String::new();
    let mut count = 0u32;
    for (i, line) in js::split_lines(text).into_iter().enumerate() {
        let open = fence_open(line);
        let open = open.as_ref().map(|c| c.get(1).unwrap().as_str());
        let mut heading: Option<String> = None;
        if let Some(f) = &fence {
            if let Some(o) = open {
                if o.as_bytes()[0] == f.as_bytes()[0] && o.len() >= f.len() {
                    fence = None;
                }
            }
        } else if let Some(o) = open {
            fence = Some(o.to_string());
        } else if let Some(c) = atx(line) {
            heading = Some(readable(c.get(2).map_or("", |m| m.as_str()), false));
        }
        let lower = line.to_lowercase();
        if !terms.iter().any(|t| lower.contains(t.as_str())) {
            if let Some(h) = heading {
                section = h;
            }
            continue;
        }
        let raw = occurrences(&lower, terms);
        count += raw.len() as u32;
        let shown = readable(line, false);
        let mut display = shown;
        let mut ranges = occurrences(&display.to_lowercase(), terms);
        if ranges.is_empty() {
            display = readable(line, true);
            ranges = occurrences(&display.to_lowercase(), terms);
        }
        if ranges.is_empty() {
            display = js::trim(line).to_string();
            ranges = occurrences(&display.to_lowercase(), terms);
        }
        let distinct = terms.iter().filter(|t| lower.contains(t.as_str())).count();
        hits.push((
            Hit {
                line: i as u32 + 1,
                column: raw[0].0 as u32 + 1,
                section: if heading.is_some() { String::new() } else { section.clone() },
                heading: heading.is_some(),
                snippet: snippet(&display, &ranges),
            },
            distinct,
        ));
        if let Some(h) = heading {
            section = h;
        }
    }
    let name_hit = terms.iter().all(|t| bare.contains(t.as_str()));
    hits.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.line.cmp(&b.0.line)));
    hits.truncate(max_hits);
    hits.sort_by(|a, b| a.0.line.cmp(&b.0.line));
    Some(Found {
        name_hit,
        count,
        hits: hits.into_iter().map(|(h, _)| h).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_lines() {
        assert_eq!(readable("## A **bold** [link](x.md) `code`", false), "A bold link code");
        assert_eq!(readable("| a | b |", false), "a · b");
        assert_eq!(readable("$a_i^*$ and *em*", false), "$a_i^*$ and em");
        assert_eq!(readable("[x](a%20b.md)", true), "x (a b.md)");
    }

    #[test]
    fn ranking() {
        let terms = vec!["proof".to_string()];
        let text = "# proof\n\nproof and proof";
        assert_eq!(rank("note", &text.to_lowercase(), &terms), Some(20 + 3));
        assert_eq!(rank("proof", &text.to_lowercase(), &terms), Some(1000 + 20 + 3));
        assert_eq!(rank("x", "y", &terms), None);
    }
}
