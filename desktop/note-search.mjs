// Full-text search over the library's notes (the Markdown source held by the
// link index). Words separated by spaces must all occur in a note, in its
// name or anywhere in its text; "quoted words" are matched as one phrase.
// Matching ignores case and needs no word boundaries, so Chinese works
// without segmentation. Results come back as plain data: the renderer builds
// the snippets from text segments, never from HTML.

import { MATH, safeWindow } from "./snippet.mjs";

const MAX_TERMS = 8,
  MAX_TERM = 100,
  BEFORE = 24,
  WIDTH = 96;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function parseQuery(query) {
  const terms = [];
  for (const m of String(query).matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim().toLowerCase().slice(0, MAX_TERM);
    if (term && !terms.includes(term)) terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

// What a line reads as once rendered, near enough for a snippet: markers,
// link targets and tags go; formulas stay as written.
// targets: show where links lead, "text (target)", for a word found only there.
export function readable(line, { targets = false } = {}) {
  // A table row reads as its cells.
  if (/^\s*\|.*\|\s*$/.test(line))
    line = line
      .trim()
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(" · ");
  const target = (href) => {
    href = href.replace(/^<|>$/g, "");
    try {
      return decodeURI(href);
    } catch {
      return href;
    }
  };
  const text = line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(
      /\[([^\]\n]*)\]\((<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)/g,
      (m, label, href) => (targets ? `${label} (${target(href)})` : label),
    )
    .replace(/<\/?[a-z][^>\n]*>/gi, "");
  // Emphasis markers go outside formulas only ($a_i^*$ keeps its * and _).
  return text
    .split(new RegExp(`(${MATH.source})`))
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/(\*\*|__|~~|==)(?=\S)|(?<=\S)(\*\*|__|~~|==)/g, "")
            .replace(/(?<![\\\w])[*_](?=\S)|(?<=\S)[*_](?!\w)/g, "")
            .replace(/`+/g, ""),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// Every [start, end) where a term occurs in lower-cased text, in order and
// without overlaps (a longer term wins where two start together).
function occurrences(lower, terms) {
  const found = [];
  for (const term of terms)
    for (
      let at = lower.indexOf(term);
      at !== -1;
      at = lower.indexOf(term, at + term.length)
    )
      found.push([at, at + term.length]);
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const range of found)
    if (!merged.length || range[0] >= merged.at(-1)[1]) merged.push(range);
  return merged;
}

// Text segments [text, isHit] for a window of the line around its first hit.
// The window never cuts a formula in half, so the renderer can typeset it.
function snippet(text, ranges) {
  let start = 0,
    end = text.length;
  if (text.length > WIDTH) {
    start = Math.max(0, ranges[0][0] - BEFORE);
    end = Math.min(text.length, start + WIDTH);
    start = Math.max(0, Math.min(start, end - WIDTH));
    [start, end] = safeWindow(text, start, end, { keep: ranges[0] });
  }
  const parts = [];
  let at = start;
  for (const [from, to] of ranges) {
    if (to <= start || from >= end) continue;
    const a = Math.max(from, start),
      b = Math.min(to, end);
    if (a > at) parts.push([text.slice(at, a), false]);
    parts.push([text.slice(a, b), true]);
    at = b;
  }
  if (at < end) parts.push([text.slice(at, end), false]);
  if (start > 0) parts.unshift(["…", false]);
  if (end < text.length) parts.push(["…", false]);
  return parts;
}

// The name without ".md", or "md" would match every note.
const bareName = (name) => name.replace(/\.(md|markdown)$/i, "").toLowerCase();

// Ranking, cheap enough for every note: null when a term is missing.
// Names first, then hits in headings, then how many hits (counted to 200).
// note.lower, when given, is note.text lower-cased once by the caller.
export function rank(note, terms) {
  const name = bareName(note.name),
    lower = note.lower ?? note.text.toLowerCase();
  if (
    !terms.length ||
    !terms.every((t) => name.includes(t) || lower.includes(t))
  )
    return null;
  let count = 0;
  const headings = new Set();
  for (const term of terms)
    for (
      let at = lower.indexOf(term);
      at !== -1 && count < 200;
      at = lower.indexOf(term, at + term.length)
    ) {
      count++;
      const start = lower.lastIndexOf("\n", at) + 1;
      if (lower[start] === "#") headings.add(start);
    }
  const nameHit = terms.every((t) => name.includes(t));
  return (nameHit ? 1000 : 0) + headings.size * 20 + Math.min(count, 100);
}

// One note's lines: null when a term is missing, otherwise its best lines.
export function searchNote(note, terms, { maxHits = 3 } = {}) {
  const name = bareName(note.name),
    text = note.text,
    lowerText = note.lower ?? text.toLowerCase();
  if (
    !terms.length ||
    !terms.every((t) => name.includes(t) || lowerText.includes(t))
  )
    return null;
  const lines = text.split(/\r?\n/);
  const hits = [];
  let fence = null,
    section = "",
    count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = line.match(FENCE);
    let heading = null;
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length)
        fence = null;
    } else if (open) fence = open[1];
    else {
      const atx = line.match(ATX);
      if (atx) heading = readable(atx[2] || "");
    }
    const lower = line.toLowerCase();
    if (!terms.some((t) => lower.includes(t))) {
      if (heading !== null) section = heading;
      continue;
    }
    const raw = occurrences(lower, terms);
    count += raw.length;
    // Show the line as it reads; a term only in a link target or tag shows raw.
    const shown = readable(line);
    let ranges = occurrences(shown.toLowerCase(), terms),
      display = shown;
    if (!ranges.length) {
      display = readable(line, { targets: true });
      ranges = occurrences(display.toLowerCase(), terms);
    }
    if (!ranges.length) {
      display = line.trim();
      ranges = occurrences(display.toLowerCase(), terms);
    }
    hits.push({
      line: i + 1,
      column: raw[0][0] + 1,
      section: heading !== null ? "" : section,
      heading: heading !== null,
      distinct: terms.filter((t) => lower.includes(t)).length,
      snippet: snippet(display, ranges),
    });
    if (heading !== null) section = heading;
  }
  const nameHit = terms.every((t) => name.includes(t));
  // Lines holding the most terms first, then in reading order.
  const best = [...hits]
    .sort((a, b) => b.distinct - a.distinct || a.line - b.line)
    .slice(0, maxHits)
    .sort((a, b) => a.line - b.line)
    .map(({ distinct, ...hit }) => hit);
  return {
    path: note.path,
    name: note.name,
    nameHit,
    count,
    hits: best,
  };
}

// Every note is ranked; only the notes shown get their lines and snippets.
export function searchNotes(notes, query, { maxNotes = 50, maxHits = 3 } = {}) {
  const terms = parseQuery(query);
  const ranked = [];
  if (terms.length)
    for (const note of notes) {
      const score = rank(note, terms);
      if (score !== null) ranked.push({ note, score });
    }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.note.name.localeCompare(b.note.name) ||
      a.note.path.localeCompare(b.note.path),
  );
  return {
    terms,
    total: ranked.length,
    results: ranked
      .slice(0, maxNotes)
      .map(({ note }) => searchNote(note, terms, { maxHits })),
  };
}
