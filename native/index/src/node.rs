//! The Node binding. Results are built as the JavaScript objects the
//! JavaScript index returns; strings cut by a window are made from UTF-16
//! code units, as JavaScript cuts them.

use crate::parse::{self, Anchor, Link};
use crate::paths;
use crate::search::{self, Found, Part};
use crate::store::{read_note, Loaded, Note, Store};
use napi::bindgen_prelude::*;
use napi::{Env, JsObject, JsUndefined, JsUnknown, Task};
use napi_derive::napi;
use rayon::prelude::*;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, RwLock};

/// Bumped when the binding's API changes; the loader checks it.
pub const API: u32 = 1;

#[napi]
pub fn api_version() -> u32 {
    API
}

fn failed<T>(what: &str) -> Result<T> {
    Err(Error::new(Status::GenericFailure, format!("marklore-index: {what} failed")))
}

fn guard<T>(what: &str, f: impl FnOnce() -> Result<T>) -> Result<T> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(_) => failed(what),
    }
}

fn array(env: &Env, items: Vec<JsObject>) -> Result<JsObject> {
    let mut a = env.create_array_with_length(items.len())?;
    for (i, item) in items.into_iter().enumerate() {
        a.set_element(i as u32, item)?;
    }
    Ok(a)
}

fn link_object(env: &Env, link: &Link, source: Option<&str>) -> Result<JsObject> {
    let mut o = env.create_object()?;
    o.set_named_property("target", env.create_string(&link.target)?)?;
    o.set_named_property("fragment", env.create_string(&link.fragment)?)?;
    o.set_named_property("text", env.create_string(&link.text)?)?;
    o.set_named_property("line", env.create_uint32(link.line)?)?;
    o.set_named_property("column", env.create_uint32(link.column)?)?;
    o.set_named_property("section", env.create_string(&link.section)?)?;
    o.set_named_property("snippet", env.create_string_utf16(&link.snippet)?)?;
    if let Some(source) = source {
        o.set_named_property("source", env.create_string(source)?)?;
    }
    Ok(o)
}

fn anchor_object(env: &Env, a: &Anchor) -> Result<JsObject> {
    let mut o = env.create_object()?;
    o.set_named_property("id", env.create_string(&a.id)?)?;
    if a.heading_kind {
        o.set_named_property("kind", env.create_string("heading")?)?;
        o.set_named_property("level", env.create_uint32(a.level)?)?;
        o.set_named_property("line", env.create_uint32(a.line)?)?;
        o.set_named_property("label", env.create_string_utf16(&a.label)?)?;
    } else {
        o.set_named_property("kind", env.create_string("explicit")?)?;
        o.set_named_property("line", env.create_uint32(a.line)?)?;
        o.set_named_property("label", env.create_string_utf16(&a.label)?)?;
        o.set_named_property("section", env.create_string(&a.section)?)?;
        if let Some(h) = &a.heading {
            o.set_named_property("heading", env.create_string(h)?)?;
        }
    }
    Ok(o)
}

fn anchors_array(env: &Env, anchors: &[Anchor]) -> Result<JsObject> {
    array(env, anchors.iter().map(|a| anchor_object(env, a)).collect::<Result<_>>()?)
}

fn parts_array(env: &Env, parts: &[Part]) -> Result<JsObject> {
    let mut items = Vec::with_capacity(parts.len());
    for (text, hit) in parts {
        let mut pair = env.create_array_with_length(2)?;
        pair.set_element(0, env.create_string_utf16(text)?)?;
        pair.set_element(1, env.get_boolean(*hit)?)?;
        items.push(pair);
    }
    array(env, items)
}

