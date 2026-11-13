//! Marklore's library index in Rust: the notes' text, links and anchors,
//! read in parallel, for backlinks and full-text search. Every result is the
//! one desktop/link-index.mjs and desktop/note-search.mjs give, so the
//! JavaScript index stays a drop-in fallback (desktop/native-index.mjs).

pub mod fast;
pub mod js;
pub mod parse;
pub mod paths;
pub mod search;
pub mod snippet;
pub mod store;

#[cfg(feature = "node")]
mod node;
