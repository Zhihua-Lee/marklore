// Link index for the library: which note links to which note and anchor, in
// what sentence, and which anchors each note has. Built from the Markdown
// source in the main process (nothing is rendered), kept current from the
// library watcher, and asked for a note's backlinks and for broken links.
import fs from "node:fs/promises";
import path from "node:path";
import { markdownPath } from "./files.mjs";
import { createSlugger } from "./slug.mjs";
import { searchNotes } from "./note-search.mjs";

const MAX_FILES = 5000,
  MAX_BYTES = 2 * 1024 * 1024,
  SNIPPET_BEFORE = 90,
  SNIPPET_AFTER = 150;

// Paths compare case-insensitively on Windows.
export const pathKey = (p) => path.resolve(p).toLowerCase();

const LINK =
  /(!?)\[((?:[^[\]\n]|\[[^\]\n]*\])*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
const ANCHOR = /<[a-z][a-z0-9]*\b[^>]*?\sid\s*=\s*["']([^"']+)["'][^>]*>/gi;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Inline code keeps its width (columns stay true) but cannot hold links.
const blankCode = (line) =>
  line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) =>
    " ".repeat(m.length),
  );
// Readable text of a Markdown fragment: links become their text, anchors and
// emphasis markers go. Math stays as written; the renderer typesets it.
const linkText = (text) =>
  text.replace(LINK, (m, image, label) => (image ? "" : label));