fn found_object(env: &Env, path: &str, name: &str, f: &Found) -> Result<JsObject> {
    let mut o = env.create_object()?;
    o.set_named_property("path", env.create_string(path)?)?;
    o.set_named_property("name", env.create_string(name)?)?;
    o.set_named_property("nameHit", env.get_boolean(f.name_hit)?)?;
    o.set_named_property("count", env.create_uint32(f.count)?)?;
    let mut hits = Vec::with_capacity(f.hits.len());
    for h in &f.hits {
        let mut ho = env.create_object()?;
        ho.set_named_property("line", env.create_uint32(h.line)?)?;
        ho.set_named_property("column", env.create_uint32(h.column)?)?;
        ho.set_named_property("section", env.create_string(&h.section)?)?;
        ho.set_named_property("heading", env.get_boolean(h.heading)?)?;
        ho.set_named_property("snippet", parts_array(env, &h.snippet)?)?;
        hits.push(ho);
    }
    o.set_named_property("hits", array(env, hits)?)?;
    Ok(o)
}

/// desktop/link-index.mjs `parseNote(text, file)`.
#[napi]
pub fn parse_note(env: Env, text: String, file: String) -> Result<JsObject> {
    guard("parseNote", || {
        let p = parse::parse_note(&text, &file);
        let mut o = env.create_object()?;
        let links = p.links.iter().map(|l| link_object(&env, l, None)).collect::<Result<_>>()?;
        o.set_named_property("links", array(&env, links)?)?;
        o.set_named_property("anchors", anchors_array(&env, &p.anchors)?)?;
        Ok(o)
    })
}

/// desktop/note-search.mjs `searchNote({path, name, text}, terms, {maxHits})`.
#[napi]
pub fn search_note(env: Env, path: String, name: String, text: String, terms: Vec<String>, max_hits: u32) -> Result<JsUnknown> {
    guard("searchNote", || {
        match search::search_note(&name, &text, &text.to_lowercase(), &terms, max_hits as usize) {
            Some(f) => Ok(found_object(&env, &path, &name, &f)?.into_unknown()),
            None => Ok(env.get_null()?.into_unknown()),
        }
    })
}

/// desktop/note-search.mjs `rank({name, text}, terms)`.
#[napi]
pub fn rank_note(name: String, text: String, terms: Vec<String>) -> Option<u32> {
    search::rank(&search::bare_name(&name), &text.to_lowercase(), &terms)
}

/// desktop/link-index.mjs `pathKey(p)`.
#[napi]
pub fn path_key(p: String) -> String {
    paths::path_key(&p)
}

pub struct LoadTask {
    store: Arc<RwLock<Store>>,
    paths: Vec<String>,
    fresh: bool,
}

impl Task for LoadTask {
    type Output = ();
    type JsValue = JsUndefined;

    fn compute(&mut self) -> Result<()> {
        let (store, list, fresh) = (&self.store, &self.paths, self.fresh);
        guard("load", || {
            // The lock is held only to look up and to apply, not while reading.
            let known: Vec<Option<f64>> = {
                let st = store.read().unwrap_or_else(|e| e.into_inner());
                list.iter()
                    .map(|p| if fresh { None } else { st.get(p).map(|n| n.mtime) })
                    .collect()
            };
            let loaded: Vec<Loaded> = list
                .par_iter()
                .zip(known)
                .map(|(p, k)| read_note(p, fresh, k))
                .collect();
            store.write().unwrap_or_else(|e| e.into_inner()).apply(loaded);
            Ok(())
        })
    }

    fn resolve(&mut self, env: Env, _: ()) -> Result<JsUndefined> {
        env.get_undefined()
    }
}

/// The library's notes (link-index.mjs keeps them in a Map).
#[napi]
pub struct NoteIndex {
    store: Arc<RwLock<Store>>,
}

impl NoteIndex {
    fn read(&self) -> std::sync::RwLockReadGuard<'_, Store> {
        self.store.read().unwrap_or_else(|e| e.into_inner())
    }
    fn write(&self) -> std::sync::RwLockWriteGuard<'_, Store> {
        self.store.write().unwrap_or_else(|e| e.into_inner())
    }
}

impl Default for NoteIndex {
    fn default() -> Self {
        Self::new()
    }
}

#[napi]
impl NoteIndex {
    #[napi(constructor)]
    pub fn new() -> Self {
        NoteIndex { store: Arc::new(RwLock::new(Store::default())) }
    }

