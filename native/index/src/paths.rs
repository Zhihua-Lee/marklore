//! Node's `path.resolve`, `path.dirname` and `path.basename` (win32 on
//! Windows, posix elsewhere), so link targets and index keys are the strings
//! the JavaScript index makes.

fn sep_win(c: u8) -> bool {
    c == b'/' || c == b'\\'
}

fn sep_posix(c: u8) -> bool {
    c == b'/'
}

fn normalize_string(path: &str, allow_above_root: bool, separator: char, is_sep: fn(u8) -> bool) -> String {
    let b = path.as_bytes();
    let mut res = String::new();
    let mut last_segment_length: i64 = 0;
    let mut last_slash: i64 = -1;
    let mut dots: i64 = 0;
    let mut code: u8 = 0;
    let mut i: i64 = 0;
    while i <= b.len() as i64 {
        if (i as usize) < b.len() {
            code = b[i as usize];
        } else if is_sep(code) {
            break;
        } else {
            code = b'/';
        }
        if is_sep(code) {
            if last_slash == i - 1 || dots == 1 {
                // nothing
            } else if dots == 2 {
                let rb = res.as_bytes();
                if res.len() < 2
                    || last_segment_length != 2
                    || rb[rb.len() - 1] != b'.'
                    || rb[rb.len() - 2] != b'.'
                {
                    if res.len() > 2 {
                        match res.rfind(separator) {
                            None => {
                                res.clear();
                                last_segment_length = 0;
                            }
                            Some(idx) => {
                                res.truncate(idx);
                                last_segment_length = res.len() as i64
                                    - 1
                                    - res.rfind(separator).map_or(-1, |x| x as i64);
                            }
                        }
                        last_slash = i;
                        dots = 0;
                        i += 1;
                        continue;
                    } else if !res.is_empty() {
                        res.clear();
                        last_segment_length = 0;
                        last_slash = i;
                        dots = 0;
                        i += 1;
                        continue;
                    }
                }
                if allow_above_root {
                    if !res.is_empty() {
                        res.push(separator);
                    }
                    res.push_str("..");
                    last_segment_length = 2;
                }
            } else {
                let seg = &path[(last_slash + 1) as usize..i as usize];
                if !res.is_empty() {
                    res.push(separator);
                }
                res.push_str(seg);
                last_segment_length = i - last_slash - 1;
            }
            last_slash = i;
            dots = 0;
        } else if code == b'.' && dots != -1 {
            dots += 1;
        } else {
            dots = -1;
        }
        i += 1;
    }
    res
}

pub fn posix_resolve(args: &[&str]) -> String {
    let mut resolved = String::new();
    let mut absolute = false;
    for p in args.iter().rev() {
        if absolute {
            break;
        }
        if p.is_empty() {
            continue;
        }
        resolved = format!("{p}/{resolved}");
        absolute = p.starts_with('/');
    }
    if !absolute {
        let cwd = std::env::current_dir()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or_default();
        absolute = cwd.starts_with('/');
        resolved = format!("{cwd}/{resolved}");
    }
    let norm = normalize_string(&resolved, !absolute, '/', sep_posix);
    if absolute {
        format!("/{norm}")
    } else if norm.is_empty() {
        ".".into()
    } else {
        norm
    }
}

