// Links in a note's Markdown that follow notes, folders and files moved or
// renamed: inline links and images, reference definitions and the href/src
// of HTML tags, each written again relative to where the note is (or will
// be). What a link carries besides its path stays as written: the #anchor,
// a title, angle brackets, a leading "./", a trailing "/", and how the path
// was encoded (%20, encoded or plain CJK). Links in code blocks, code spans
// and HTML comments are left alone, as are web addresses, absolute paths and
// links to anchors in the same note.
// Pure, with no Node imports: the main process rewrites notes on disk with
// it, and the page applies the same edits to a draft open with unsaved
// changes. Paths compare without regard to letter case (Windows, macOS).

// ── Paths as plain strings: "C:/a/b", "/a/b" or "//server/share/a" ──
function split(p) {
  const s = String(p).replace(/\\/g, "/");
  let root = "",
    rest = s;
  const drive = /^([a-z]:)(\/|$)/i.exec(s);
  const unc = /^\/\/([^/]+)\/([^/]+)/.exec(s);
  if (drive) {
    root = drive[1];
    rest = s.slice(drive[1].length);
  } else if (unc) {
    root = unc[0];
    rest = s.slice(unc[0].length);
  }
  const parts = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return { root, parts };
}
const join = ({ root, parts }) => root + "/" + parts.join("/");
const lower = (s) => s.toLowerCase();
// The same path, as a key: separators, dots and letter case aside.
export const pathKey = (p) => lower(join(split(p)));
const dirOf = (p) => {
  const { root, parts } = split(p);
  return { root, parts: parts.slice(0, -1) };
};
// Whether p is folder or inside it.
export function isUnder(p, folder) {
  const a = pathKey(p),
    b = pathKey(folder);
  return a === b || a.startsWith(b.endsWith("/") ? b : b + "/");
}
// A path to `target` relative to a folder, with "/" between parts; null on
// another drive or share.
function relative(dir, target) {
  if (lower(dir.root) !== lower(target.root)) return null;
  let common = 0;
  while (
    common < dir.parts.length &&
    common < target.parts.length &&
    lower(dir.parts[common]) === lower(target.parts[common])
  )
    common++;
  return [
    ...dir.parts.slice(common).map(() => ".."),
    ...target.parts.slice(common),
  ].join("/");
}
// The path after the moves: [[old, new]] of files or folders, the most
// specific first; null when none applies.
function mapper(moves) {
  const list = moves
    .map(([from, to]) => ({ from: split(from), to: split(to) }))
    .sort((a, b) => b.from.parts.length - a.from.parts.length);
  return (target) => {
    for (const { from, to } of list) {
      if (lower(from.root) !== lower(target.root)) continue;
      if (from.parts.length > target.parts.length) continue;
      if (from.parts.some((part, i) => lower(part) !== lower(target.parts[i])))
        continue;
      return {
        root: to.root,
        parts: [...to.parts, ...target.parts.slice(from.parts.length)],
      };
    }
    return null;
  };
}

// ── Destinations ──
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const hex = (ch) =>
  [...new TextEncoder().encode(ch)]
    .map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0"))
    .join("");