    /// Read these notes (in parallel, off the main thread) and index them.
    /// fresh: a write was reported, so the modification time is not trusted.
    #[napi]
    pub fn load(&self, paths: Vec<String>, fresh: bool) -> AsyncTask<LoadTask> {
        AsyncTask::new(LoadTask { store: self.store.clone(), paths, fresh })
    }

    /// Drop these notes; true when one was indexed.
    #[napi]
    pub fn remove(&self, paths: Vec<String>) -> bool {
        self.write().remove(&paths)
    }

    /// Keep only these notes.
    #[napi]
    pub fn retain(&self, paths: Vec<String>) {
        self.write().retain(&paths)
    }

    #[napi]
    pub fn paths(&self) -> Vec<String> {
        self.read().notes.values().map(|n| n.path.clone()).collect()
    }

    #[napi]
    pub fn has(&self, file: String) -> bool {
        self.read().get(&file).is_some()
    }

    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.read().notes.len() as u32
    }

    #[napi]
    pub fn backlinks(&self, env: Env, file: String) -> Result<JsObject> {
        guard("backlinks", || {
            let st = self.read();
            let items = st
                .backlinks(&file)
                .into_iter()
                .map(|(note, link)| link_object(&env, link, Some(&note.path)))
                .collect::<Result<_>>()?;
            array(&env, items)
        })
    }

    /// This note's anchors, or null when it is not indexed.
    #[napi]
    pub fn anchors(&self, env: Env, file: String) -> Result<JsUnknown> {
        guard("anchors", || match self.read().get(&file) {
            Some(n) => Ok(anchors_array(&env, &n.anchors)?.into_unknown()),
            None => Ok(env.get_null()?.into_unknown()),
        })
    }

    #[napi]
    pub fn notes(&self, env: Env) -> Result<JsObject> {
        guard("notes", || {
            let st = self.read();
            let mut items = Vec::with_capacity(st.notes.len());
            for n in st.notes.values() {
                let mut o = env.create_object()?;
                o.set_named_property("path", env.create_string(&n.path)?)?;
                o.set_named_property("anchors", anchors_array(&env, &n.anchors)?)?;
                items.push(o);
            }
            array(&env, items)
        })
    }

    /// { total, candidates: [[path, name, score]] }: the notes that can be
    /// among the first maxNotes, for the caller to order (localeCompare).
    #[napi]
    pub fn rank(&self, env: Env, terms: Vec<String>, max_notes: u32) -> Result<JsObject> {
        guard("rank", || {
            let st = self.read();
            let (total, ranked) = st.rank(&terms, max_notes as usize);
            let mut items = Vec::with_capacity(ranked.len());
            for (n, score) in ranked {
                let mut row = env.create_array_with_length(3)?;
                row.set_element(0, env.create_string(&n.path)?)?;
                row.set_element(1, env.create_string(&n.name)?)?;
                row.set_element(2, env.create_uint32(score)?)?;
                items.push(row);
            }
            let mut o = env.create_object()?;
            o.set_named_property("total", env.create_uint32(total as u32)?)?;
            o.set_named_property("candidates", array(&env, items)?)?;
            Ok(o)
        })
    }

    /// searchNote for each of these notes (null for one not indexed).
    #[napi]
    pub fn hits(&self, env: Env, paths: Vec<String>, terms: Vec<String>, max_hits: u32) -> Result<JsObject> {
        guard("hits", || {
            let st = self.read();
            let found = st.hits(&paths, &terms, max_hits as usize);
            let mut a = env.create_array_with_length(found.len())?;
            for (i, f) in found.iter().enumerate() {
                match f {
                    Some((note, f)) => a.set_element(i as u32, found_object(&env, &note.path, &note.name, f)?)?,
                    None => a.set_element(i as u32, env.get_null()?)?,
                }
            }
            Ok(a)
        })
    }
}

#[allow(dead_code)]
fn _assert_send(n: Note) -> impl Send {
    n
}
