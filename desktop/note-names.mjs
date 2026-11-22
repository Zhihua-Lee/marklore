// One name per note: its leading level-1 heading (the first block after the
// front matter), or, for a note without one, its file name. The file name is
// that heading made into a name Windows accepts; the folder's index lists the
// note under the same text, and a front-matter `title`, when there is one,
// says the same. Pure, with no Node imports: the main process renames and
// lists with it, and the page shows names and edits drafts with it.
import { headingSlug } from "./slug.mjs";

// Names of notes (files.mjs markdownPath, plus plain text notes).
export const NOTE_EXTENSION = /\.(md|markdown|mdown|mkd|txt)$/i;
// A note's file name without its extension.
export const baseName = (name) => String(name).replace(NOTE_EXTENSION, "");

// The lines of the front matter (a first line `---`, at least one line, then
// `---` or `...`, as the renderer reads it), as the number of lines it
// takes; 0 without one.
function frontLines(lines) {
  if (lines.length < 3 || !/^---[ \t]*$/.test(lines[0])) return 0;
  for (let i = 2; i < lines.length; i++)
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) return i + 1;
  return 0;
}
const ATX1 = /^( {0,3}#)(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
// What a line starting a setext heading may not start with: it would be a
// list item, a quote, a table, a heading, a fence or indented code.
const NOT_SETEXT = /^(?: {4,}|\t| {0,3}(?:[-*+>|#]|\d+[.)]|`{3}|~{3}))/;

// The note's leading level-1 heading: { raw (its Markdown), title (plain
// text), line (from 0, in the text without a byte order mark), setext }, or
// null when the first block after the front matter is something else.
export function leadingHeading(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  let i = frontLines(lines);
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return null;
  const line = lines[i];
  const atx = ATX1.exec(line);
  if (atx && !/^ {0,3}##/.test(line)) {
    const raw = (atx[2] || "").trim();
    const title = plainTitle(raw);
    return title ? { raw, title, line: i, setext: false } : null;
  }
  // A paragraph line underlined with "=" (one line only).
  if (
    i + 1 < lines.length &&
    /^ {0,3}=+[ \t]*$/.test(lines[i + 1]) &&
    !NOT_SETEXT.test(line)
  ) {
    const raw = line.trim();
    const title = plainTitle(raw);
    return title ? { raw, title, line: i, setext: true } : null;
  }
  return null;
}

// A heading's Markdown as plain text: formulas without their dollars, links
// and code as their text, images, tags and emphasis markers left out. Code
// and formulas are read first and kept as they are.
export function plainTitle(raw) {
  const kept = [];
  const keep = (text) => {
    kept.push(text);
    return `\u0000${kept.length - 1}\u0000`;
  };
  return (
    String(raw)
      .replace(/\u0000/g, "")
      .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1/g, (m, fence, code) =>
        keep(code.trim()),
      )
      .replace(/\\\(([\s\S]*?)\\\)/g, (m, math) => keep(math.trim()))
      .replace(/\$\$([\s\S]*?)\$\$/g, (m, math) => keep(math.trim()))
      .replace(/(?<![\\$])\$(?!\s)([^$\n]*?[^\s\\])\$(?!\d)/g, (m, math) =>
        keep(math),
      )
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, (m, label) => label)
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, (m, label) => label)
      .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/gi, "")
      .replace(/\*\*|__|~~|==/g, "")
      .replace(/(^|[^\p{L}\p{N}\\])[*_](?=\S)/gu, (m, before) => before)
      .replace(/(?<=\S)(?<!\\)[*_](?=$|[^\p{L}\p{N}])/gu, "")
      .replace(/\\([!-/:-@[-`{-~])/g, (m, c) => c)
      // eslint-disable-next-line no-control-regex
      .replace(/\u0000(\d+)\u0000/g, (m, n) => kept[Number(n)])
      .replace(/\s+/g, " ")
      .trim()
  );
}
// A name written as a heading's Markdown that reads back as itself: a
// closing run of "#" escaped (it would end the heading).
export const headingText = (name) =>
  String(name)
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /(^|\s)(#+)$/,
      (m, space, hashes) => space + hashes.replace(/#/g, "\\#"),
    );

// Characters Windows does not take in a name, and what stands for them.
const WIDE = {
  "\\": "＼",
  "/": "／",
  ":": "：",
  "*": "＊",
  "?": "？",
  '"': "＂",
  "<": "＜",
  ">": "＞",
  "|": "｜",
};
// A note's name (plain text) as the base of a file name Windows accepts:
// forbidden characters as their full-width forms, control characters out,
// no leading dot, no trailing dot or space, a reserved device name (CON,
// NUL, COM1...) with "_" after it, at most `max` UTF-16 units (as Windows
// counts a name), never cut through a character. "" when nothing is left.
export function safeBase(name, max = 120) {
  let out = String(name)
    .replace(/[\\/:*?"<>|]/g, (c) => WIDE[c])
    .replace(/\s+/g, " ")
    // Control characters (C0 and DEL) cannot be in a Windows name.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\.+/, (dots) => "．".repeat(dots.length));
  if (out.length > max) {
    let cut = "";
    for (const ch of out) {
      if (cut.length + ch.length > max) break;
      cut += ch;
    }
    out = cut;
  }
  out = out.replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out.split(".")[0]))
    out = out.replace(/^[^.]+/, (stem) => stem + "_");
  return out;
}
// The file name for a note named `name`: safeBase plus the extension.
export const safeFileName = (name, ext = ".md", max = 120) => {
  const base = safeBase(name, max);
  return base ? base + ext : "";
};
// The same name with a number, for a name already taken: "Name (2).md".
export const numberedName = (name, n) => {
  const ext = (NOTE_EXTENSION.exec(name) || [""])[0];
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`;
};
// The shortest cut a long name is given (files.mjs: the folder's path
// leaves at least this much).
export const MIN_NAME = 20;

// Whether a file name is the name a note of this title gets (letter case
// aside): then the tree and the index view show the title alone. A long
// title's file is its name cut short (to fit its folder's path).
export function fileMatches(title, fileName) {
  const base = baseName(fileName).toLowerCase();
  const full = safeBase(title, 1000).toLowerCase();
  if (base === String(title).toLowerCase() || base === full) return true;
  return (
    base.length >= MIN_NAME &&
    full.length > base.length &&
    safeBase(title, base.length).toLowerCase() === base
  );
}

// The anchor of the note's leading heading as the renderer gives it (its
// first heading: no repeat before it).
export const headingAnchor = (raw) =>
  headingSlug(/<[a-z/][^>]*>/i.test(raw) ? raw.replace(/<[^>]+>/g, "") : raw);

// A front-matter value written as YAML: plain when it reads back the same,
// otherwise double-quoted.
function yamlValue(value) {
  if (
    /^[^\s\-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/: |\s#|[\s]$/.test(value) &&
    !/^(true|false|yes|no|on|off|null|~|[-+]?[\d.]+(e[-+]?\d+)?)$/i.test(value)
  )
    return value;
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
// A plain or quoted YAML scalar on one line, its comment left out.
const unquote = (value) => {
  const v = value.trim();
  const double = /^"((?:[^"\\]|\\.)*)"(?:\s+#.*)?$/.exec(v);
  if (double) return double[1].replace(/\\(["\\])/g, (m, c) => c);
  const single = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(v);
  if (single) return single[1].replace(/''/g, "'");
  return v.replace(/\s+#.*$/, "").trim();
};
// The front matter's `title` ({ line, end: its last line, value }), or null
// when the note has none (Marklore never adds one). The key may be quoted;
// a block scalar (| or >) or a value on the lines below is read whole.
export function frontTitle(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const close = frontLines(lines);
  for (let i = 1; i < close - 1; i++) {
    const m = /^(?:title|"title"|'title'):(?:[ \t]+(.*?))?[ \t]*$/.exec(
      lines[i],
    );
    if (!m) continue;
    const value = m[1] || "";
    // The lines that go with it: indented, up to the next key.
    let end = i;
    while (end + 1 < close - 1 && /^([ \t]+\S|[ \t]*$)/.test(lines[end + 1]))
      end++;
    while (end > i && !lines[end].trim()) end--;
    if (end > i || /^[|>][-+]?$/.test(value) || !value) {
      const parts = lines.slice(i + 1, end + 1).map((l) => l.trim());
      const folded = !/^\|/.test(value);
      const joined = parts.filter(Boolean).join(folded ? " " : "\n");
      return {
        line: i,
        end,
        value: /^[|>]/.test(value)
          ? joined
          : unquote([value, ...parts].filter(Boolean).join(" ")),
      };
    }
    return { line: i, end: i, value: unquote(value) };
  }
  return null;
}

// The note with its name set:
// - heading: the leading heading's new Markdown (when it has one; with
//   insert, a note without one gets "# heading" after its front matter);
// - title: the front matter's `title` (when it has one) set to this text.
// Line endings and a byte order mark stay. null when nothing changes.
export function setNoteName(
  text,
  { heading = null, title = null, insert = false } = {},
) {
  const source = String(text);
  const bom = source.startsWith("﻿") ? "﻿" : "";
  const body = bom ? source.slice(1) : source;
  const eol = /\r\n/.test(body) ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  if (heading != null) {
    const written = headingText(heading);
    const found = leadingHeading(body);
    if (found) {
      if (found.raw !== written) {
        if (found.setext && !NOT_SETEXT.test(written))
          lines[found.line] = /^ */.exec(lines[found.line])[0] + written;
        // A setext heading whose new name would read as something else
        // (a list item, a quote): an ATX heading in its place.
        else if (found.setext) lines.splice(found.line, 2, "# " + written);
        else {
          const lead = ATX1.exec(lines[found.line])[1];
          lines[found.line] = lead + " " + written;
        }
      }
    } else if (insert && written) {
      const at = frontLines(lines);
      const add = ["# " + written];
      // A blank line between it and what follows (none at the very end).
      if (at < lines.length && lines.slice(at).some((l) => l.trim()))
        add.push("");
      while (at < lines.length && lines[at] === "" && lines.length > at + 1)
        lines.splice(at, 1);
      lines.splice(at, 0, ...add);
    }
  }
  if (title != null) {
    const front = frontTitle(lines.join("\n"));
    if (front && front.value !== title)
      lines.splice(
        front.line,
        front.end - front.line + 1,
        "title: " + yamlValue(title),
      );
  }
  const out = bom + lines.join(eol);
  return out === source ? null : out;
}