// One path segment written for a link of this style.
function encodeSegment(segment, style) {
  let out = "";
  for (const ch of segment) {
    const code = ch.codePointAt(0);
    if (ch === "%" || ch === "#" || ch === "?" || code < 32 || code === 127)
      out += hex(ch);
    else if (ch === " ") out += style.angle && !style.space ? " " : "%20";
    else if (ch === "<" || ch === ">") out += hex(ch);
    else if ((ch === "(" || ch === ")") && style.bare) out += hex(ch);
    else if (code > 127 && style.nonAscii) out += hex(ch);
    else out += ch;
  }
  return out;
}
// A destination as written: angle brackets, the path (still encoded) and
// what follows it (#anchor or ?query).
function parseDestination(raw) {
  const angle = raw.startsWith("<") && raw.endsWith(">");
  const inner = angle ? raw.slice(1, -1) : raw;
  const cut = inner.search(/[#?]/);
  return {
    angle,
    target: cut < 0 ? inner : inner.slice(0, cut),
    suffix: cut < 0 ? "" : inner.slice(cut),
  };
}
// The destination written again for the note's new folder, or null when it
// stays as it is (or is not a relative path).
function rewriteDestination(raw, kind, oldDir, newDir, map) {
  const { angle, target, suffix } = parseDestination(raw);
  if (!target || SCHEME.test(target) || /^[\\/]/.test(target)) return null;
  let decoded;
  try {
    // As Markdown reads it: a backslash before punctuation only escapes it.
    decoded = decodeURIComponent(
      kind === "html"
        ? target
        : target.replace(/\\([!-/:-@[-`{-~])/g, (m, c) => c),
    );
  } catch {
    return null; // Not a path anyone could open: left as written.
  }
  const resolved = split(join(oldDir) + "/" + decoded);
  const mapped = map(resolved);
  const moved = pathKey(join(oldDir)) !== pathKey(join(newDir));
  if (!mapped && !moved) return null;
  let rel = relative(newDir, mapped || resolved);
  if (rel === null) return null;
  const folder = /[\\/]$/.test(target);
  if (!rel) rel = ".";
  else if (/^\.\/|^\.\\/.test(target) && !rel.startsWith("../"))
    rel = "./" + rel;
  const style = {
    angle,
    bare: !angle && kind !== "html",
    space: /%20/.test(target),
    nonAscii: /%[89a-f][0-9a-f]/i.test(target),
  };
  let out = rel
    .split("/")
    .map((part) =>
      part === "." || part === ".." ? part : encodeSegment(part, style),
    )
    .join("/");
  if (folder) out += "/";
  out = angle ? "<" + out + suffix + ">" : out + suffix;
  return out === raw ? null : out;
}

// ── Finding destinations in Markdown ──
// The text with what holds no links blanked (same length, line breaks
// kept): fenced code blocks (also inside block quotes and list items),
// indented code blocks, HTML comments and code spans (over the lines of
// one paragraph, a run of backticks closed by a run as long).
const QUOTE = /^(?:[ \t]{0,3}>[ \t]?)*/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const indentOf = (line) => {
  let width = 0;
  for (const c of line) {
    if (c === " ") width++;
    else if (c === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
};
function maskCode(text) {
  const chars = text.split("");
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  let fence = null,
    at = 0,
    inList = false,
    indented = false,
    prevBlank = true;
  for (const line of text.split("\n")) {
    const end = at + line.length;
    const rest = line.slice(QUOTE.exec(line)[0].length);
    const open = /^[ \t]*(`{3,}|~{3,})/.exec(rest);
    const isBlank = !rest.trim();
    if (fence) {
      blank(at, end);
      if (
        open &&
        open[1][0] === fence[0] &&
        open[1].length >= fence.length &&
        !rest.slice(open[0].length).trim()
      )
        fence = null;
    } else if (
      open &&
      !(open[1][0] === "`" && rest.slice(open[0].length).includes("`"))
    ) {
      fence = open[1];
      indented = false;
      blank(at, end);
    } else if (isBlank) {
      // Blank lines neither start nor end an indented block.
    } else if (indentOf(rest) >= 4 && !inList && (prevBlank || indented)) {
      indented = true;
      blank(at, end);
    } else {
      indented = false;
      if (LIST_ITEM.test(rest)) inList = true;
      else if (prevBlank && indentOf(rest) === 0) inList = false;
    }
    prevBlank = isBlank;
    at = end + 1;
  }
  let masked = chars.join("");
  masked = masked.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  // Code spans, paragraph by paragraph.
  return masked
    .split(/(\n[ \t>]*\n)/)
    .map((part) =>
      part.replace(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (m) =>
        m.replace(/[^\n]/g, " "),
      ),
    )
    .join("");
}
const escaped = (text, i) => {
  let n = 0;
  while (i - 1 - n >= 0 && text[i - 1 - n] === "\\") n++;
  return n % 2 === 1;
};
// After "](" at k: the destination's range, if a title (optional) and ")"
// follow it.
function inlineDestination(text, k) {
  let i = k;
  while (text[i] === " " || text[i] === "\t") i++;
  if (text[i] === "\n") {
    i++;
    while (text[i] === " " || text[i] === "\t") i++;
  }
  const from = i;
  if (text[i] === "<") {
    i++;
    while (i < text.length && text[i] !== ">" && text[i] !== "\n") {
      if (text[i] === "<" && !escaped(text, i)) return null;
      i++;
    }
    if (text[i] !== ">") return null;
    i++;
  } else {
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (/\s/.test(c) || c.charCodeAt(0) < 32) break;
      if (c === "(") depth++;
      else if (c === ")") {
        if (!depth) break;
        depth--;
      }
      i++;
    }
    if (depth) return null;
  }
  const to = i;
  // An optional title, then the closing parenthesis.
  let j = i;
  while (/[ \t]/.test(text[j] || "")) j++;
  if (text[j] === "\n") {
    j++;
    while (/[ \t]/.test(text[j] || "")) j++;
  }
  const close = { '"': '"', "'": "'", "(": ")" }[text[j]];
  if (close && j > to) {
    j++;
    while (j < text.length && text[j] !== close) {
      if (text[j] === "\\") j++;
      else if (text[j] === "\n" && /^\n[ \t]*\n/.test(text.slice(j, j + 50)))
        return null;
      j++;
    }
    if (text[j] !== close) return null;
    j++;
    while (/[ \t]/.test(text[j] || "")) j++;
  }
  if (text[j] !== ")") return null;
  return from === to ? null : { from, to, end: j + 1 };
}
// Every link destination in the note: { from, to, kind } in the text.
export function findDestinations(text) {
  const masked = maskCode(text);
  const found = [];
  const seen = new Set();
  // Inline links and images: [text](dest "title"), ![alt](dest).
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== "[" || escaped(masked, i)) continue;
    let depth = 0,
      j = i;
    for (; j < masked.length; j++) {
      const c = masked[j];
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "\n" && /^\n[ \t]*\n/.test(masked.slice(j, j + 50))) break;
      if (c === "[") depth++;
      else if (c === "]" && !--depth) break;
    }
    if (masked[j] !== "]" || masked[j + 1] !== "(") continue;
    const dest = inlineDestination(masked, j + 2);
    if (!dest || seen.has(dest.from)) continue;
    seen.add(dest.from);
    // The whole link too, for taking it away: [label](…) or ![alt](…).
    const image = i > 0 && masked[i - 1] === "!" && !escaped(masked, i - 1);
    found.push({
      ...dest,
      kind: "inline",
      link: {
        from: image ? i - 1 : i,
        to: dest.end,
        label: text.slice(i + 1, j),
        image,
      },
    });
  }
  // Reference definitions: [label]: dest "title" (the destination may be
  // on the next line).
  const DEF =
    /^( {0,3}(?:>[ \t]?)*[ \t]*\[(?:\\.|[^\]\\\n])+\]:[ \t]*(?:\n[ \t>]*)?)(<[^>\n]*>|[^\s<]+)/gm;
  for (const m of masked.matchAll(DEF)) {
    const from = m.index + m[1].length;
    if (/^\s*\[\^/.test(m[1])) continue; // a footnote
    if (!seen.has(from)) {
      seen.add(from);
      found.push({ from, to: from + m[2].length, kind: "reference" });
    }
  }
  // HTML: <a href="…">, <img src="…"> and the like.
  // A ">" inside a quoted attribute does not end the tag.
  const TAG =
    /<(?:a|img|source|video|audio|iframe|embed)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const ATTR = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const tag of masked.matchAll(TAG))
    for (const m of tag[0].matchAll(ATTR)) {
      const value = m[1] ?? m[2];
      const from = tag.index + m.index + m[0].length - value.length - 1;
      if (!value || seen.has(from)) continue;
      seen.add(from);
      found.push({ from, to: from + value.length, kind: "html" });
    }
  return found.sort((a, b) => a.from - b.from);
}

// The note's links written again after moves:
// - file: where the note is after them; from: where it was (its links were
//   written for there), the same when the note itself stays;
// - moves: [[oldPath, newPath]] of the notes, folders and files moved.
// Returns { text, edits: [{ from, to, insert }], count }, edits in the
// original text, in order.
export function rewriteLinks(text, { file, from = file, moves = [] }) {
  const oldDir = dirOf(from),
    newDir = dirOf(file),
    map = mapper(moves);
  const edits = [];
  for (const dest of findDestinations(text)) {
    const raw = text.slice(dest.from, dest.to);
    const insert = rewriteDestination(raw, dest.kind, oldDir, newDir, map);
    if (insert !== null) edits.push({ from: dest.from, to: dest.to, insert });
  }
  let out = "",
    at = 0;
  for (const edit of edits) {
    out += text.slice(at, edit.from) + edit.insert;
    at = edit.to;
  }
  out += text.slice(at);
  return { text: out, edits, count: edits.length };
}

// Where a path is after the moves ([[old, new]]), written with the new
// path's separators; the same path when no move applies.
export function movedPathOf(p, moves) {
  const target = split(p);
  const sorted = [...moves].sort(
    (a, b) => split(b[0]).parts.length - split(a[0]).parts.length,
  );
  for (const [from, to] of sorted) {
    const source = split(from);
    if (
      lower(source.root) !== lower(target.root) ||
      source.parts.length > target.parts.length ||
      source.parts.some((part, i) => lower(part) !== lower(target.parts[i]))
    )
      continue;
    const rest = target.parts.slice(source.parts.length);
    if (!rest.length) return to;
    const sep = /\\/.test(to) || (!/\//.test(to) && /\\/.test(p)) ? "\\" : "/";
    return to.replace(/[\\/]+$/, "") + sep + rest.join(sep);
  }
  return p;
}

// The paths the note's relative links lead to (decoded, resolved against its
// folder), with the kind of each link: for finding the links into a folder.
export function linkedPaths(text, file) {
  const dir = dirOf(file);
  const out = [];
  for (const dest of findDestinations(text)) {
    const resolved = resolveDestination(
      text.slice(dest.from, dest.to),
      dest.kind,
      dir,
    );
    if (resolved) out.push(resolved);
  }
  return out;
}
// Where a destination as written leads from a folder ("/"-joined), or
// null for a web address, an absolute path or an anchor in the note.
function resolveDestination(raw, kind, dir) {
  const { target } = parseDestination(raw);
  if (!target || SCHEME.test(target) || /^[\\/]/.test(target)) return null;
  try {
    const plain =
      kind === "html"
        ? target
        : target.replace(/\\([!-/:-@[-`{-~])/g, (m, c) => c);
    return join(split(join(dir) + "/" + decodeURIComponent(plain)));
  } catch {
    return null;
  }
}
// Where a link written in a note leads: an absolute path ("/"-joined), or
// null when it is no relative path (a web address, an anchor).
export function linkTarget(href, file) {
  return resolveDestination(String(href).trim(), "inline", dirOf(file));
}

// The note's inline links and images to `target` taken away: a link keeps
// its text, an image goes. Reference definitions and HTML stay (removing
// them would leave their uses showing as plain brackets). Returns { text,
// edits, count } like rewriteLinks.
export function unlinkTarget(text, { file, target }) {
  const dir = dirOf(file),
    want = pathKey(target);
  const edits = [];
  for (const dest of findDestinations(text)) {
    if (dest.kind !== "inline") continue;
    const resolved = resolveDestination(
      text.slice(dest.from, dest.to),
      dest.kind,
      dir,
    );
    if (!resolved || pathKey(resolved) !== want) continue;
    const { from, to, label, image } = dest.link;
    // A link inside another one already taken away goes with it.
    if (edits.some((e) => from < e.to && to > e.from)) continue;
    edits.push({ from, to, insert: image ? "" : label });
  }
  edits.sort((a, b) => a.from - b.from);
  let out = "",
    at = 0;
  for (const edit of edits) {
    out += text.slice(at, edit.from) + edit.insert;
    at = edit.to;
  }
  out += text.slice(at);
  return { text: out, edits, count: edits.length };
}
