// A folder's index file: a nested Markdown list of links to the folder's
// notes (and subfolders), in the order to show them, indentation being the
// nesting (like mdBook's SUMMARY.md; OneNote exports write `_目录.md`). The
// library tree lists such a folder in the index's order, and dragging in the
// tree rewrites the list. Pure functions: files.mjs reads and writes, and
// the index's own view edits its draft with the same operations
// (applyIndexOp). Edits touch only the lines they move or change, keeping
// bullets, indentation, line endings and a byte order mark.
import { rewriteLinks, linkTarget, pathKey } from "./link-rewrite.mjs";

// Names of index files, the first preferred when a folder has both.
export const INDEX_NAMES = ["_目录.md", "SUMMARY.md"]; // i18n-ignore
const lowerNames = INDEX_NAMES.map((name) => name.toLowerCase());
export const isIndexName = (name) =>
  lowerNames.includes(String(name).toLowerCase());
// The index among a folder's entry names, or null.
export function findIndexName(names) {
  for (const wanted of lowerNames) {
    const hit = names.find((name) => name.toLowerCase() === wanted);
    if (hit) return hit;
  }
  return null;
}

// One list item holding a link: `- [text](href)`, `1. [text](href)`. The
// destination may be in angle brackets (`<My page (1).md>`), hold balanced
// parentheses (`a(b).md`) and a link title (`a.md "see (v2)"`).
export const ITEM =
  /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)\[((?:\\.|[^\]\\])*)\]\((<[^>\n]*>(?:[^()\n]|\([^()\n]*\))*|(?:[^()\\\n]|\\.|\((?:[^()\\\n]|\\.)*\))*)\)/;
export const columns = (indent) => {
  let width = 0;
  for (const c of indent)
    width = c === "\t" ? width + 4 - (width % 4) : width + 1;
  return width;
};

// Which lines hold no entries: front matter (from a first line `---` to the
// next `---` or `...`), fenced code and HTML comments.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
export function indexSkips(lines) {
  const skip = lines.map(() => false);
  let i = 0;
  if (lines.length > 1 && /^---[ \t]*$/.test(lines[0])) {
    let end = 1;
    while (end < lines.length && !/^(---|\.\.\.)[ \t]*$/.test(lines[end]))
      end++;
    if (end < lines.length) {
      for (let k = 0; k <= end; k++) skip[k] = true;
      i = end + 1;
    }
  }
  let fence = null,
    comment = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      skip[i] = true;
      const m = FENCE.exec(line);
      if (
        m &&
        m[1][0] === fence[0] &&
        m[1].length >= fence.length &&
        !line.slice(m[0].length).trim()
      )
        fence = null;
      continue;
    }
    if (comment) {
      skip[i] = true;
      if (line.includes("-->")) comment = false;
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = open[1];
      skip[i] = true;
      continue;
    }
    const at = line.indexOf("<!--");
    if (at >= 0) {
      skip[i] = true;
      if (!line.includes("-->", at + 4)) comment = true;
    }
  }
  return skip;
}

// The index's lines and its linked items: indent (columns), where the item's
// text starts (a child is indented at least that far), the link and its
// nesting (parent: the entry it is under, or -1). Entries are list items
// outside front matter, code and comments; other text between them (not
// blank lines) ends a list, so nothing nests across it.
export function parseIndex(text) {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = bom ? text.slice(1) : text;
  const eol = /\r\n/.test(body) ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const skip = indexSkips(lines);
  const entries = [];
  let stack = [];
  lines.forEach((line, at) => {
    const m = skip[at] ? null : ITEM.exec(line);
    if (!m) {
      if (skip[at] || line.trim()) stack = [];
      return;
    }
    const indent = columns(m[1]);
    const content = indent + m[2].length + columns(m[3]);
    while (stack.length && indent < entries[stack.at(-1)].content) stack.pop();
    entries.push({
      line: at,
      indent,
      lead: m[1],
      content,
      marker: m[2],
      text: m[4],
      href: m[5],
      parent: stack.length ? stack.at(-1) : -1,
    });
    stack.push(entries.length - 1);
  });
  return { bom, eol, lines, entries };
}

// The folder child a link names: `Page.md`, `Folder/`, `Folder` or
// `Folder/_目录.md` (a folder's own index); null for a link elsewhere
// (deeper, outside, another site).
export function childName(href) {
  let target = String(href).trim();
  const angle = /^<([^>]*)>/.exec(target);
  target = angle ? angle[1] : target.split(/\s+/)[0];
  target = target.replace(/[#?].*$/, "");
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || /^[\\/]/.test(target))
    return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    /* Kept as written. */
  }
  const parts = target.split(/[\\/]/).filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && isIndexName(parts[1])) return parts[0];
  return null;
}

