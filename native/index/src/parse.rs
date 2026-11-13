//! desktop/link-index.mjs `parseNote` and desktop/slug.mjs: a note's links
//! to local notes and its anchors, read from the Markdown source.

use crate::fast;
use crate::js::{self, len16, trim, Offsets};
use crate::paths;
use crate::snippet::{protected_spans, safe_truncate, safe_window};
use fancy_regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

const SNIPPET_BEFORE: i64 = 90;
const SNIPPET_AFTER: i64 = 150;

pub const LINK_SRC: &str =
    r#"(!?)\[((?:[^[\]\n]|\[[^\]\n]*\])*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)"#;
pub const ATX_SRC: &str = r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$";
pub const FENCE_SRC: &str = r"^ {0,3}(`{3,}|~{3,})";

pub static LINK: LazyLock<Regex> = LazyLock::new(|| js::re(LINK_SRC));
// The JavaScript patterns, with "\b" after a tag name written out: the name
// is followed by a character that is not a word character.
// <[a-z][a-z0-9]*\b[^>]*?\sid\s*=\s*["']([^"']+)["'][^>]*>  (i)
static ANCHOR: LazyLock<Regex> = LazyLock::new(|| {
    js::re_i(r#"<[a-z][a-z0-9]*(?:\sid|[^>\w][^>]*?\sid)\s*=\s*["']([^"']+)["'][^>]*>"#)
});
pub static ATX: LazyLock<Regex> = LazyLock::new(|| js::re(ATX_SRC));
pub static FENCE: LazyLock<Regex> = LazyLock::new(|| js::re(FENCE_SRC));
// <a\b[^>]*>\s*<\/a>  (i)
static EMPTY_A: LazyLock<Regex> = LazyLock::new(|| js::re_i(r"<a(?:>|[^>\w][^>]*>)\s*<\/a>"));
static CLOSE_A: LazyLock<Regex> = LazyLock::new(|| js::re_i(r"<\/a>"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| js::re(r"\s+"));
static HTML_TEST: LazyLock<Regex> = LazyLock::new(|| js::re_i(r"<[a-z/][^>]*>"));
static HTML_TAG: LazyLock<Regex> = LazyLock::new(|| js::re(r"<[^>]+>"));
static BOLD_LEAD: LazyLock<Regex> =
    LazyLock::new(|| js::re(r"^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*(.+?)\*\*"));
static TRAILING: LazyLock<Regex> = LazyLock::new(|| js::re(r"[。．.:：，,；;]+$"));
static LISTLIKE: LazyLock<Regex> = LazyLock::new(|| js::re(r"^\s*([-*+>|]|\d+[.)])\s"));
static SETEXT: LazyLock<Regex> = LazyLock::new(|| js::re(r"^ {0,3}(=+|-+)\s*$"));
static SCHEME: LazyLock<Regex> = LazyLock::new(|| js::re_i(r"^[a-z][a-z0-9+.-]*:"));
static SLUG_STRIP: LazyLock<Regex> =
    LazyLock::new(|| js::build(&format!(r"[^\p{{L}}\p{{N}}{}_-]", js::WS)));

#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub target: String,
    pub fragment: String,
    pub text: String,
    pub line: u32,
    pub column: u32,
    pub section: String,
    pub snippet: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Anchor {
    pub id: String,
    pub heading_kind: bool,
    pub level: u32,
    pub line: u32,
    pub label: Vec<u16>,
    /// Explicit anchors: the section they are in, and the heading they mark.
    pub section: String,
    pub heading: Option<String>,
}

pub fn markdown_path(p: &str) -> bool {
    let l = p.to_ascii_lowercase();
    [".md", ".markdown", ".mdown", ".mkd", ".txt"].iter().any(|e| l.ends_with(e))
}

pub fn heading_slug(text: &str) -> String {
    let lower = text.to_lowercase();
    let kept = SLUG_STRIP.replace_all(&lower, "");
    let slug = js::replace_all(&SPACES, trim(&kept), "-");
    if slug.is_empty() {
        "section".into()
    } else {
        slug
    }
}

#[derive(Default)]
pub struct Slugger {
    seen: HashMap<String, u32>,
}

impl Slugger {
    pub fn slug(&mut self, text: &str) -> String {
        let slug = heading_slug(text);
        let count = self.seen.get(&slug).copied().unwrap_or(0);
        self.seen.insert(slug.clone(), count + 1);
        if count > 0 {
            format!("{slug}-{count}")
        } else {
            slug
        }
    }
}

/// Inline code keeps its width but cannot hold links.
fn blank_code(line: &str) -> String {
    let spans = fast::code_span(line);
    if spans.is_empty() {
        return line.to_string();
    }
    let mut out = String::with_capacity(line.len());
    let mut last = 0;
    for (a, b) in spans {
        out.push_str(&line[last..a]);
        out.push_str(&" ".repeat(len16(&line[a..b])));
        last = b;
    }
    out.push_str(&line[last..]);
    out
}

/// The first character after up to three spaces (ATX and FENCE need one).
fn lead(line: &str) -> Option<u8> {
    line.bytes().take(4).find(|&b| b != b' ')
}

/// ATX.exec(line)
pub fn atx(line: &str) -> Option<fancy_regex::Captures<'_>> {
    if lead(line) != Some(b'#') {
        return None;
    }
    ATX.captures(line).unwrap()
}

/// FENCE.exec(line)
pub fn fence_open(line: &str) -> Option<fancy_regex::Captures<'_>> {
    if !matches!(lead(line), Some(b'`' | b'~')) {
        return None;
    }
    FENCE.captures(line).unwrap()
}

