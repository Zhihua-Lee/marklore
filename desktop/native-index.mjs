// The library index in Rust (native/index), when its binary for this system
// is there: it reads a library's notes in parallel, off the main thread, and
// answers backlinks and searches with the same results as the JavaScript
// index (link-index.mjs, note-search.mjs), which stays as the fallback.
// MARKLORE_INDEX=js uses the JavaScript index.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createLinkIndex } from "./link-index.mjs";
import { parseQuery } from "./note-search.mjs";

// The binding's apiVersion() this loader expects.
export const API = 1;
const require = createRequire(import.meta.url);
const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const binaryName = (platform = process.platform, arch = process.arch) =>
  `marklore-index.${platform}-${arch}.node`;

// Where the binary may be: native/index in a checkout and in the packaged
// app; a packaged app.asar keeps it in app.asar.unpacked beside it.
export function binaryPaths(
  dir = appDir,
  resources = process.resourcesPath,
  name = binaryName(),
) {
  const list = [];
  const add = (file) => list.includes(file) || list.push(file);
  const unpacked = dir.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked");
  add(path.join(unpacked, "native", "index", name));
  add(path.join(dir, "native", "index", name));
  if (resources) add(path.join(resources, "native", name));
  return list;
}

let loaded; // { native, file, error }
function load() {
  if (loaded) return loaded;
  loaded = { native: null, file: null, error: "no binary for this system" };
  for (const file of binaryPaths()) {
    if (!fs.existsSync(file)) continue;
    try {
      const native = require(file);
      if (native.apiVersion?.() !== API)
        throw Error(`API ${native.apiVersion?.()}, expected ${API}`);
      return (loaded = { native, file, error: null });
    } catch (error) {
      loaded.error = `${file}: ${error.message}`;
    }
  }
  return loaded;
}

// The binding, or null: missing, failed to load, or MARKLORE_INDEX=js.
export function loadNative() {
  if (process.env.MARKLORE_INDEX === "js") return null;
  return load().native;
}

// Which index is used, and why not the native one.
export function indexInfo() {
  if (process.env.MARKLORE_INDEX === "js")
    return { kind: "js", file: null, error: "MARKLORE_INDEX=js" };
  const { native, file, error } = load();
  return { kind: native ? "native" : "js", file, error };
}
export const indexKind = () => indexInfo().kind;

// A note store (link-index.mjs createNoteStore) kept by the binding.
export function createNativeStore(native) {
  const index = new native.NoteIndex();
  return {
    load: (files, fresh = false) => index.load(files, fresh),
    remove: (files) => (files.length ? index.remove(files) : false),
    retain: (files) => index.retain(files),
    paths: () => index.paths(),
    has: (file) => index.has(file),
    get size() {
      return index.size;
    },
    backlinks: (file) => index.backlinks(file),
    anchors: (file) => index.anchors(file),
    notes: () => index.notes(),
    parse: (text, file) => native.parseNote(text, file),
    // As note-search.mjs searchNotes: the binding scores every note and lists
    // those that can be among the first maxNotes; names are ordered here, as
    // localeCompare orders them.
    search(query, { maxNotes = 50, maxHits = 3 } = {}) {
      const terms = parseQuery(query);
      if (!terms.length) return { terms, total: 0, results: [] };
      const { total, candidates } = index.rank(terms, maxNotes);
      candidates.sort(
        (a, b) =>
          b[2] - a[2] || a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]),
      );
      const shown = candidates.slice(0, maxNotes).map(([file]) => file);
      // A note dropped between the two calls (a load finishing) is left out.
      const results = index.hits(shown, terms, maxHits).filter(Boolean);
      return { terms, total, results };
    },
  };
}

// The library index: native when the binary loads, otherwise JavaScript.
// Tests that pass their own read or stat get the JavaScript index.
export function createIndex(options = {}) {
  const native = options.read || options.stat ? null : loadNative();
  return createLinkIndex(
    native ? { ...options, store: createNativeStore(native) } : options,
  );
}