// The folder's children in the index's order: [{ name, depth }], each child
// once (its first link), depth counting only the shown entries above it.
// has(name) → the actual name of an existing child (any letter case), or null.
export function indexOrder(text, has) {
  const { entries } = parseIndex(text);
  const shown = new Map();
  const seen = new Set();
  const out = [];
  entries.forEach((entry, i) => {
    const name = childName(entry.href);
    const real = name && has(name);
    if (!real || seen.has(real.toLowerCase())) return;
    seen.add(real.toLowerCase());
    let up = entry.parent;
    while (up >= 0 && !shown.has(up)) up = entries[up].parent;
    const depth = up >= 0 ? shown.get(up) + 1 : 0;
    shown.set(i, depth);
    out.push({ name: real, depth });
  });
  return out;
}

// The entry linking to this child (first one), or -1.
export function entryOf(parsed, name) {
  const lower = String(name).toLowerCase();
  return parsed.entries.findIndex(
    (entry) => childName(entry.href)?.toLowerCase() === lower,
  );
}
// An entry named by its child's name ("Page.md", "Folder") or by its line
// ({ line }, from 0: for entries whose link names no child, such as a
// missing note), or -1.
function find(parsed, ref) {
  if (ref && typeof ref === "object" && Number.isInteger(ref.line))
    return parsed.entries.findIndex((entry) => entry.line === ref.line);
  return typeof ref === "string" && ref ? entryOf(parsed, ref) : -1;
}
// The last line of an entry's sub-list (its own line when it has none).
function lastLine(parsed, i) {
  const { entries } = parsed;
  let end = entries[i].line;
  for (let k = i + 1; k < entries.length; k++) {
    let up = entries[k].parent;
    while (up >= 0 && up !== i) up = entries[up].parent;
    if (up !== i) break;
    end = entries[k].line;
  }
  return end;
}
// A link to a child, written as links in such indexes are: spaces and the
// characters that would end the link percent-encoded, other text as is.
export const hrefFor = (name, folder = false) =>
  name.replace(/[%\s()<>[\]#?]/g, (c) =>
    [...new TextEncoder().encode(c)]
      .map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0"))
      .join(""),
  ) + (folder ? "/" : "");
const escapeTitle = (title) => title.replace(/[[\]\\]/g, "\\$&");
// The title a new entry gets: the note's name without its extension.
export const titleFor = (name) => name.replace(/\.(md|markdown|txt)$/i, "");
const titleOf = (name) => escapeTitle(titleFor(name));
// Whether an entry is a folder's: its link ends in "/" or names the
// folder's own index; otherwise as isFolder(child name) says.
function folderEntry(entry, isFolder) {
  const href = String(entry.href).trim().replace(/^<|>$/g, "");
  const target = href.split(/[\s#?]/)[0];
  if (/[\\/]$/.test(target)) return true;
  const parts = target.split(/[\\/]/).filter((p) => p && p !== ".");
  if (parts.length === 2 && isIndexName(decodeSafe(parts[1]))) return true;
  const name = childName(entry.href);
  return Boolean(name && isFolder?.(name));
}
function decodeSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
// The entries under the same parent as entry i, in order.
const siblings = (parsed, i) =>
  parsed.entries
    .map((entry, k) => k)
    .filter((k) => parsed.entries[k].parent === parsed.entries[i].parent);
// Lines moved to another level: the block's own indentation (`from`
// columns) becomes `lead`; blank lines stay blank.
function reindent(block, from, lead) {
  return block.map((line) => {
    if (!line.trim()) return line;
    let i = 0;
    let width = 0;
    while (i < line.length && width < from && /[ \t]/.test(line[i])) {
      width = line[i] === "\t" ? width + 4 - (width % 4) : width + 1;
      i++;
    }
    // A tab reaching past the width taken away: the columns beyond it
    // stay, as spaces (as the index view does, src/index-list.js).
    return lead + " ".repeat(Math.max(0, width - from)) + line.slice(i);
  });
}
// The marker a new entry gets next to `entry`: the same bullet, or the
// next number of a numbered list (step 0: the same number).
function markerBeside(entry, step = 1) {
  const number = /^(\d+)([.)])$/.exec(entry.marker);
  return number ? Number(number[1]) + step + number[2] : entry.marker;
}
const newEntry = (marker, name, { folder = false, title } = {}) =>
  `${marker} [${title != null ? escapeTitle(title) : titleOf(name)}](${hrefFor(name, folder)})`;
const finish = (parsed, out, text) => {
  const result = parsed.bom + out.join(parsed.eol);
  return result === text ? null : result;
};

// The core of the moves: entry `from` (with its sub-list) or a new line
// (from = -1) put before, after or into (as the last sub-item of) entry
// `to`. Returns the new text, or null.
function moveBlock(text, parsed, from, to, place, line = null) {
  const { lines, entries } = parsed;
  if (to < 0 || !["before", "after", "into"].includes(place)) return null;
  let block;
  let fromIndent = 0;
  let start = -1;
  if (from >= 0) {
    if (from === to) return null;
    // Not into its own sub-list.
    let up = entries[to].parent;
    while (up >= 0 && up !== from) up = entries[up].parent;
    if (up === from) return null;
    start = entries[from].line;
    block = lines.slice(start, lastLine(parsed, from) + 1);
    fromIndent = entries[from].indent;
  } else if (line !== null) block = [line];
  else return null;
  const goal = entries[to];
  let lead = goal.lead;
  if (place === "into") {
    // As the entry's sub-items are indented, or under its text.
    const child = entries.findIndex((entry) => entry.parent === to);
    // In an index that nests with tabs: a tab, and spaces after it when
    // the entry's text starts further in (a wide number), so the sub-item
    // still reaches it.
    const tabbed =
      goal.lead.includes("\t") ||
      entries.some((entry) => entry.parent >= 0 && entry.lead.includes("\t"));
    lead =
      child >= 0
        ? entries[child].lead
        : tabbed
          ? goal.lead +
            "\t" +
            " ".repeat(Math.max(0, goal.content - columns(goal.lead + "\t")))
          : " ".repeat(goal.content);
  }
  const moved = reindent(block, fromIndent, lead);
  let at = place === "before" ? goal.line : lastLine(parsed, to) + 1;
  const out = lines.slice();
  if (start >= 0) {
    out.splice(start, block.length);
    if (at > start) at -= block.length;
  }
  out.splice(at, 0, ...moved);
  return finish(parsed, out, text);
}

// The index with one child's entry (and the entries under it) moved before,
// after or into (as its last sub-item) another child's entry. A child not
// listed yet gets a new entry (insert: { folder }). Returns the new text, or
// null when nothing changes or the move is not possible.
export function moveInIndex(text, name, target, place, insert = null) {
  const parsed = parseIndex(text);
  const to = find(parsed, target);
  if (to < 0) return null;
  const from = find(parsed, name);
  if (from >= 0) return moveBlock(text, parsed, from, to, place);
  if (!insert || typeof name !== "string") return null;
  const goal = parsed.entries[to];
  // A numbered list stays one list: the new entry is numbered too.
  const marker =
    place === "into"
      ? (() => {
          const kids = parsed.entries.filter((entry) => entry.parent === to);
          return kids.length
            ? markerBeside(kids.at(-1))
            : goal.marker.replace(/^\d+/, "1");
        })()
      : markerBeside(goal, place === "before" ? 0 : 1);
  return moveBlock(text, parsed, -1, to, place, newEntry(marker, name, insert));
}

// A new entry for a child: under another child's entry (as its last
// sub-item), right after one (and its sub-items), or at the end of the
// list (a list started at the end of the file when there is none).
// options: { folder, title, under, after }. null when it is listed already
// or the entry to go under or after is not.
export function insertEntry(text, name, options = {}) {
  const parsed = parseIndex(text);
  if (find(parsed, name) >= 0) return null;
  const { under, after } = options;
  if (under != null) return moveInIndex(text, name, under, "into", options);
  if (after != null) return moveInIndex(text, name, after, "after", options);
  const { lines, entries } = parsed;
  const tops = entries.map((e, k) => k).filter((k) => entries[k].parent < 0);
  if (tops.length) {
    const last = tops.at(-1);
    return moveBlock(
      text,
      parsed,
      -1,
      last,
      "after",
      newEntry(markerBeside(entries[last]), name, options),
    );
  }
  // No list yet: one at the end, after a blank line.
  const out = lines.slice();
  while (out.length && !out.at(-1).trim()) out.pop();
  if (out.length) out.push("");
  out.push(newEntry("-", name, options), "");
  return finish(parsed, out, text);
}

// The index without a child's entry. Its sub-items move up a level in its
// place, or go with it (subtree). null when it is not listed.
export function removeEntry(text, ref, { subtree = false } = {}) {
  const parsed = parseIndex(text);
  const i = find(parsed, ref);
  if (i < 0) return null;
  const { lines, entries } = parsed;
  const start = entries[i].line,
    end = lastLine(parsed, i);
  const out = lines.slice();
  if (subtree || end === start) out.splice(start, end - start + 1);
  else {
    const child = entries.findIndex((entry) => entry.parent === i);
    const rest = reindent(
      lines.slice(start + 1, end + 1),
      entries[child].indent,
      entries[i].lead,
    );
    out.splice(start, end - start + 1, ...rest);
  }
  return finish(parsed, out, text);
}

// Indent: the entry (with its sub-items) becomes the last sub-item of the
// entry before it at its level. Only notes nest: neither a folder's entry
// nor anything under one. isFolder(child name) tells folders from notes
// where the link alone does not.
export function indentEntry(text, ref, { isFolder } = {}) {
  const parsed = parseIndex(text);
  const i = find(parsed, ref);
  if (i < 0) return null;
  const level = siblings(parsed, i);
  const before = level[level.indexOf(i) - 1];
  if (before === undefined) return null;
  const { entries } = parsed;
  if (
    folderEntry(entries[i], isFolder) ||
    folderEntry(entries[before], isFolder)
  )
    return null;
  return moveBlock(text, parsed, i, before, "into");
}
// Outdent: the entry (with its sub-items) goes right after its parent's
// sub-list, at the parent's level.
export function outdentEntry(text, ref) {
  const parsed = parseIndex(text);
  const i = find(parsed, ref);
  if (i < 0 || parsed.entries[i].parent < 0) return null;
  return moveBlock(text, parsed, i, parsed.entries[i].parent, "after");
}
// Up (step -1) or down (step 1) past the entry before or after it at its
// level, sub-items going along.
export function shiftEntry(text, ref, step) {
  const parsed = parseIndex(text);
  const i = find(parsed, ref);
  if (i < 0) return null;
  const level = siblings(parsed, i);
  const other = level[level.indexOf(i) + (step < 0 ? -1 : 1)];
  if (other === undefined) return null;
  return moveBlock(text, parsed, i, other, step < 0 ? "before" : "after");
}
// A child renamed: links to it follow (entries and any other link in the
// file: anchor, angle brackets and encoding kept), and an entry whose title
// was the old name gets the new one; a title of its own stays.
export function renameInIndex(text, from, to) {
  // The index's folder stands for any: only names matter here.
  const folder = "/index-folder";
  let next = rewriteLinks(text, {
    file: folder + "/_index.md",
    moves: [[folder + "/" + from, folder + "/" + to]],
  }).text;
  const parsed = parseIndex(next);
  const old = titleOf(from);
  const lines = parsed.lines.slice();
  for (const entry of parsed.entries) {
    if (childName(entry.href)?.toLowerCase() !== to.toLowerCase()) continue;
    if (entry.text !== old) continue;
    const line = lines[entry.line];
    const open = line.indexOf("[", entry.lead.length + entry.marker.length);
    lines[entry.line] =
      line.slice(0, open + 1) + titleOf(to) + line.slice(open + 1 + old.length);
  }
  next = parsed.bom + lines.join(parsed.eol);
  return next === text ? null : next;
}
// An entry's title (the link's text) set; the link stays.
export function retitleEntry(text, ref, title) {
  const parsed = parseIndex(text);
  const i = find(parsed, ref);
  if (i < 0 || typeof title !== "string" || !title.trim()) return null;
  const entry = parsed.entries[i];
  const lines = parsed.lines.slice();
  const line = lines[entry.line];
  const open = line.indexOf("[", entry.lead.length + entry.marker.length);
  lines[entry.line] =
    line.slice(0, open + 1) +
    escapeTitle(title.trim().replace(/\s+/g, " ")) +
    line.slice(open + 1 + entry.text.length);
  return finish(parsed, lines, text);
}

// The entries that can be missing, as the index view shows them: a note
// or folder named in the index's folder (an attachment is never shown
// missing), or a note linked deeper or outside. [{ entry, name, target }]:
// name the child's name (or null), target the path it leads to ("/"-joined
// from `file`, the index). The caller checks which are there.
const NOTE_NAME = /\.(md|markdown|mdown|mkd|txt)$/i;
const EXTENSION = /\.[a-z][a-z0-9]{0,7}$/i;
export function checkableEntries(text, file) {
  const out = [];
  const seen = new Set();
  for (const entry of parseIndex(text).entries) {
    let href = String(entry.href).trim();
    const angle = /^<([^>]*)>/.exec(href);
    href = angle ? `<${angle[1]}>` : href.split(/\s+/)[0];
    const name = childName(entry.href);
    const target = linkTarget(href, file);
    if (!target) continue;
    const isFolder = /[\\/]$/.test(href.replace(/^<|>$/g, "").split(/[#?]/)[0]);
    const kept = name
      ? NOTE_NAME.test(name) || isFolder || !EXTENSION.test(name)
      : NOTE_NAME.test(target);
    if (!kept || seen.has(pathKey(target))) continue;
    seen.add(pathKey(target));
    out.push({ entry, name, target });
  }
  return out;
}
// The entries linking to `target` (an absolute path; the index is `file`)
// taken out, their sub-items moving up a level; null when there are none.
export function removeEntriesTo(text, file, target) {
  const want = pathKey(target);
  const lines = parseIndex(text)
    .entries.filter((entry) => {
      let href = String(entry.href).trim();
      const angle = /^<([^>]*)>/.exec(href);
      href = angle ? `<${angle[1]}>` : href.split(/\s+/)[0];
      const to = linkTarget(href, file);
      return to && pathKey(to) === want;
    })
    .map((entry) => entry.line)
    .reverse();
  let out = text;
  for (const line of lines) out = removeEntry(out, { line }) ?? out;
  return out === text ? null : out;
}
// A child's entry and the entries under it that name children, in order:
// [{ name, title, parent }] (title unescaped; parent: the name of the entry
// it is under, null for the first). [] when it is not listed.
export function subtreeOf(text, ref) {
  const parsed = parseIndex(text);
  const i = find(parsed, ref);
  if (i < 0) return [];
  const { entries } = parsed;
  const out = [];
  const nameOf = new Map();
  const end = lastLine(parsed, i);
  const seen = new Set();
  for (let k = i; k < entries.length && entries[k].line <= end; k++) {
    const name = childName(entries[k].href);
    // A child listed twice counts once (its first entry).
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    // The nearest entry above it that names a child.
    let up = entries[k].parent;
    while (up >= 0 && !nameOf.has(up)) up = entries[up].parent;
    nameOf.set(k, name);
    out.push({
      name,
      title: entries[k].text.replace(/\\(.)/g, "$1"),
      parent: k === i || up < 0 ? null : nameOf.get(up),
    });
  }
  return out;
}

// One operation on an index's text, as the tree and the index's own view
// ask for it (the same through the preload bridge). Returns the new text,
// or null when nothing changes or it is not possible. ref: a child's name
// or { line }.
// - { kind: "move", ref, target, place: "before" | "after" | "into", folder }
// - { kind: "insert", name, folder, title, under, after }
// - { kind: "remove", ref, subtree }
// - { kind: "indent", ref, folders: [names of folders] }
// - { kind: "outdent", ref }
// - { kind: "shift", ref, step: -1 | 1 }
// - { kind: "rename", from, to }
// - { kind: "retitle", ref, title }
export function applyIndexOp(text, op = {}) {
  if (typeof text !== "string" || !op || typeof op !== "object") return null;
  const folders = new Set(
    (Array.isArray(op.folders) ? op.folders : []).map((n) =>
      String(n).toLowerCase(),
    ),
  );
  const isFolder = (name) => folders.has(name.toLowerCase());
  switch (op.kind) {
    case "move":
      return moveInIndex(text, op.ref, op.target, op.place, {
        folder: Boolean(op.folder),
      });
    case "insert":
      if (typeof op.name !== "string" || !op.name) return null;
      return insertEntry(text, op.name, {
        folder: Boolean(op.folder),
        title: typeof op.title === "string" ? op.title : undefined,
        under: op.under ?? null,
        after: op.after ?? null,
      });
    case "remove":
      return removeEntry(text, op.ref, { subtree: Boolean(op.subtree) });
    case "indent":
      return indentEntry(text, op.ref, { isFolder });
    case "outdent":
      return outdentEntry(text, op.ref);
    case "shift":
      return shiftEntry(text, op.ref, op.step);
    case "rename":
      if (typeof op.from !== "string" || typeof op.to !== "string") return null;
      return renameInIndex(text, op.from, op.to);
    case "retitle":
      return retitleEntry(text, op.ref, op.title);
    default:
      return null;
  }
}

// A new index for a folder: its name as the title, then its children in
// the order given ([{ name, folder, index }]; a folder with its own index
// is linked to it, as OneNote exports do).
export function newIndexText(title, children, eol = "\n") {
  const lines = [`# ${title}`, ""];
  for (const child of children) {
    const href = child.folder
      ? hrefFor(child.name) + "/" + (child.index ? hrefFor(child.index) : "")
      : hrefFor(child.name);
    lines.push(`- [${titleOf(child.name)}](${href})`);
  }
  lines.push("");
  return lines.join(eol);
}