// Quick checks before a pattern runs: each needs a character most lines lack.
fn has_tag(s: &str) -> bool {
    memchr::memchr(b'<', s.as_bytes()).is_some()
}

fn drop_empty_a(s: &str) -> String {
    if has_tag(s) {
        js::replace_all(&EMPTY_A, s, "")
    } else {
        s.to_string()
    }
}

fn link_text(text: &str) -> String {
    if memchr::memmem::find(text.as_bytes(), b"](").is_none() {
        return text.to_string();
    }
    LINK.replace_all(text, |c: &fancy_regex::Captures| {
        if c[1].is_empty() {
            c[2].to_string()
        } else {
            String::new()
        }
    })
    .into_owned()
}

pub fn plain_text(text: &str) -> String {
    let t = drop_empty_a(&link_text(text));
    let t = fast::remove(&t, &fast::plain_marks(&t));
    let t = js::replace_all(&SPACES, &t, " ");
    trim(&t).to_string()
}

fn heading_label(raw: &str) -> String {
    if has_tag(raw) && HTML_TEST.is_match(raw).unwrap() {
        js::replace_all(&HTML_TAG, raw, "")
    } else {
        raw.to_string()
    }
}

fn anchor_label(line: &str) -> Vec<u16> {
    let line = drop_empty_a(line);
    let bold = BOLD_LEAD.captures(&line).unwrap();
    let source = match &bold {
        Some(c) => c.get(1).unwrap().as_str(),
        None => line.as_str(),
    };
    let text = js::replace_all(&TRAILING, &plain_text(source), "");
    safe_truncate(&text, 40)
}

fn snippet_around(paragraph: &str, start: i64, end: i64, hit: &str) -> Vec<u16> {
    let clean = |s: &str| drop_empty_a(&link_text(s));
    let sb = js::byte_at16(paragraph, start);
    let eb = js::byte_at16(paragraph, end);
    let before = clean(&paragraph[..sb]);
    let text = format!("{before}{hit}{}", clean(&paragraph[eb..]));
    let u = js::utf16(&text);
    let len = u.len() as i64;
    let from = len16(&before) as i64;
    let to = from + len16(hit) as i64;
    let mut first = 0i64;
    let mut last = len;
    if from > SNIPPET_BEFORE {
        first = from - SNIPPET_BEFORE;
        let stops: Vec<u16> = js::utf16("，。；,.;");
        if let Some(space) = js::slice16(&u, first, first + 30)
            .iter()
            .position(|&c| js::is_ws16(c) || stops.contains(&c))
        {
            first += space as i64 + 1;
        }
    }
    if len - to > SNIPPET_AFTER {
        last = to + SNIPPET_AFTER;
        let tail = js::slice16(&u, to, last);
        let stop = js::last_index_of16(tail, &js::utf16("。")).max(js::last_index_of16(tail, &js::utf16(". ")));
        if stop > 60 {
            last = to + stop + 1;
        }
    }
    let spans = protected_spans(&text);
    (first, last) = safe_window(len, first, last, (from, to), 240, &spans);
    let mut out: Vec<u16> = Vec::new();
    if first > 0 {
        out.push('…' as u16);
    }
    out.extend_from_slice(js::trim_start16(js::slice16(&u, first, from)));
    out.extend(js::utf16("<mark class=\"backlink-hit\">"));
    out.extend(js::utf16(hit));
    out.extend(js::utf16("</mark>"));
    out.extend_from_slice(js::trim_end16(js::slice16(&u, to, last)));
    let ends_stop = js::slice16(&u, 0, last)
        .last()
        .is_some_and(|&c| c == '。' as u16 || c == '.' as u16);
    if last < len && !ends_stop {
        out.push('…' as u16);
    }
    out
}