const plainText = (text) =>
  linkText(text)
    .replace(/<a\b[^>]*>\s*<\/a>/gi, "")
    .replace(/\*\*|__|(?<![\\$])[*_](?=\S)|(?<=\S)[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function headingLabel(raw) {
  // Inline HTML in a heading: the renderer slugs its text without the tags.
  return /<[a-z/][^>]*>/i.test(raw) ? raw.replace(/<[^>]+>/g, "") : raw;
}

// A label for an explicit anchor: the bold lead of what it marks
// ("**Definition（ERM）。**"), otherwise its first words.
function anchorLabel(line) {
  // An anchor written inline (at the start of a list item) is not its name.
  line = line.replace(/<a\b[^>]*>\s*<\/a>/gi, "");
  const bold = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*(.+?)\*\*/);
  const text = plainText(bold ? bold[1] : line).replace(
    /[。．.:：，,；;]+$/,
    "",
  );
  return text.length > 40 ? text.slice(0, 38) + "…" : text;
}

function snippetAround(paragraph, start, end, hit) {
  let before = linkText(paragraph.slice(0, start)),
    after = linkText(paragraph.slice(end));
  const strip = (s) => s.replace(/<a\b[^>]*>\s*<\/a>/gi, "");
  before = strip(before);
  after = strip(after);
  let cutBefore = false,
    cutAfter = false;
  if (before.length > SNIPPET_BEFORE) {
    before = before.slice(-SNIPPET_BEFORE);
    const space = before.search(/[\s，。；,.;]/);
    if (space >= 0 && space < 30) before = before.slice(space + 1);
    cutBefore = true;
  }
  if (after.length > SNIPPET_AFTER) {
    after = after.slice(0, SNIPPET_AFTER);
    const stop = Math.max(after.lastIndexOf("。"), after.lastIndexOf(". "));
    if (stop > 60) after = after.slice(0, stop + 1);
    else cutAfter = true;
  }
  // Never leave half a formula: drop to the nearest balanced "$".
  const dollars = (s) => (s.match(/(?<!\\)\$/g) || []).length;
  if (dollars(before) % 2)
    before = before.slice(before.search(/(?<!\\)\$/) + 1);
  if (dollars(after) % 2)
    after = after.slice(0, after.search(/(?<!\\)\$(?![\s\S]*(?<!\\)\$)/));
  return (
    (cutBefore ? "…" : "") +
    before.trimStart() +
    `<mark class="backlink-hit">${hit}</mark>` +
    after.trimEnd() +
    (cutAfter ? "…" : "")
  );
}

// Parse one note: its links to local notes and its anchors.
export function parseNote(text, file) {
  const lines = text.split(/\r?\n/);
  const links = [],
    anchors = [],
    slugFor = createSlugger();
  let fence = null,
    section = "",
    pendingAnchors = [];
  const isBlank = (i) => !lines[i] || !lines[i].trim();
  // Paragraph boundaries for snippets: blank lines, headings and fences.
  const boundary = (i) =>
    isBlank(i) || ATX.test(lines[i]) || FENCE.test(lines[i]);
  const code = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE);
    if (fence) {
      code[i] = true;
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      code[i] = true;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const line = lines[i];
    // ATX headings, and setext headings (a paragraph line underlined).
    const atx = line.match(ATX);
    const setext =
      !atx &&
      i + 1 < lines.length &&
      !code[i + 1] &&
      line.trim() &&
      !/^\s*([-*+>|]|\d+[.)])\s/.test(line) &&
      /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1]);
    if (atx || setext) {
      const raw = atx ? atx[2] || "" : line.trim();
      const id = slugFor(headingLabel(raw));
      section = plainText(raw);
      const level = atx
        ? atx[1].length
        : lines[i + 1].trim().startsWith("=")
          ? 1
          : 2;
      anchors.push({ id, kind: "heading", level, line: i + 1, label: section });
      // Explicit anchors just above a heading mark the heading itself.
      for (const anchor of pendingAnchors) anchor.heading = id;
      pendingAnchors = [];
      if (setext) i++;
      continue;
    }
    const stripped = blankCode(line);
    const own = [...stripped.matchAll(ANCHOR)];
    for (const m of own) {
      const anchor = {
        id: m[1],
        kind: "explicit",
        line: i + 1,
        label: "",
        section,
      };
      anchors.push(anchor);
      pendingAnchors.push(anchor);
    }
    // A line with only anchors: what it marks is the next non-blank line.
    const onlyAnchors =
      own.length && !stripped.replace(ANCHOR, "").replace(/<\/a>/gi, "").trim();
    if (!onlyAnchors && line.trim()) {
      for (const anchor of pendingAnchors) anchor.label = anchorLabel(line);
      pendingAnchors = [];
    }
    for (const m of stripped.matchAll(LINK)) {
      if (m[1]) continue; // image
      let href = m[3];
      if (href.startsWith("<")) href = href.slice(1, -1);
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // web, mailto, file:
      const hash = href.indexOf("#");
      let target = hash < 0 ? href : href.slice(0, hash);
      let fragment = hash < 0 ? "" : href.slice(hash + 1);
      try {
        target = decodeURI(target);
        fragment = decodeURIComponent(fragment);
      } catch {
        continue;
      }
      if (target && !markdownPath(target)) continue;
      if (!target && !fragment) continue;
      // The paragraph around the link, for the snippet.
      let top = i,
        bottom = i;
      while (top > 0 && !boundary(top - 1) && !code[top - 1]) top--;
      while (
        bottom + 1 < lines.length &&
        !boundary(bottom + 1) &&
        !code[bottom + 1]
      )
        bottom++;
      const before = lines.slice(top, i).join(" ");
      const offset = before ? before.length + 1 : 0;
      const paragraph = lines.slice(top, bottom + 1).join(" ");
      links.push({
        target: target
          ? path.resolve(path.dirname(file), target)
          : path.resolve(file),
        fragment,
        text: m[2],
        line: i + 1,
        column: m.index + 1,
        section,
        snippet: snippetAround(
          paragraph,
          offset + m.index,
          offset + m.index + m[0].length,
          m[2],
        ),
      });
    }
  }
  return { links, anchors };
}

