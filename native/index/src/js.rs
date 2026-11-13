//! JavaScript string semantics the index must reproduce: UTF-16 lengths and
//! slices, JS whitespace, trimming, URI decoding, and JS regular expressions
//! (non-Unicode mode) translated for fancy-regex.

use fancy_regex::{Regex, RegexBuilder};

/// JS `\s`: WhiteSpace and LineTerminator (U+FEFF included, U+0085 not).
pub const WS: &str = "\t\n\u{b}\u{c}\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";

pub fn is_ws(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}'
        | '\u{3000}' | '\u{feff}')
}

pub fn is_ws16(u: u16) -> bool {
    char::from_u32(u as u32).is_some_and(is_ws)
}

pub fn trim(s: &str) -> &str {
    s.trim_matches(is_ws)
}

pub fn len16(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

pub fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// UTF-16 offset of every byte offset that starts a char (and the end).
pub struct Offsets {
    table: Vec<u32>,
}

impl Offsets {
    pub fn new(s: &str) -> Self {
        let mut table = vec![0u32; s.len() + 1];
        let mut at = 0u32;
        for (b, c) in s.char_indices() {
            table[b] = at;
            at += c.len_utf16() as u32;
        }
        table[s.len()] = at;
        Offsets { table }
    }
    pub fn at(&self, byte: usize) -> i64 {
        self.table[byte] as i64
    }
}

/// Byte offset of a UTF-16 offset (which falls on a char boundary).
pub fn byte_at16(s: &str, pos: i64) -> usize {
    if pos <= 0 {
        return 0;
    }
    let mut at = 0i64;
    for (b, c) in s.char_indices() {
        if at >= pos {
            return b;
        }
        at += c.len_utf16() as i64;
    }
    s.len()
}

/// `String.prototype.slice` on UTF-16 code units.
pub fn slice16(u: &[u16], a: i64, b: i64) -> &[u16] {
    let len = u.len() as i64;
    let a = a.clamp(0, len);
    let b = b.clamp(0, len);
    if a >= b {
        &[]
    } else {
        &u[a as usize..b as usize]
    }
}

pub fn trim_start16(u: &[u16]) -> &[u16] {
    let i = u.iter().position(|&c| !is_ws16(c)).unwrap_or(u.len());
    &u[i..]
}

pub fn trim_end16(u: &[u16]) -> &[u16] {
    let i = u.iter().rposition(|&c| !is_ws16(c)).map_or(0, |i| i + 1);
    &u[..i]
}

pub fn last_index_of16(hay: &[u16], needle: &[u16]) -> i64 {
    if needle.len() > hay.len() {
        return -1;
    }
    (0..=hay.len() - needle.len())
        .rev()
        .find(|&i| &hay[i..i + needle.len()] == needle)
        .map_or(-1, |i| i as i64)
}

/// `"text".split(/\r?\n/)`.
pub fn split_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    let last = lines.len() - 1;
    for line in &mut lines[..last] {
        if let Some(stripped) = line.strip_suffix('\r') {
            *line = stripped;
        }
    }
    lines
}

/// `decodeURIComponent` (reserved = "") and `decodeURI` (reserved =
/// ";/?:@&=+$,#"): Err where JS throws a URIError.
pub fn decode_uri(s: &str, reserved: &str) -> Result<String, ()> {
    let b = s.as_bytes();
    let hex = |i: usize| -> Result<u8, ()> {
        if i + 2 >= b.len() {
            return Err(());
        }
        if b.get(i) != Some(&b'%') {
            return Err(());
        }
        let h = |c: u8| (c as char).to_digit(16).ok_or(());
        Ok((h(*b.get(i + 1).ok_or(())?)? * 16 + h(*b.get(i + 2).ok_or(())?)?) as u8)
    };
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'%' {
            let c = s[i..].chars().next().unwrap();
            out.push(c);
            i += c.len_utf8();
            continue;
        }
        let first = hex(i)?;
        if first < 0x80 {
            let c = first as char;
            if reserved.contains(c) {
                out.push_str(&s[i..i + 3]);
            } else {
                out.push(c);
            }
            i += 3;
            continue;
        }
        let n = first.leading_ones() as usize;
        if n == 1 || n > 4 {
            return Err(());
        }
        let mut cp = (first as u32) & (0x7f >> n);
        let mut j = i + 3;
        for _ in 1..n {
            let next = hex(j)?;
            if next & 0xc0 != 0x80 {
                return Err(());
            }
            cp = (cp << 6) | (next as u32 & 0x3f);
            j += 3;
        }
        let min = [0, 0, 0x80, 0x800, 0x10000][n];
        if cp < min {
            return Err(());
        }
        out.push(char::from_u32(cp).ok_or(())?);
        i = j;
    }
    Ok(out)
}

