//! The notes held in memory, in the order a JavaScript Map keeps them
//! (insertion order; a note read again keeps its place).

use crate::parse::{parse_note, Anchor, Link};
use crate::paths::{basename, path_key};
use crate::search::{bare_name, rank, search_note, Found};
use indexmap::IndexMap;
use rayon::prelude::*;
use std::time::UNIX_EPOCH;

const MAX_BYTES: u64 = 2 * 1024 * 1024;

pub struct Note {
    pub path: String,
    pub key: String,
    pub name: String,
    pub bare: String,
    pub mtime: f64,
    pub text: String,
    pub lower: String,
    pub links: Vec<Link>,
    pub link_keys: Vec<String>,
    pub anchors: Vec<Anchor>,
}

impl Note {
    pub fn new(path: &str, mtime: f64, text: String) -> Note {
        let parsed = parse_note(&text, path);
        let name = basename(path);
        Note {
            path: path.to_string(),
            key: path_key(path),
            bare: bare_name(&name),
            name,
            mtime,
            lower: text.to_lowercase(),
            text,
            link_keys: parsed.links.iter().map(|l| path_key(&l.target)).collect(),
            links: parsed.links,
            anchors: parsed.anchors,
        }
    }
}

pub enum Loaded {
    Remove(String),
    Keep,
    Put(String, Box<Note>),
}

#[derive(Default)]
pub struct Store {
    pub notes: IndexMap<String, Note>,
}

/// Read and parse one note (link-index.mjs `load`), without the store lock.
pub fn read_note(path: &str, fresh: bool, known_mtime: Option<f64>) -> Loaded {
    let key = path_key(path);
    let Ok(info) = std::fs::metadata(path) else {
        return Loaded::Remove(key);
    };
    if !info.is_file() || info.len() > MAX_BYTES {
        return Loaded::Remove(key);
    }
    let mtime = info
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0);
    if !fresh && known_mtime == Some(mtime) {
        return Loaded::Keep;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return Loaded::Remove(key);
    };
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    Loaded::Put(key, Box::new(Note::new(path, mtime, text)))
}

impl Store {
    /// Results of read_note, in the order the notes were found.
    pub fn apply(&mut self, loaded: Vec<Loaded>) {
        for l in loaded {
            match l {
                Loaded::Remove(key) => {
                    self.notes.shift_remove(&key);
                }
                Loaded::Keep => {}
                Loaded::Put(key, note) => {
                    self.notes.insert(key, *note);
                }
            }
        }
    }

    pub fn remove(&mut self, paths: &[String]) -> bool {
        let mut any = false;
        for p in paths {
            any |= self.notes.shift_remove(&path_key(p)).is_some();
        }
        any
    }

    pub fn retain(&mut self, paths: &[String]) {
        let keep: std::collections::HashSet<String> = paths.iter().map(|p| path_key(p)).collect();
        self.notes.retain(|k, _| keep.contains(k));
    }

    pub fn get(&self, path: &str) -> Option<&Note> {
        self.notes.get(&path_key(path))
    }

    pub fn backlinks(&self, file: &str) -> Vec<(&Note, &Link)> {
        let key = path_key(file);
        let mut out = Vec::new();
        for note in self.notes.values() {
            if note.key == key {
                continue;
            }
            for (link, k) in note.links.iter().zip(&note.link_keys) {
                if *k == key {
                    out.push((note, link));
                }
            }
        }
        out
    }

    /// Scores of the notes holding every term; only those that can be among
    /// the first `max_notes` (the score at that place or higher) are listed,
    /// for the caller to order by name as JavaScript does.
    pub fn rank(&self, terms: &[String], max_notes: usize) -> (usize, Vec<(&Note, u32)>) {
        let mut ranked: Vec<(&Note, u32)> = self
            .notes
            .par_values()
            .filter_map(|n| rank(&n.bare, &n.lower, terms).map(|s| (n, s)))
            .collect();
        let total = ranked.len();
        if max_notes == 0 {
            return (total, Vec::new());
        }
        if total > max_notes {
            let mut scores: Vec<u32> = ranked.iter().map(|r| r.1).collect();
            let (_, &mut threshold, _) = scores.select_nth_unstable_by(max_notes - 1, |a, b| b.cmp(a));
            ranked.retain(|r| r.1 >= threshold);
        }
        (total, ranked)
    }

    pub fn hits(&self, paths: &[String], terms: &[String], max_hits: usize) -> Vec<Option<(&Note, Found)>> {
        paths
            .par_iter()
            .map(|p| {
                let note = self.get(p)?;
                search_note(&note.name, &note.text, &note.lower, terms, max_hits).map(|f| (note, f))
            })
            .collect()
    }
}