pub fn win32_resolve(args: &[&str]) -> String {
    let mut resolved_device = String::new();
    let mut resolved_tail = String::new();
    let mut resolved_absolute = false;
    let mut i = args.len() as i64 - 1;
    while i >= -1 {
        let path: String;
        if i >= 0 {
            if args[i as usize].is_empty() {
                i -= 1;
                continue;
            }
            path = args[i as usize].to_string();
        } else if resolved_device.is_empty() {
            path = std::env::current_dir()
                .map(|d| d.to_string_lossy().into_owned())
                .unwrap_or_default();
        } else {
            let mut p = std::env::var(format!("={resolved_device}"))
                .ok()
                .filter(|v| !v.is_empty())
                .or_else(|| std::env::current_dir().ok().map(|d| d.to_string_lossy().into_owned()))
                .unwrap_or_default();
            let pb = p.as_bytes();
            if p.get(..2).map(|s| s.to_lowercase()) != Some(resolved_device.to_lowercase())
                && pb.get(2) == Some(&b'\\')
            {
                p = format!("{resolved_device}\\");
            }
            path = p;
        }
        let b = path.as_bytes();
        let len = b.len();
        let mut root_end = 0usize;
        let mut device = String::new();
        let mut is_absolute = false;
        let code = b.first().copied().unwrap_or(0);
        if len == 1 {
            if sep_win(code) {
                root_end = 1;
                is_absolute = true;
            }
        } else if sep_win(code) {
            is_absolute = true;
            if sep_win(b[1]) {
                let mut j = 2;
                let mut last = j;
                while j < len && !sep_win(b[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    let first_part = &path[last..j];
                    last = j;
                    while j < len && sep_win(b[j]) {
                        j += 1;
                    }
                    if j < len && j != last {
                        last = j;
                        while j < len && !sep_win(b[j]) {
                            j += 1;
                        }
                        if j == len || j != last {
                            if first_part != "." && first_part != "?" {
                                device = format!("\\\\{first_part}\\{}", &path[last..j]);
                                root_end = j;
                            } else {
                                device = format!("\\\\{first_part}");
                                root_end = 4;
                            }
                        }
                    }
                }
            } else {
                root_end = 1;
            }
        } else if code.is_ascii_alphabetic() && b.get(1) == Some(&b':') {
            device = path[..2].to_string();
            root_end = 2;
            if len > 2 && sep_win(b[2]) {
                is_absolute = true;
                root_end = 3;
            }
        }
        if !device.is_empty() {
            if !resolved_device.is_empty() {
                if device.to_lowercase() != resolved_device.to_lowercase() {
                    i -= 1;
                    continue;
                }
            } else {
                resolved_device = device;
            }
        }
        if resolved_absolute {
            if !resolved_device.is_empty() {
                break;
            }
        } else {
            resolved_tail = format!("{}\\{resolved_tail}", path.get(root_end..).unwrap_or(""));
            resolved_absolute = is_absolute;
            if is_absolute && !resolved_device.is_empty() {
                break;
            }
        }
        i -= 1;
    }
    let tail = normalize_string(&resolved_tail, !resolved_absolute, '\\', sep_win);
    if resolved_absolute {
        format!("{resolved_device}\\{tail}")
    } else {
        let s = format!("{resolved_device}{tail}");
        if s.is_empty() {
            ".".into()
        } else {
            s
        }
    }
}

pub fn win32_dirname(path: &str) -> String {
    let b = path.as_bytes();
    let len = b.len();
    if len == 0 {
        return ".".into();
    }
    let mut root_end: i64 = -1;
    let mut offset = 0usize;
    let code = b[0];
    if len == 1 {
        return if sep_win(code) { path.into() } else { ".".into() };
    }
    if sep_win(code) {
        root_end = 1;
        offset = 1;
        if sep_win(b[1]) {
            let mut j = 2;
            let mut last = j;
            while j < len && !sep_win(b[j]) {
                j += 1;
            }
            if j < len && j != last {
                last = j;
                while j < len && sep_win(b[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    last = j;
                    while j < len && !sep_win(b[j]) {
                        j += 1;
                    }
                    if j == len {
                        return path.into();
                    }
                    if j != last {
                        root_end = (j + 1) as i64;
                        offset = j + 1;
                    }
                }
            }
        }
    } else if code.is_ascii_alphabetic() && b[1] == b':' {
        root_end = if len > 2 && sep_win(b[2]) { 3 } else { 2 };
        offset = root_end as usize;
    }
    let mut end: i64 = -1;
    let mut matched_slash = true;
    let mut i = len as i64 - 1;
    while i >= offset as i64 {
        if sep_win(b[i as usize]) {
            if !matched_slash {
                end = i;
                break;
            }
        } else {
            matched_slash = false;
        }
        i -= 1;
    }
    if end == -1 {
        if root_end == -1 {
            return ".".into();
        }
        end = root_end;
    }
    path[..end as usize].to_string()
}

pub fn posix_dirname(path: &str) -> String {
    let b = path.as_bytes();
    if b.is_empty() {
        return ".".into();
    }
    let has_root = b[0] == b'/';
    let mut end: i64 = -1;
    let mut matched_slash = true;
    let mut i = b.len() as i64 - 1;
    while i >= 1 {
        if b[i as usize] == b'/' {
            if !matched_slash {
                end = i;
                break;
            }
        } else {
            matched_slash = false;
        }
        i -= 1;
    }
    if end == -1 {
        return if has_root { "/".into() } else { ".".into() };
    }
    if has_root && end == 1 {
        return "//".into();
    }
    path[..end as usize].to_string()
}

/// The last part of a file path (the paths here never end in a separator).
pub fn basename(path: &str) -> String {
    let is_sep: fn(u8) -> bool = if cfg!(windows) { sep_win } else { sep_posix };
    let b = path.as_bytes();
    let mut end = b.len();
    while end > 0 && is_sep(b[end - 1]) {
        end -= 1;
    }
    let mut start = end;
    while start > 0 && !is_sep(b[start - 1]) {
        start -= 1;
    }
    if cfg!(windows) && start == 0 && end >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        start = 2;
    }
    path[start..end].to_string()
}

pub fn resolve(args: &[&str]) -> String {
    if cfg!(windows) {
        win32_resolve(args)
    } else {
        posix_resolve(args)
    }
}

pub fn dirname(path: &str) -> String {
    if cfg!(windows) {
        win32_dirname(path)
    } else {
        posix_dirname(path)
    }
}

/// `path.resolve(p).toLowerCase()`: paths compare case-insensitively.
pub fn path_key(p: &str) -> String {
    resolve(&[p]).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win32() {
        let r = |d: &str, t: &str| win32_resolve(&[d, t]);
        assert_eq!(r("C:\\kb", "Sep01.md"), "C:\\kb\\Sep01.md");
        assert_eq!(r("C:\\kb\\sub", "../B.md"), "C:\\kb\\B.md");
        assert_eq!(r("C:\\kb", "./a/./b/../c.md"), "C:\\kb\\a\\c.md");
        assert_eq!(r("C:\\kb", "/x.md"), "C:\\x.md");
        assert_eq!(r("C:\\kb", "D:/y/z.md"), "D:\\y\\z.md");
        assert_eq!(r("C:\\", "../../a.md"), "C:\\a.md");
        assert_eq!(r("\\\\server\\share\\dir", "../a.md"), "\\\\server\\share\\a.md");
        assert_eq!(r("\\\\server\\share", "../../a.md"), "\\\\server\\share\\a.md");
        assert_eq!(r("C:\\kb", "a//b\\\\c.md"), "C:\\kb\\a\\b\\c.md");
        assert_eq!(win32_resolve(&["C:/kb/x.md"]), "C:\\kb\\x.md");
        assert_eq!(win32_dirname("C:\\kb\\x.md"), "C:\\kb");
        assert_eq!(win32_dirname("C:\\x.md"), "C:\\");
        assert_eq!(win32_dirname("\\\\server\\share\\x.md"), "\\\\server\\share\\");
    }

    #[test]
    fn posix() {
        let r = |d: &str, t: &str| posix_resolve(&[d, t]);
        assert_eq!(r("/kb", "Sep01.md"), "/kb/Sep01.md");
        assert_eq!(r("/kb/sub", "../B.md"), "/kb/B.md");
        assert_eq!(r("/kb", "/x.md"), "/x.md");
        assert_eq!(r("/", "../../a.md"), "/a.md");
        assert_eq!(r("/kb", "a\\b.md"), "/kb/a\\b.md");
        assert_eq!(posix_dirname("/kb/x.md"), "/kb");
        assert_eq!(posix_dirname("/x.md"), "/");
    }
}
