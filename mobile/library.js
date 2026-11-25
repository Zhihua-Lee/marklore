// Notes and images kept on the phone (IndexedDB), with search and small state.
// Implements `library` from README.md; sync.js writes through `write()`.
import { leadingHeading } from "../desktop/note-names.mjs";

const DB = "marklore-reader";
const VERSION = 1;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDatabase(name = DB) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // files: one record per synced file, keyed by OneDrive item id.
      const files = db.createObjectStore("files", { keyPath: "id" });
      files.createIndex("path", "path", { unique: false });
      // items: the folder/file map used to derive paths (delta.js), one record.
      db.createObjectStore("state");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};
// By extension: OneDrive serves some files as application/octet-stream, and
// an SVG without its type does not display.
export const imageType = (path, served = "") =>
  TYPES[path.split(".").pop().toLowerCase()] ||
  served ||
  "application/octet-stream";

export const titleOf = (path, text) =>
  leadingHeading(text || "")?.title ||
  path
    .split("/")
    .pop()
    .replace(/\.(?:md|markdown)$/i, "");

export function createLibrary(db) {
  const listeners = new Set();
  const urls = new Map();
  let notesCache = null; // [{ path, title, modified, size, lower }]

  const tx = (stores, mode = "readonly") => db.transaction(stores, mode);
  const allFiles = () => request(tx("files").objectStore("files").getAll());
  const byPath = async (path) => {
    const rows = await request(
      tx("files").objectStore("files").index("path").getAll(path),
    );
    return rows[0] || null;
  };

  async function notes() {
    if (notesCache) return notesCache;
    const rows = await allFiles();
    notesCache = rows
      .filter((r) => r.kind === "note")
      .map((r) => ({
        path: r.path,
        title: r.title,
        modified: r.modified,
        size: r.size,
        text: r.text,
        lower: r.text.toLowerCase(),
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return notesCache;
  }

  const state = {
    async get(key, fallback = null) {
      const value = await request(
        tx("state")
          .objectStore("state")
          .get("ui:" + key),
      );
      return value === undefined ? fallback : value;
    },
    async set(key, value) {
      await request(
        tx("state", "readwrite")
          .objectStore("state")
          .put(value, "ui:" + key),
      );
    },
  };

  const library = {
    async info() {
      const meta = await request(
        tx("state").objectStore("state").get("sync:meta"),
      );
      if (!meta?.lastSync) return null;
      const rows = await allFiles();
      return {
        folderName: meta.folderName || "",
        lastSync: meta.lastSync,
        notes: rows.filter((r) => r.kind === "note").length,
        images: rows.filter((r) => r.kind === "image").length,
      };
    },
    async list() {
      return (await notes()).map(({ path, title, modified, size }) => ({
        path,
        title,
        modified,
        size,
      }));
    },
    async text(path) {
      const row = await byPath(path);
      return row?.kind === "note" ? row.text : null;
    },
    async asset(path) {
      if (urls.has(path)) return urls.get(path);
      const row = await byPath(path);
      if (!row || row.kind !== "image" || !row.data) return null;
      const url = URL.createObjectURL(new Blob([row.data], { type: row.type }));
      urls.set(path, url);
      return url;
    },
    async search(query, { limit = 50 } = {}) {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const hits = [];
      for (const note of await notes()) {
        const inTitle = note.title.toLowerCase();
        if (!words.every((w) => note.lower.includes(w) || inTitle.includes(w)))
          continue;
        const lines = note.text.split("\n");
        let line = lines.findIndex((l) => l.toLowerCase().includes(words[0]));
        if (line < 0) line = 0;
        const raw = lines[line].trim();
        const at = Math.max(0, raw.toLowerCase().indexOf(words[0]) - 30);
        hits.push({
          path: note.path,
          title: note.title,
          snippet: (at ? "…" : "") + raw.slice(at, at + 120),
          line,
        });
        if (hits.length >= limit) break;
      }
      return hits;
    },
    state,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // Sync-side access (not part of the interface contract).
  const internal = {
    db,
    stored: async () =>
      new Map(
        (await allFiles()).map((r) => [r.id, { path: r.path, tag: r.tag }]),
      ),
    async getMeta(key, fallback = null) {
      const value = await request(
        tx("state")
          .objectStore("state")
          .get("sync:" + key),
      );
      return value === undefined ? fallback : value;
    },
    async setMeta(key, value) {
      await request(
        tx("state", "readwrite")
          .objectStore("state")
          .put(value, "sync:" + key),
      );
    },
    // Writes one downloaded file. Images are kept as bytes, not Blobs: WebKit
    // (Safari) has refused Blobs in IndexedDB.
    async put({ id, path, kind, tag, size, modified }, content) {
      const record =
        kind === "note"
          ? {
              id,
              path,
              kind,
              tag,
              size,
              modified,
              text: content,
              title: titleOf(path, content),
            }
          : {
              id,
              path,
              kind,
              tag,
              size,
              modified,
              data: await content.arrayBuffer(),
              type: imageType(path, content.type),
            };
      await request(tx("files", "readwrite").objectStore("files").put(record));
    },
    async move(id, to) {
      const store = tx("files", "readwrite").objectStore("files");
      const row = await request(store.get(id));
      if (!row) return;
      row.path = to;
      if (row.kind === "note") row.title = titleOf(to, row.text);
      await request(tx("files", "readwrite").objectStore("files").put(row));
    },
    async remove(id) {
      await request(tx("files", "readwrite").objectStore("files").delete(id));
    },
    async clear() {
      const t = tx(["files", "state"], "readwrite");
      t.objectStore("files").clear();
      for (const key of ["sync:meta", "sync:items", "sync:delta"])
        t.objectStore("state").delete(key);
      await new Promise((resolve, reject) => {
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    },
    changed() {
      notesCache = null;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      for (const fn of listeners) fn();
    },
  };
  return { library, internal };
}