export function createLinkIndex({
  read = fs.readFile,
  stat = fs.stat,
  readdir = fs.readdir,
} = {}) {
  const notes = new Map(); // pathKey -> { path, mtime, links, anchors }
  let folders = [],
    ready = Promise.resolve();
  const inLibrary = (file) =>
    folders.some((folder) => {
      const rel = path.relative(folder, file);
      return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
    });
  // fresh: the watcher reported a write. Two quick writes can leave the same
  // modification time on Windows, so only a walk trusts it to skip a read.
  async function load(file, fresh = false) {
    const key = pathKey(file);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_BYTES) return notes.delete(key);
      if (!fresh && notes.get(key)?.mtime === info.mtimeMs) return;
      const text = await read(file, "utf8");
      // The text stays for full-text search (at most 5000 notes of 2 MB), with a lower-cased copy.
      notes.set(key, {
        path: file,
        mtime: info.mtimeMs,
        text,
        lower: text.toLowerCase(),
        ...parseNote(text, file),
      });
    } catch {
      notes.delete(key);
    }
  }
  async function walk(folder, found) {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full, found);
      else if (markdownPath(entry.name)) found.push(full);
    }
  }
  return {
    // Index exactly these library folders.
    follow(list) {
      const next = [...new Set(list.map((folder) => path.resolve(folder)))];
      if (next.join("\n") === folders.join("\n")) return ready;
      folders = next;
      ready = (async () => {
        const found = [];
        for (const folder of folders) await walk(folder, found);
        const keep = new Set(found.map(pathKey));
        for (const key of notes.keys()) if (!keep.has(key)) notes.delete(key);
        for (const file of found) await load(file);
      })();
      return ready;
    },
    // A file in the library was written, created, renamed or deleted.
    async changed(file) {
      if (!markdownPath(file) || !inLibrary(file)) return false;
      await ready;
      await load(file, true);
      return true;
    },
    // Links from other notes into this one, with where they come from.
    async backlinks(file) {
      await ready;
      const key = pathKey(file),
        result = [];
      for (const note of notes.values()) {
        if (pathKey(note.path) === key) continue;
        for (const link of note.links)
          if (pathKey(link.target) === key)
            result.push({ ...link, source: note.path });
      }
      return result;
    },
    // This note's anchors (headings and explicit ids), from the index or disk.
    async anchors(file) {
      await ready;
      const note = notes.get(pathKey(file));
      if (note) return note.anchors;
      return parseNote(await read(file, "utf8"), file).anchors;
    },
    // Does a link from this note lead somewhere? "ok", "missing-file" or
    // "missing-anchor". Footnote and line anchors (#L12) are not checked.
    async status(from, href) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return "ok";
      const hash = href.indexOf("#");
      let target = hash < 0 ? href : href.slice(0, hash),
        fragment = hash < 0 ? "" : href.slice(hash + 1);
      try {
        target = decodeURI(target);
        fragment = decodeURIComponent(fragment);
      } catch {
        return "ok";
      }
      if (target && !markdownPath(target)) return "ok";
      const file = target ? path.resolve(path.dirname(from), target) : from;
      try {
        if (!(await stat(file)).isFile()) return "missing-file";
      } catch {
        return "missing-file";
      }
      if (!fragment || /^L\d+(C\d+)?$/i.test(fragment) || /^fn/.test(fragment))
        return "ok";
      const anchors = await this.anchors(file).catch(() => []);
      return anchors.some((a) => a.id === fragment) ? "ok" : "missing-anchor";
    },
    // Every note in the library with its anchors, for the link picker.
    async notes() {
      await ready;
      return [...notes.values()].map((note) => ({
        path: note.path,
        anchors: note.anchors,
      }));
    },
    // Notes whose name or text holds every word of the query (note-search.mjs).
    async search(query, options) {
      await ready;
      const list = [...notes.values()].map((note) => ({
        path: note.path,
        name: path.basename(note.path),
        text: note.text,
        lower: note.lower,
      }));
      return searchNotes(list, query, options);
    },
    // Is this file one of the indexed library notes?
    has(file) {
      return notes.has(pathKey(file));
    },
    get size() {
      return notes.size;
    },
  };
}