pub struct Parsed {
    pub links: Vec<Link>,
    pub anchors: Vec<Anchor>,
}

pub fn parse_note(text: &str, file: &str) -> Parsed {
    let lines = js::split_lines(text);
    let n = lines.len();
    let mut links = Vec::new();
    let mut anchors: Vec<Anchor> = Vec::new();
    let mut slugger = Slugger::default();
    let mut section = String::new();
    let mut pending: Vec<usize> = Vec::new();
    // Paragraph boundaries for snippets: blank lines, headings and fences.
    let bound: Vec<bool> = lines
        .iter()
        .map(|l| trim(l).is_empty() || atx(l).is_some() || fence_open(l).is_some())
        .collect();
    let boundary = |i: usize| i >= n || bound[i];
    let mut code = vec![false; n];
    let mut fence: Option<String> = None;
    for i in 0..n {
        let open = fence_open(lines[i]);
        let open = open.as_ref().map(|c| c.get(1).unwrap().as_str());
        if let Some(f) = &fence {
            code[i] = true;
            if let Some(o) = open {
                if o.as_bytes()[0] == f.as_bytes()[0] && o.len() >= f.len() {
                    fence = None;
                }
            }
            continue;
        }
        if let Some(o) = open {
            fence = Some(o.to_string());
            code[i] = true;
        }
    }
    let file_dir = paths::dirname(file);
    let mut i = 0;
    while i < n {
        if code[i] {
            i += 1;
            continue;
        }
        let line = lines[i];
        let atx = atx(line);
        let setext = atx.is_none()
            && i + 1 < n
            && !code[i + 1]
            && !trim(line).is_empty()
            && !LISTLIKE.is_match(line).unwrap()
            && SETEXT.is_match(lines[i + 1]).unwrap();
        if atx.is_some() || setext {
            let raw = match &atx {
                Some(c) => c.get(2).map_or("", |m| m.as_str()),
                None => trim(line),
            };
            let id = slugger.slug(&heading_label(raw));
            section = plain_text(raw);
            let level = match &atx {
                Some(c) => c.get(1).unwrap().as_str().len() as u32,
                None => {
                    if trim(lines[i + 1]).starts_with('=') {
                        1
                    } else {
                        2
                    }
                }
            };
            anchors.push(Anchor {
                id: id.clone(),
                heading_kind: true,
                level,
                line: i as u32 + 1,
                label: js::utf16(&section),
                section: String::new(),
                heading: None,
            });
            for &a in &pending {
                anchors[a].heading = Some(id.clone());
            }
            pending.clear();
            if setext {
                i += 1;
            }
            i += 1;
            continue;
        }
        let stripped = blank_code(line);
        let mut own = 0;
        for c in ANCHOR.captures_iter(if has_tag(&stripped) { &stripped } else { "" }) {
            let c = c.unwrap();
            own += 1;
            anchors.push(Anchor {
                id: c[1].to_string(),
                heading_kind: false,
                level: 0,
                line: i as u32 + 1,
                label: Vec::new(),
                section: section.clone(),
                heading: None,
            });
            pending.push(anchors.len() - 1);
        }
        let only_anchors = own > 0 && {
            let rest = js::replace_all(&ANCHOR, &stripped, "");
            trim(&js::replace_all(&CLOSE_A, &rest, "")).is_empty()
        };
        if !only_anchors && !trim(line).is_empty() {
            if !pending.is_empty() {
                let label = anchor_label(line);
                for &a in &pending {
                    anchors[a].label = label.clone();
                }
            }
            pending.clear();
        }
        let offsets = Offsets::new(&stripped);
        for c in LINK.captures_iter(&stripped) {
            let c = c.unwrap();
            if !c[1].is_empty() {
                continue;
            }
            let mut href = &c[3];
            if href.starts_with('<') {
                href = &href[1..href.len() - 1];
            }
            if SCHEME.is_match(href).unwrap() {
                continue;
            }
            let (target, fragment) = match href.find('#') {
                Some(h) => (&href[..h], &href[h + 1..]),
                None => (href, ""),
            };
            let (Ok(target), Ok(fragment)) = (js::decode_uri(target, ""), js::decode_uri(fragment, ""))
            else {
                continue;
            };
            if !target.is_empty() && !markdown_path(&target) {
                continue;
            }
            if target.is_empty() && fragment.is_empty() {
                continue;
            }
            let mut top = i;
            let mut bottom = i;
            while top > 0 && !boundary(top - 1) && !code[top - 1] {
                top -= 1;
            }
            while bottom + 1 < n && !boundary(bottom + 1) && !code[bottom + 1] {
                bottom += 1;
            }
            let before = lines[top..i].join(" ");
            let offset = if before.is_empty() { 0 } else { len16(&before) as i64 + 1 };
            let paragraph = lines[top..=bottom].join(" ");
            let m = c.get(0).unwrap();
            let at = offsets.at(m.start());
            let end = offsets.at(m.end());
            links.push(Link {
                target: if target.is_empty() {
                    paths::resolve(&[file])
                } else {
                    paths::resolve(&[&file_dir, &target])
                },
                fragment,
                text: c[2].to_string(),
                line: i as u32 + 1,
                column: at as u32 + 1,
                section: section.clone(),
                snippet: snippet_around(&paragraph, offset + at, offset + end, &c[2]),
            });
        }
        i += 1;
    }
    Parsed { links, anchors }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(heading_slug("Parseval's identity"), "parsevals-identity");
        assert_eq!(heading_slug("Lemma B.7 — Hoeffding’s Lemma"), "lemma-b7-hoeffdings-lemma");
        assert_eq!(heading_slug("常用 性质"), "常用-性质");
        assert_eq!(heading_slug("!!!"), "section");
        let mut s = Slugger::default();
        assert_eq!(s.slug("定义"), "定义");
        assert_eq!(s.slug("定义"), "定义-1");
    }

    #[test]
    fn links_and_anchors() {
        let note = [
            "# Sep 29 — Hoeffding’s Lemma",
            "",
            "此前的 [Hoeffding 不等式](./Sep01.md#hoeffding)控制样本平均偏离期望的概率。",
            "",
            "<a id=\"hoeffding-lemma\"></a>",
            "",
            "## Lemma B.7 — Hoeffding’s Lemma",
            "",
            "<a id=\"erm\"></a>",
            "",
            "**Definition（ERM）。** 经验风险最小化选取 $h_S$，见 [Sep27](Sep27.md)。",
            "",
            "```markdown",
            "[not a link](Ignored.md)",
            "```",
            "",
            "Code `[inline](Nope.md)`, an ![image](pic.md), [web](https://example.com) and [mail](mailto:a@b.c).",
            "",
            "Setext heading",
            "--------------",
            "",
            "Back to [the lemma](#hoeffding-lemma) and [space](<My Note.md#Part%20Two>).",
        ]
        .join("\n");
        let file = if cfg!(windows) { "C:\\kb\\Sep29.md" } else { "/kb/Sep29.md" };
        let p = parse_note(&note, file);
        let got: Vec<_> = p
            .links
            .iter()
            .map(|l| (paths::basename(&l.target), l.fragment.clone(), l.text.clone(), l.line))
            .collect();
        assert_eq!(
            got,
            vec![
                ("Sep01.md".into(), "hoeffding".into(), "Hoeffding 不等式".into(), 3),
                ("Sep27.md".into(), "".into(), "Sep27".into(), 11),
                ("Sep29.md".into(), "hoeffding-lemma".into(), "the lemma".into(), 22),
                ("My Note.md".into(), "Part Two".into(), "space".into(), 22),
            ]
        );
        assert_eq!(p.links[0].column, 5);
        assert_eq!(p.links[1].section, "Lemma B.7 — Hoeffding’s Lemma");
        let snip = String::from_utf16(&p.links[0].snippet).unwrap();
        assert!(snip.starts_with("此前的 <mark class=\"backlink-hit\">Hoeffding 不等式</mark>控制"), "{snip}");
        let erm = p.anchors.iter().find(|a| a.id == "erm").unwrap();
        assert_eq!(String::from_utf16(&erm.label).unwrap(), "Definition（ERM）");
        let lemma = p.anchors.iter().find(|a| a.id == "hoeffding-lemma").unwrap();
        assert_eq!(lemma.heading.as_deref(), Some("lemma-b7-hoeffdings-lemma"));
        assert!(p.anchors.iter().any(|a| a.id == "setext-heading" && a.level == 2));
    }
}
