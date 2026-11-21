// The link list of a folder's index file (_目录.md, SUMMARY.md) as the
// managed index view edits it (src/folder-index-view.js). Pure functions on
// the note's text: each edit changes only the lines it must (one line for a
// new title, the moved lines for a move) and keeps everything else as
// written: front matter, headings, prose, comments, code, the BOM, each
// line's own line ending, bullet characters and tabs or spaces.
//
// Marklore owns only the entry lines: a list item that starts with a link
// (`- [Title](Page.md)`, `1. [Title](Page.md)`), outside front matter, code
// fences and HTML comments. Consecutive entries (blank lines may sit between
// them) form a run; within a run indentation is nesting, as the library tree
// reads it (desktop/folder-index.mjs).
import {
  ITEM,
  columns,
  childName,
  hrefFor,
  indexSkips,
} from "../desktop/folder-index.mjs";

// The text's lines, entries and runs.
export function scanIndex(text) {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const parts = text.slice(bom.length).split(/(\r\n|\n)/);
  const lines = [];
  let offset = bom.length;
  for (let i = 0; i < parts.length; i += 2) {
    const own = parts[i],
      eol = parts[i + 1] ?? "";
    lines.push({ text: own, eol, start: offset });
    offset += own.length + eol.length;
  }
  let crlf = 0,
    lf = 0;
  for (const line of lines)
    if (line.eol === "\r\n") crlf++;
    else if (line.eol === "\n") lf++;
  // Front matter, code and comments hold no entries.
  const skip = indexSkips(lines.map((line) => line.text));
  const entries = [],
    runs = [];
  let run = null,
    stack = [];
  for (let k = 0; k < lines.length; k++) {
    const m = skip[k] ? null : ITEM.exec(lines[k].text);
    if (!m) {
      // Blank lines may sit between a run's entries; anything else ends it.
      if (run && !skip[k] && !lines[k].text.trim()) continue;
      run = null;
      stack = [];
      continue;
    }
    if (!run) {
      run = { index: runs.length, entries: [], roots: [], first: k, last: k };
      runs.push(run);
    }
    const lead = m[1],
      indent = columns(lead),
      content = indent + m[2].length + columns(m[3]);
    while (stack.length && indent < entries[stack.at(-1)].content) stack.pop();
    const labelFrom = m[1].length + m[2].length + m[3].length + 1,
      labelTo = labelFrom + m[4].length;
    const entry = {
      index: entries.length,
      line: k,
      run: run.index,
      lead,
      indent,
      content,
      marker: m[2],
      gap: m[3],
      label: m[4],
      title: unescapeLabel(m[4]),
      href: m[5],
      name: childName(m[5]),
      labelFrom,
      labelTo,
      hrefFrom: labelTo + 2,
      hrefTo: labelTo + 2 + m[5].length,
      rest: lines[k].text.slice(m[0].length),
      parent: stack.length ? stack.at(-1) : -1,
      depth: stack.length,
      children: [],
    };
    if (entry.parent >= 0) entries[entry.parent].children.push(entry.index);
    else run.roots.push(entry.index);
    entries.push(entry);
    run.entries.push(entry.index);
    run.last = k;
    stack.push(entry.index);
  }
  // Runs end at their last entry: blank lines after it are not theirs.
  return {
    source: text,
    bom,
    lines,
    eol: crlf > lf ? "\r\n" : "\n",
    skip,
    entries,
    runs,
  };
}

export const unescapeLabel = (label) =>
  label.replace(/\\([\\[\]])/g, (_, c) => c);
export const escapeLabel = (title) =>
  String(title).replace(/[\\[\]]/g, (c) => "\\" + c);
// The title a new entry for a file gets: its name without the extension.
export const titleFor = (name) => name.replace(/\.(md|markdown|txt)$/i, "");
export { hrefFor };

// The last entry under entry i (i itself when it has none).
function lastUnder(scan, i) {
  const entry = scan.entries[i];
  return entry.children.length
    ? lastUnder(scan, entry.children.at(-1))
    : entry.index;
}
// Is `inner` entry `outer` or under it?
function within(scan, inner, outer) {
  for (let at = inner; at >= 0; at = scan.entries[at].parent)
    if (at === outer) return true;
  return false;
}
// The entries beside entry i at its level, in order (i among them).
export function siblings(scan, i) {
  const entry = scan.entries[i];
  return entry.parent >= 0
    ? scan.entries[entry.parent].children
    : scan.runs[entry.run].roots;
}