/// A JS regular expression source (no `u` flag) as a fancy-regex pattern:
/// JS `\s`, `\d`, `\w`, `\b` and `.`, `[` inside a class, and the `i` flag
/// (ASCII letters only, as JS case folding without `u` leaves non-ASCII
/// letters out of matches with ASCII ones).
pub fn translate(src: &str, ci: bool) -> String {
    const ANY: char = '\u{e000}';
    let src = src.replace("[\\s\\S]", &ANY.to_string());
    let chars: Vec<char> = src.chars().collect();
    let word = "A-Za-z0-9_";
    let mut out = String::new();
    let mut in_class = false;
    let mut class_start = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == ANY {
            out.push_str("(?s:.)");
            i += 1;
            continue;
        }
        if c == '\\' && i + 1 < chars.len() {
            let e = chars[i + 1];
            i += 2;
            if in_class {
                class_start = false;
                match e {
                    's' => out.push_str(WS),
                    'd' => out.push_str("0-9"),
                    'w' => out.push_str(word),
                    '/' => out.push('/'),
                    _ => {
                        out.push('\\');
                        out.push(e);
                    }
                }
            } else {
                match e {
                    's' => out.push_str(&format!("[{WS}]")),
                    'S' => out.push_str(&format!("[^{WS}]")),
                    'd' => out.push_str("[0-9]"),
                    'D' => out.push_str("[^0-9]"),
                    'w' => out.push_str(&format!("[{word}]")),
                    'W' => out.push_str(&format!("[^{word}]")),
                    'b' => out.push_str(&format!(
                        "(?:(?<=[{word}])(?![{word}])|(?<![{word}])(?=[{word}]))"
                    )),
                    '/' => out.push('/'),
                    _ => {
                        out.push('\\');
                        out.push(e);
                    }
                }
            }
            continue;
        }
        if in_class {
            if c == ']' && !class_start {
                in_class = false;
                out.push(']');
            } else if c == '^' && class_start {
                out.push('^');
                i += 1;
                continue;
            } else if c == '[' {
                out.push_str("\\[");
            } else if ci && c.is_ascii_alphabetic() {
                if i + 2 < chars.len() && chars[i + 1] == '-' && chars[i + 2].is_ascii_alphabetic() {
                    let d = chars[i + 2];
                    out.push_str(&format!(
                        "{c}-{d}{}-{}",
                        swap(c),
                        swap(d)
                    ));
                    i += 3;
                    class_start = false;
                    continue;
                }
                out.push(c);
                out.push(swap(c));
            } else if c == '&' || c == '~' {
                out.push('\\');
                out.push(c);
            } else {
                out.push(c);
            }
            class_start = false;
            i += 1;
            continue;
        }
        match c {
            '[' => {
                in_class = true;
                class_start = true;
                out.push('[');
            }
            '.' => out.push_str("[^\n\r\u{2028}\u{2029}]"),
            c if ci && c.is_ascii_alphabetic() => {
                out.push('[');
                out.push(c);
                out.push(swap(c));
                out.push(']');
            }
            c => out.push(c),
        }
        i += 1;
    }
    out
}

fn swap(c: char) -> char {
    if c.is_ascii_lowercase() {
        c.to_ascii_uppercase()
    } else {
        c.to_ascii_lowercase()
    }
}

pub fn re(src: &str) -> Regex {
    build(&translate(src, false))
}

pub fn re_i(src: &str) -> Regex {
    build(&translate(src, true))
}

pub fn build(pattern: &str) -> Regex {
    RegexBuilder::new(pattern)
        .backtrack_limit(usize::MAX)
        .build()
        .unwrap_or_else(|e| panic!("pattern {pattern:?}: {e}"))
}

/// Every match of a regular expression as byte ranges (none empty here).
pub fn find_all(re: &Regex, text: &str) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    for m in re.find_iter(text) {
        let m = m.expect("regex");
        found.push((m.start(), m.end()));
    }
    found
}

/// `text.replace(re, with)` for a global regular expression.
pub fn replace_all(re: &Regex, text: &str, with: &str) -> String {
    re.replace_all(text, with.replace('$', "$$").as_str()).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoding() {
        assert_eq!(decode_uri("Q%26A.md", ""), Ok("Q&A.md".into()));
        assert_eq!(decode_uri("Q%26A.md", ";/?:@&=+$,#"), Ok("Q%26A.md".into()));
        assert_eq!(decode_uri("%E4%B8%AD", ""), Ok("中".into()));
        assert_eq!(decode_uri("%E4%B8", ""), Err(()));
        assert_eq!(decode_uri("%zz", ""), Err(()));
        assert_eq!(decode_uri("%", ""), Err(()));
        assert_eq!(decode_uri("%C0%80", ""), Err(()));
        assert_eq!(decode_uri("%ED%A0%80", ""), Err(()));
        assert_eq!(decode_uri("My%20Note.md", ""), Ok("My Note.md".into()));
    }

    #[test]
    fn lines_and_slices() {
        assert_eq!(split_lines("a\r\nb\nc\r"), vec!["a", "b", "c\r"]);
        let u = utf16("a🙂b");
        assert_eq!(slice16(&u, 1, 2).len(), 1);
        assert_eq!(len16("a🙂b"), 4);
        assert_eq!(trim(" \u{3000}x\u{feff}"), "x");
    }

    #[test]
    fn translation() {
        let r = re_i(r"<a\b[^>]*>\s*<\/a>");
        assert!(r.is_match("<A id=x></a>").unwrap());
        assert!(!r.is_match("<ab></a>").unwrap());
        let r = re(r"(?<![\\$])[*_](?=\S)");
        assert!(r.is_match("x *y").unwrap());
        assert!(!re(r"^\s$").unwrap_or_default_match("\u{85}"));
    }

    trait M {
        fn unwrap_or_default_match(&self, s: &str) -> bool;
    }
    impl M for Regex {
        fn unwrap_or_default_match(&self, s: &str) -> bool {
            self.is_match(s).unwrap()
        }
    }
}
