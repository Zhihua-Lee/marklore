//! desktop/snippet.mjs: windows of Markdown that never cut a formula, code
//! span, link, tag or emphasis in half. Positions are UTF-16 offsets.

use crate::fast;
use crate::js::{self, Offsets};
use fancy_regex::Regex;
use std::sync::LazyLock;

pub const INLINE_MATH: &str = r"(?<![\\$])\$(?=[^\s$])(?:[^$\\\n]|\\.)+?(?<=[^\s\\])\$(?!\d)";

const TAGS: [&str; 20] = [
    "span", "mark", "sub", "sup", "u", "kbd", "a", "font", "small", "big", "b", "i", "s", "del",
    "ins", "em", "strong", "code", "q", "abbr",
];

// snippet.mjs SPANS without lookaround or backreferences; the others are in
// fast.rs.
// Each with text a match must hold, to skip the pattern when it is absent.
static SPANS: LazyLock<Vec<(&'static str, Regex)>> = LazyLock::new(|| {
    // <(span|…)\b[^>]*>[\s\S]*?<\/\1\s*> with the i flag, one branch per tag;
    // "\b[^>]*>" after a tag name is "(?:>|[^>\w][^>]*>)".
    let tags = TAGS
        .iter()
        .map(|t| format!(r"<{t}(?:>|[^>\w][^>]*>)[\s\S]*?<\/{t}\s*>"))
        .collect::<Vec<_>>()
        .join("|");
    vec![
        ("$$", js::re(r"\$\$[\s\S]+?\$\$")),
        ("\\[", js::re(r"\\\[[\s\S]+?\\\]")),
        ("\\(", js::re(r"\\\([\s\S]+?\\\)")),
        ("](", js::re(r"!?\[(?:[^[\]\n]|\[[^\]\n]*\])*\]\([^)\n]*\)")),
        ("<", js::re_i(&tags)),
        ("<", js::re_i(r"<\/?[a-z][^>\n]*>")),
    ]
});
static BEGIN: LazyLock<Regex> = LazyLock::new(|| js::re(r"\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}"));

pub type Span = (i64, i64);

pub fn protected_spans(text: &str) -> Vec<Span> {
    let offsets = Offsets::new(text);
    let mut spans = Vec::new();
    let mut found: Vec<(usize, usize)> = Vec::new();
    for (needle, re) in SPANS.iter() {
        if memchr::memmem::find(text.as_bytes(), needle.as_bytes()).is_some() {
            found.extend(js::find_all(re, text));
        }
    }
    if memchr::memmem::find(text.as_bytes(), b"\\begin{").is_some() {
        found.extend(js::find_all(&BEGIN, text));
    }
    found.extend(fast::inline_math(text));
    found.extend(fast::ticks(text));
    found.extend(fast::emphasis_span(text));
    for (a, b) in found {
        if b > a {
            spans.push((offsets.at(a), offsets.at(b)));
        }
    }
    spans.sort_by(|x, y| x.0.cmp(&y.0).then(y.1.cmp(&x.1)));
    spans
}

pub fn safe_window(len: i64, mut start: i64, mut end: i64, keep: Span, max_span: i64, spans: &[Span]) -> Span {
    let mut changed = true;
    let mut round = 0;
    while changed && round < 12 {
        changed = false;
        for &(a, b) in spans {
            let at_start = a < start && start < b;
            let at_end = a < end && end < b;
            if !at_start && !at_end {
                continue;
            }
            let holds_hit = a < keep.1.max(keep.0 + 1) && b > keep.0;
            if holds_hit || b - a <= max_span {
                start = start.min(a);
                end = end.max(b);
            } else {
                if at_start {
                    start = b;
                }
                if at_end {
                    end = a;
                }
            }
            changed = true;
        }
        round += 1;
    }
    (start.max(0), len.min(start.max(end)))
}

pub fn safe_truncate(text: &str, max: i64) -> Vec<u16> {
    let u = js::utf16(text);
    let len = u.len() as i64;
    if len <= max {
        return u;
    }
    let spans = protected_spans(text);
    let (_, mut end) = safe_window(len, 0, max - 1, (0, 0), 240, &spans);
    if end > max * 2 {
        if let Some(&(a, _)) = spans.iter().find(|&&(a, b)| a > 0 && a < max && b > max) {
            end = a;
        }
    }
    let mut cut = js::trim_end16(js::slice16(&u, 0, end)).to_vec();
    if end < len {
        cut.push('…' as u16);
    }
    cut
}