// A line's indentation of `width` columns replaced by `lead`.
function reindent(text, width, lead) {
  let i = 0,
    w = 0;
  while (i < text.length && w < width && /[ \t]/.test(text[i])) {
    w = text[i] === "\t" ? w + 4 - (w % 4) : w + 1;
    i++;
  }
  // A tab reaching past the width: the columns beyond it stay, as spaces.
  return lead + " ".repeat(w - Math.min(w, width)) + text.slice(i);
}
const leadOf = (text) => /^[ \t]*/.exec(text)[0];
// The indentation a first sub-item of `goal` gets: tabs where the index
// nests with tabs, else as many spaces as its nesting steps (at least to
// where the goal's text starts, as Markdown needs).
function childLead(scan, goal) {
  const nested = scan.entries.filter((entry) => entry.parent >= 0);
  if (goal.lead.includes("\t") || nested.some((e) => e.lead.includes("\t"))) {
    // A tab, and spaces after it when the goal's text starts further in.
    const lead = goal.lead + "\t";
    return lead + " ".repeat(Math.max(0, goal.content - columns(lead)));
  }
  const pair = nested[0];
  const step = pair ? pair.indent - scan.entries[pair.parent].indent : 0;
  return goal.lead + " ".repeat(Math.max(step, goal.content - goal.indent));
}
const ordered = (marker) => /^\d/.test(marker);
// A marker of the same kind as `like` (bullet character, or numbered with
// its delimiter), numbered `n` when numbered.
function markerLike(like, n = 1) {
  return ordered(like) ? `${n}${like.at(-1)}` : like;
}
const numberOf = (marker) => (ordered(marker) ? parseInt(marker, 10) : 1);

// Where an entry placed before, after or into (as its last sub-item) `goal`
// goes: the line it is inserted at, its indentation and its marker.
function placement(scan, goal, place) {
  const { entries } = scan;
  if (place === "before")
    return {
      at: goal.line,
      lead: goal.lead,
      marker: markerLike(goal.marker, numberOf(goal.marker)),
      gap: goal.gap,
    };
  if (place === "after")
    return {
      at: entries[lastUnder(scan, goal.index)].line + 1,
      lead: goal.lead,
      marker: markerLike(goal.marker, numberOf(goal.marker) + 1),
      gap: goal.gap,
    };
  if (goal.children.length) {
    const last = entries[goal.children.at(-1)];
    return { ...placement(scan, last, "after") };
  }
  return {
    at: goal.line + 1,
    lead: childLead(scan, goal),
    marker: ordered(goal.marker) ? markerLike(goal.marker) : goal.marker,
    gap: goal.gap,
  };
}

