// A folder's index file: a nested Markdown list of links to the folder's
// notes (and subfolders), in the order to show them, indentation being the
// nesting (like mdBook's SUMMARY.md; OneNote exports write `_目录.md`). The
// library tree lists such a folder in the index's order, and dragging in the
// tree rewrites the list. Pure functions: files.mjs reads and writes.

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

// One list item holding a link: `- [text](href)`, `1. [text](href)`.
const ITEM =
  /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/;
const columns = (indent) => {
  let width = 0;
  for (const c of indent)
    width = c === "\t" ? width + 4 - (width % 4) : width + 1;
  return width;
};

// The index's lines and its linked items: indent (columns), where the item's
// text starts (a child is indented at least that far), the link and its
// nesting (parent: the entry it is under, or -1).
export function parseIndex(text) {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = bom ? text.slice(1) : text;
  const eol = /\r\n/.test(body) ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const entries = [];
  const stack = [];
  lines.forEach((line, at) => {
    const m = ITEM.exec(line);
    if (!m) return;
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
  name.replace(/[%\s()<>[\]]/g, (c) =>
    [...new TextEncoder().encode(c)]
      .map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0"))
      .join(""),
  ) + (folder ? "/" : "");
const titleOf = (name) =>
  name.replace(/\.(md|markdown|txt)$/i, "").replace(/[[\]\\]/g, "\\$&");

// The index with one child's entry (and the entries under it) moved before,
// after or into (as its last sub-item) another child's entry. A child not
// listed yet gets a new entry (insert: { folder }). Returns the new text, or
// null when nothing changes or the move is not possible.
export function moveInIndex(text, name, target, place, insert = null) {
  const parsed = parseIndex(text);
  const { lines, entries } = parsed;
  const to = entryOf(parsed, target);
  if (to < 0 || !["before", "after", "into"].includes(place)) return null;
  const from = entryOf(parsed, name);
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
  } else {
    if (!insert) return null;
    const marker = /^\d/.test(entries[to].marker) ? "-" : entries[to].marker;
    block = [`${marker} [${titleOf(name)}](${hrefFor(name, insert.folder)})`];
  }
  const goal = entries[to];
  const indent = place === "into" ? goal.content : goal.indent;
  const lead =
    place === "into"
      ? goal.lead.includes("\t")
        ? goal.lead + "\t"
        : " ".repeat(indent)
      : goal.lead;
  // Re-indent: the block's own indentation becomes the target's.
  const moved = block.map((line) => {
    if (!line.trim()) return line;
    let i = 0;
    let width = 0;
    while (i < line.length && width < fromIndent && /[ \t]/.test(line[i])) {
      width = line[i] === "\t" ? width + 4 - (width % 4) : width + 1;
      i++;
    }
    return lead + line.slice(i);
  });
  let at = place === "before" ? goal.line : lastLine(parsed, to) + 1;
  const out = lines.slice();
  if (start >= 0) {
    out.splice(start, block.length);
    if (at > start) at -= block.length;
  }
  out.splice(at, 0, ...moved);
  const result = parsed.bom + out.join(parsed.eol);
  return result === text ? null : result;
}
