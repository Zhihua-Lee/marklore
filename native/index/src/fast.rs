//! Hand-written matchers for the JavaScript patterns that need lookaround or
//! backreferences. Each finds what the JavaScript regular expression finds
//! (leftmost match, its alternatives in order, global iteration from the
//! end of the last match); a backtracking engine would be far slower here.
//! Ranges are byte offsets.

use crate::js::is_ws;
use memchr::memmem;

fn prev_char(s: &str, at: usize) -> Option<char> {
    s[..at].chars().next_back()
}

fn char_at(s: &str, at: usize) -> Option<char> {
    s[at..].chars().next()
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn line_end(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// All matches of a matcher tried at each char position from the end of the
/// previous match (a matcher returns the end of its match at `at`).
fn all(s: &str, starts: &[u8], mut at_pos: impl FnMut(&str, usize) -> Option<usize>) -> Vec<(usize, usize)> {
    let b = s.as_bytes();
    let mut found = Vec::new();
    let mut p = 0;
    while p < b.len() {
        // Only positions holding one of the start bytes can match.
        let next = match starts.len() {
            1 => memchr::memchr(starts[0], &b[p..]),
            2 => memchr::memchr2(starts[0], starts[1], &b[p..]),
            3 => memchr::memchr3(starts[0], starts[1], starts[2], &b[p..]),
            _ => b[p..].iter().position(|c| starts.contains(c)),
        };
        let Some(off) = next else { break };
        p += off;
        match at_pos(s, p) {
            Some(end) if end > p => {
                found.push((p, end));
                p = end;
            }
            _ => p += 1,
        }
    }
    found
}

/// `(?<![\\$])\$(?=[^\s$])(?:[^$\\\n]|\\.)+?(?<=[^\s\\])\$(?!\d)`
fn inline_math_at(s: &str, p: usize) -> Option<usize> {
    if let Some(c) = prev_char(s, p) {
        if c == '\\' || c == '$' {
            return None;
        }
    }
    let first = char_at(s, p + 1)?;
    if is_ws(first) || first == '$' {
        return None;
    }
    let mut j = p + 1;
    loop {
        let c = char_at(s, j)?;
        match c {
            '$' => {
                let before = prev_char(s, j)?;
                if is_ws(before) || before == '\\' {
                    return None;
                }
                if char_at(s, j + 1).is_some_and(|d| d.is_ascii_digit()) {
                    return None;
                }
                return Some(j + 1);
            }
            '\n' => return None,
            '\\' => {
                let d = char_at(s, j + 1)?;
                if line_end(d) {
                    return None;
                }
                j += 1 + d.len_utf8();
            }
            _ => j += c.len_utf8(),
        }
    }
}

pub fn inline_math(s: &str) -> Vec<(usize, usize)> {
    all(s, b"$", inline_math_at)
}

/// `\$\$[\s\S]+?\$\$|` + inline math.
pub fn math(s: &str) -> Vec<(usize, usize)> {
    all(s, b"$", |s, p| {
        if s[p..].starts_with("$$") {
            let from = p + 2 + char_at(s, p + 2).map_or(1, char::len_utf8);
            if from <= s.len() {
                if let Some(q) = memmem::find(&s.as_bytes()[from..], b"$$") {
                    return Some(from + q + 2);
                }
            }
        }
        inline_math_at(s, p)
    })
}

fn run_len(b: &[u8], p: usize) -> usize {
    b[p..].iter().take_while(|&&c| c == b'`').count()
}

/// ``(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)``: a code span (link-index blankCode).
pub fn code_span(s: &str) -> Vec<(usize, usize)> {
    let b = s.as_bytes();
    all(s, b"`", |_, p| {
        let k = run_len(b, p);
        if p + k >= b.len() {
            return None;
        }
        // The closing run: exactly k backticks, after a non-backtick, at
        // least one character after the opening.
        let mut q = p + k + 1;
        while q < b.len() {
            if b[q] == b'`' && b[q - 1] != b'`' {
                let m = run_len(b, q);
                if m == k {
                    return Some(q + k);
                }
                q += m;
            } else {
                q += 1;
            }
        }
        None
    })
}

/// ``(`+)[\s\S]+?\1``: code to keep whole in a snippet.
pub fn ticks(s: &str) -> Vec<(usize, usize)> {
    let b = s.as_bytes();
    all(s, b"`", |_, p| {
        let m = run_len(b, p);
        for k in (1..=m).rev() {
            // At least one character of content (any, a backtick included).
            let Some(c) = char_at(s, p + k) else { continue };
            let from = p + k + c.len_utf8();
            let needle = &b[p..p + k];
            if let Some(q) = memmem::find(&b[from..], needle) {
                return Some(from + q + k);
            }
        }
        None
    })
}

const DELIMS: [&str; 4] = ["**", "__", "~~", "=="];

/// `(\*\*|__|~~|==)(?=\S)[\s\S]+?(?<=\S)\1`: emphasis to keep whole.
pub fn emphasis_span(s: &str) -> Vec<(usize, usize)> {
    all(s, b"*_~=", emphasis_span_at)
}

fn emphasis_span_at(s: &str, p: usize) -> Option<usize> {
    let d = DELIMS.iter().find(|d| s[p..].starts_with(*d))?;
    let first = char_at(s, p + 2)?;
    if is_ws(first) {
        return None;
    }
    let from = p + 2 + first.len_utf8();
    let mut q = from;
    while let Some(off) = memmem::find(&s.as_bytes()[q..], d.as_bytes()) {
        let at = q + off;
        if prev_char(s, at).is_some_and(|c| !is_ws(c)) {
            return Some(at + 2);
        }
        q = at + 1;
    }
    None
}

/// `\*\*|__|(?<![\\$])[*_](?=\S)|(?<=\S)[*_]` (link-index plainText).
pub fn plain_marks(s: &str) -> Vec<(usize, usize)> {
    all(s, b"*_", |s, p| {
        if s[p..].starts_with("**") || s[p..].starts_with("__") {
            return Some(p + 2);
        }
        let prev = prev_char(s, p);
        let next = char_at(s, p + 1);
        if prev.is_none_or(|c| c != '\\' && c != '$') && next.is_some_and(|c| !is_ws(c)) {
            return Some(p + 1);
        }
        if prev.is_some_and(|c| !is_ws(c)) {
            return Some(p + 1);
        }
        None
    })
}

/// `(\*\*|__|~~|==)(?=\S)|(?<=\S)(\*\*|__|~~|==)` (note-search readable).
pub fn strong_marks(s: &str) -> Vec<(usize, usize)> {
    let at = |s: &str, p: usize| {
        DELIMS.iter().find(|d| s[p..].starts_with(*d))?;
        if char_at(s, p + 2).is_some_and(|c| !is_ws(c)) || prev_char(s, p).is_some_and(|c| !is_ws(c)) {
            return Some(p + 2);
        }
        None
    };
    all(s, b"*_~=", at)
}

/// `(?<![\\\w])[*_](?=\S)|(?<=\S)[*_](?!\w)` (note-search readable).
pub fn em_marks(s: &str) -> Vec<(usize, usize)> {
    all(s, b"*_", |s, p| {
        let prev = prev_char(s, p);
        let next = char_at(s, p + 1);
        if prev.is_none_or(|c| c != '\\' && !is_word(c)) && next.is_some_and(|c| !is_ws(c)) {
            return Some(p + 1);
        }
        if prev.is_some_and(|c| !is_ws(c)) && next.is_none_or(|c| !is_word(c)) {
            return Some(p + 1);
        }
        None
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::js;

    /// Each matcher against the JavaScript pattern run by fancy-regex, on
    /// random strings of the characters that matter.
    #[test]
    fn same_as_the_patterns() {
        let cases: [(&str, fn(&str) -> Vec<(usize, usize)>); 8] = [
            (r"(?<![\\$])\$(?=[^\s$])(?:[^$\\\n]|\\.)+?(?<=[^\s\\])\$(?!\d)", inline_math),
            (
                r"\$\$[\s\S]+?\$\$|(?<![\\$])\$(?=[^\s$])(?:[^$\\\n]|\\.)+?(?<=[^\s\\])\$(?!\d)",
                math,
            ),
            (r"(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)", code_span),
            (r"(`+)[\s\S]+?\1", ticks),
            (r"(\*\*|__|~~|==)(?=\S)[\s\S]+?(?<=\S)\1", emphasis_span),
            (r"\*\*|__|(?<![\\$])[*_](?=\S)|(?<=\S)[*_]", plain_marks),
            (r"(\*\*|__|~~|==)(?=\S)|(?<=\S)(\*\*|__|~~|==)", strong_marks),
            (r"(?<![\\\w])[*_](?=\S)|(?<=\S)[*_](?!\w)", em_marks),
        ];
        let alphabet: Vec<char> = "*_~=$`\\ a1\n\r中🙂\u{3000}\u{2028}".chars().collect();
        let mut seed = 0x2545f4914f6cdd1du64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for (src, f) in cases {
            let re = js::re(src);
            for _ in 0..40_000 {
                let len = (next() % 14) as usize;
                let s: String = (0..len).map(|_| alphabet[(next() % alphabet.len() as u64) as usize]).collect();
                assert_eq!(f(&s), js::find_all(&re, &s), "{src} on {s:?}");
            }
        }
    }
}

/// Remove these ranges from the text.
pub fn remove(s: &str, ranges: &[(usize, usize)]) -> String {
    if ranges.is_empty() {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for &(a, b) in ranges {
        out.push_str(&s[last..a]);
        last = b;
    }
    out.push_str(&s[last..]);
    out
}