// The new text from edited lines, as one change to the old text, and the
// line to show as the one acted on. Line endings stay each line's own; a
// line that moves from the end gets the index's usual one, and the text
// ends with or without a line ending as before.
function finish(scan, lines, line) {
  for (let i = 0; i < lines.length - 1; i++)
    if (!lines[i].eol) lines[i] = { ...lines[i], eol: scan.eol };
  if (lines.length) lines[lines.length - 1] = { ...lines.at(-1), eol: "" };
  const text = scan.bom + lines.map((l) => l.text + l.eol).join("");
  const change = difference(scan.source, text);
  return change ? { text, change, line } : null;
}
// One change {from, to, insert} turning a into b (null when equal).
export function difference(a, b) {
  if (a === b) return null;
  let from = 0;
  while (from < a.length && from < b.length && a[from] === b[from]) from++;
  let end = 0;
  while (
    end < a.length - from &&
    end < b.length - from &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return { from, to: a.length - end, insert: b.slice(from, b.length - end) };
}
const copy = (scan) => scan.lines.map(({ text, eol }) => ({ text, eol }));

// Entry i (and the entries under it) moved before, after or into (as the
// last sub-item) entry `target`. Its first line takes the marker kind of
// its new neighbours; the lines under it keep theirs.
export function moveEntry(text, i, target, place) {
  const scan = scanIndex(text);
  const { entries } = scan;
  const from = entries[i],
    goal = entries[target];
  if (!from || !goal || !["before", "after", "into"].includes(place))
    return null;
  if (within(scan, target, i)) return null;
  const spot = placement(scan, goal, place);
  const start = from.line,
    end = entries[lastUnder(scan, i)].line;
  const lines = copy(scan);
  const block = lines.slice(start, end + 1).map((line, k) => {
    if (!line.text.trim()) return line;
    let moved = reindent(line.text, from.indent, spot.lead);
    if (k === 0 && ordered(from.marker) !== ordered(spot.marker))
      moved =
        spot.lead +
        markerLike(spot.marker, numberOf(spot.marker)) +
        moved.slice(spot.lead.length + from.marker.length);
    else if (k === 0 && !ordered(from.marker) && from.marker !== spot.marker)
      moved = spot.lead + spot.marker + moved.slice(spot.lead.length + 1);
    return { ...line, text: moved };
  });
  // The lines under it stay under it when its text now starts further in
  // (a wider marker): each keeps its distance from where that text starts.
  const head = ITEM.exec(block[0].text);
  const content = columns(head[1]) + head[2].length + columns(head[3]);
  for (let k = 1; k < block.length; k++) {
    const own = lines[start + k].text;
    if (!own.trim()) continue;
    const need = columns(leadOf(own)) - from.content + content,
      lead = leadOf(block[k].text),
      have = columns(lead);
    if (have < need)
      block[k] = {
        ...block[k],
        text: lead + " ".repeat(need - have) + block[k].text.slice(lead.length),
      };
  }
  let at = spot.at;
  lines.splice(start, block.length);
  if (at > start) at -= block.length;
  lines.splice(at, 0, ...block);
  return finish(scan, lines, at);
}
// Tab: entry i becomes the last sub-item of the entry before it at its level.
export function indentEntry(text, i) {
  const scan = scanIndex(text);
  if (!scan.entries[i]) return null;
  const level = siblings(scan, i);
  const at = level.indexOf(i);
  return at > 0 ? moveEntry(text, i, level[at - 1], "into") : null;
}
// Shift+Tab: entry i goes after the entry it is under, one level out.
export function outdentEntry(text, i) {
  const scan = scanIndex(text);
  const entry = scan.entries[i];
  return entry && entry.parent >= 0
    ? moveEntry(text, i, entry.parent, "after")
    : null;
}
// Alt+↑/↓: past the entry before or after it at its level.
export function shiftEntry(text, i, step) {
  const scan = scanIndex(text);
  if (!scan.entries[i]) return null;
  const level = siblings(scan, i);
  const other = level[level.indexOf(i) + (step < 0 ? -1 : 1)];
  return other == null
    ? null
    : moveEntry(text, i, other, step < 0 ? "before" : "after");
}

// A new entry `[title](href)` before, after or into entry `target`; with no
// target, after the last top-level entry of the last run, or at the end of
// a text with no entries yet (after a blank line).
export function insertEntry(
  text,
  { title, href },
  target = -1,
  place = "after",
) {
  const scan = scanIndex(text);
  const link = `[${escapeLabel(title)}](${href})`;
  const lines = copy(scan);
  let goal = scan.entries[target];
  if (!goal && scan.runs.length) {
    goal = scan.entries[scan.runs.at(-1).roots.at(-1)];
    place = "after";
  }
  if (!goal) {
    // No list yet: a blank line after the text, then the entry.
    const last = lines.at(-1);
    if (last.text.trim())
      lines.push({ text: "", eol: "" }, { text: "", eol: "" });
    else if (lines.length > 1 && lines.at(-2).text.trim())
      lines.splice(lines.length - 1, 0, { text: "", eol: "" });
    const at = lines.length - 1;
    lines.splice(at, 0, { text: "- " + link, eol: "" });
    return finish(scan, lines, at);
  }
  const spot = placement(scan, goal, place);
  lines.splice(spot.at, 0, {
    text: spot.lead + spot.marker + spot.gap + link,
    eol: "",
  });
  return finish(scan, lines, spot.at);
}

// Entry i's line taken out of the index; the entries under it move up a
// level in its place (their files stay, and stay listed).
export function removeEntry(text, i) {
  const scan = scanIndex(text);
  const entry = scan.entries[i];
  if (!entry) return null;
  const lines = copy(scan);
  const end = scan.entries[lastUnder(scan, i)].line;
  if (entry.children.length) {
    const width = scan.entries[entry.children[0]].indent;
    for (let k = entry.line + 1; k <= end; k++)
      if (lines[k].text.trim())
        lines[k] = {
          ...lines[k],
          text: reindent(lines[k].text, width, entry.lead),
        };
  }
  lines.splice(entry.line, 1);
  // The entry shown next: the first one under it, else the one before.
  const next = entry.children.length
    ? entry.line
    : i > 0
      ? scan.entries[i - 1].line
      : null;
  return finish(scan, lines, next);
}

// Entry i's link text replaced (the link itself as it was).
export function retitleEntry(text, i, title) {
  const scan = scanIndex(text);
  const entry = scan.entries[i];
  const clean = String(title)
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!entry || !clean || clean === entry.title) return null;
  const lines = copy(scan);
  const own = lines[entry.line].text;
  lines[entry.line] = {
    ...lines[entry.line],
    text:
      own.slice(0, entry.labelFrom) +
      escapeLabel(clean) +
      own.slice(entry.labelTo),
  };
  return finish(scan, lines, entry.line);
}
// Entry i pointed at another file: only the link's target changes, its
// angle brackets and link title stay.
export function relinkEntry(text, i, href) {
  const scan = scanIndex(text);
  const entry = scan.entries[i];
  if (!entry) return null;
  const m = /^(\s*)(<[^>]*>|\S*)([\s\S]*)$/.exec(entry.href);
  const target = m[2].startsWith("<") ? `<${decodeHref(href)}>` : href;
  const lines = copy(scan);
  const own = lines[entry.line].text;
  lines[entry.line] = {
    ...lines[entry.line],
    text:
      own.slice(0, entry.hrefFrom) +
      m[1] +
      target +
      m[3] +
      own.slice(entry.hrefTo),
  };
  return finish(scan, lines, entry.line);
}
function decodeHref(href) {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

// A note's first sentence, for the index view to show beside its entry
// (never written anywhere): the first paragraph's text after front matter,
// headings, code, tables and images; else its first heading, if that is
// not its title. Plain text, at most about 60 characters.
export function noteExcerpt(text, title = "") {
  let body = String(text).replace(/^﻿/, "");
  const front =
    /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(body);
  if (front) body = body.slice(front[0].length);
  let fence = false,
    comment = false,
    heading = "";
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(`{3,}|~{3,})/.test(line)) {
      fence = !fence;
      continue;
    }
    if (comment) {
      if (line.includes("-->")) comment = false;
      continue;
    }
    if (fence || !line) continue;
    if (line.startsWith("<!--")) {
      if (!line.includes("-->")) comment = true;
      continue;
    }
    const h = /^#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (h) {
      heading ||= h[1];
      continue;
    }
    if (/^(\||[-*_=]{3,}$|!\[|\$\$|<\/?[a-z][^>]*>$|\[\^)/i.test(line))
      continue;
    const plain = plainText(
      line
        .replace(/^(>[ \t]?)+/, "")
        .replace(/^([-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\][ \t]+)?/, ""),
    );
    if (plain) return sentence(plain);
  }
  const fallback = plainText(heading);
  return fallback && fallback !== String(title).trim()
    ? sentence(fallback)
    : "";
}
function plainText(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_, label) => label)
    .replace(
      /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g,
      (_, page, label) => label || page,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|~~|==)(?=\S)([\s\S]*?\S)\1/g, (_, _m, inner) => inner)
    .replace(
      /(^|[^\w*])\*(?=\S)([^*]*?\S)\*/g,
      (_, before, inner) => before + inner,
    )
    .replace(/`+([^`]*)`+/g, (_, inner) => inner)
    .replace(/\$\$?([^$]+)\$\$?/g, (_, inner) => inner.trim())
    .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, (_, c) => c)
    .replace(/\s+/g, " ")
    .trim();
}
function sentence(text) {
  const chars = Array.from(text);
  let end = chars.length;
  for (let i = 0; i < chars.length; i++)
    if (
      /[。！？!?]/.test(chars[i]) ||
      (chars[i] === "." &&
        (i === chars.length - 1 || chars[i + 1] === " ") &&
        i > 2)
    ) {
      end = i + 1;
      break;
    }
  const limit = 60;
  if (end > limit) return chars.slice(0, limit).join("").trimEnd() + "…";
  return chars.slice(0, end).join("");
}
