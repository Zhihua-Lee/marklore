//! Where parsing spends its time, on a library folder:
//!   cargo run --release --no-default-features --example profile -- <folder>
use marklore_index::{js, parse, snippet};
use std::time::Instant;

fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().is_some_and(|x| x == "md") {
            out.push(p);
        }
    }
}

fn main() {
    let root = std::env::args().nth(1).expect("folder");
    let mut files = Vec::new();
    walk(std::path::Path::new(&root), &mut files);
    let texts: Vec<(String, String)> = files
        .iter()
        .map(|f| (f.to_string_lossy().into_owned(), std::fs::read_to_string(f).unwrap()))
        .collect();
    let t = Instant::now();
    for (f, text) in &texts {
        parse::parse_note(text, f);
    }
    println!("parse_note x{}: {:?}", texts.len(), t.elapsed());
    use rayon::prelude::*;
    let t = Instant::now();
    texts.par_iter().for_each(|(f, text)| {
        parse::parse_note(text, f);
    });
    println!("parse_note in parallel ({} threads): {:?}", rayon::current_num_threads(), t.elapsed());
    let t = Instant::now();
    for (_, text) in &texts {
        snippet::protected_spans(text);
    }
    println!("protected_spans (whole notes): {:?}", t.elapsed());
    let lines: Vec<&str> = texts.iter().flat_map(|(_, t)| js::split_lines(t)).collect();
    let patterns = [
        ("LINK", parse::LINK_SRC, false),
        ("ATX", parse::ATX_SRC, false),
        ("ANCHOR", r#"<[a-z][a-z0-9]*\b[^>]*?\sid\s*=\s*["']([^"']+)["'][^>]*>"#, true),
        ("CODE", r"(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)", false),
        ("EMPTY_A", r"<a\b[^>]*>\s*<\/a>", true),
        ("EMPHASIS", r"\*\*|__|(?<![\\$])[*_](?=\S)|(?<=\S)[*_]", false),
        ("SPACES", r"\s+", false),
        ("INLINE_MATH", snippet::INLINE_MATH, false),
        ("TICKS2", r"(`+)[\s\S]+?\1", false),
        ("STRONG2", r"(\*\*|__|~~|==)(?=\S)[\s\S]+?(?<=\S)\1", false),
        ("TAG", r"<\/?[a-z][^>\n]*>", true),
    ];
    for (name, src, ci) in patterns {
        let re = if ci { js::re_i(src) } else { js::re(src) };
        let t = Instant::now();
        let mut n = 0;
        for l in &lines {
            n += js::find_all(&re, l).len();
        }
        println!("{name:12} {:?} ({n} matches)", t.elapsed());
    }
    let t = Instant::now();
    for l in &lines {
        js::Offsets::new(l);
    }
    println!("Offsets per line {:?}", t.elapsed());
}
