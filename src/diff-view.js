import { t } from "../desktop/i18n.mjs";

// Unified diffs (.diff, .patch) are read, not written: each changed file
// becomes a section, titled by its path and line counts, holding its part of
// the diff as a `diff` code block. They go through the Markdown reader, so the
// outline, folding, find and copy work as in a note; positions are mapped back
// to the diff's own text, so source view and anchors still line up.
export const diffName = (name) => /\.(diff|patch)$/i.test(name || "");
export const isDiffDocument = (doc) => diffName(doc?.path || doc?.name);

const hunkHeader = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

// Line kinds of a unified diff, following hunk lengths: inside a hunk, a
// removed "-- x" reads "--- x" and is not a file header. Once a hunk's counts
// are spent (or when they were wrong, as in hand-made patches), lines are read
// by their first character again.
export function diffLines(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const kinds = [];
  let oldLeft = 0,
    newLeft = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inHunk = oldLeft > 0 || newLeft > 0;
    let kind;
    // No content line starts with "@", so a hunk header is one even when the
    // previous hunk's counts were too large.
    const hunk = hunkHeader.exec(line);
    if (hunk) {
      kind = "hunk";
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
    } else if (inHunk && /^[ +\-\\]/.test(line)) {
      kind = contentKind(line);
      if (line[0] !== "+" && line[0] !== "\\") oldLeft--;
      if (line[0] !== "-" && line[0] !== "\\") newLeft--;
    } else if (inHunk && line === "") {
      // Some tools drop the space of an empty context line.
      kind = "context";
      oldLeft--;
      newLeft--;
    } else {
      oldLeft = newLeft = 0;
      if (fileStart(lines, i)) kind = "file";
      else if (
        /^(--- |\+\+\+ |index |(new|deleted) file mode|old mode|new mode|similarity index|dissimilarity index|rename (from|to) |copy (from|to) |Binary files )/.test(
          line,
        )
      )
        kind = "meta";
      else if (line.startsWith("@@")) kind = "hunk";
      else kind = contentKind(line);
    }
    kinds.push(kind);
  }
  return { lines, kinds };
}
function contentKind(line) {
  if (line[0] === "+") return "add";
  if (line[0] === "-") return "del";
  if (line[0] === "\\") return "note";
  return "context";
}
// A file's part starts at "diff …", or at a "--- " line followed by "+++ "
// (diffs without git's header).
function fileStart(lines, i) {
  const line = lines[i];
  if (/^diff /.test(line)) return true;
  return (
    line.startsWith("--- ") &&
    lines[i + 1]?.startsWith("+++ ") &&
    !/^diff /.test(lines[i - 1] || "") &&
    !/^(index |(new|deleted) file mode|old mode|new mode|similarity index|rename |copy )/.test(
      lines[i - 1] || "",
    )
  );
}

const escapeHTML = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// Above this a block shows as plain text (each line is an element).
export const MAX_DIFF_CHARS = 4000000;
// The code of a `diff` block: one element per line, so a whole line takes the
// tint of an addition or a removal. The newline stays in its line for copy.
export function diffMarkup(code) {
  if (code.length > MAX_DIFF_CHARS) return "";
  const { lines, kinds } = diffLines(code);
  const trailing = code.endsWith("\n");
  return lines
    .map(
      (line, i) =>
        `<span class="diff-line diff-${kinds[i] === "file" ? "meta" : kinds[i]}">${escapeHTML(line)}${i < lines.length - 1 || trailing ? "\n" : ""}</span>`,
    )
    .join("");
}

// A path as inline code: shown as written, never read as a link or emphasis.
function codeSpan(value) {
  const longest = Math.max(
    0,
    ...(value.match(/`+/g) || []).map((run) => run.length),
  );
  const ticks = "`".repeat(longest + 1),
    pad = /^`|`$/.test(value) ? " " : "";
  return ticks + pad + value + pad + ticks;
}
function unquote(value) {
  if (!/^".*"$/.test(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(1, -1);
  }
}
// "a/src/x.js\t2024-…" → "src/x.js"; /dev/null stays.
function cleanPath(value) {
  const path = unquote(value.split("\t")[0].trim());
  return path === "/dev/null" ? path : path.replace(/^[ab]\//, "");
}
function describe(lines, kinds) {
  let from = null,
    to = null,
    renameFrom = null,
    renameTo = null,
    added = 0,
    removed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      kind = kinds[i];
    if (kind === "add") added++;
    else if (kind === "del") removed++;
    else if (kind === "meta" || kind === "file") {
      if (line.startsWith("--- ")) from ??= cleanPath(line.slice(4));
      else if (line.startsWith("+++ ")) to ??= cleanPath(line.slice(4));
      else if (line.startsWith("rename from "))
        renameFrom = unquote(line.slice(12));
      else if (line.startsWith("rename to "))
        renameTo = unquote(line.slice(10));
    }
  }
  if (from === null && to === null) {
    // Only git's header (a mode change, a binary file): diff --git a/x b/y.
    const git = lines[0]?.match(
      /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/,
    );
    if (git) [from, to] = [git[1], git[2]];
  }
  let status = "";
  let name;
  if (renameFrom && renameTo)
    name = `${codeSpan(renameFrom)} → ${codeSpan(renameTo)}`;
  else if (from === "/dev/null") {
    name = codeSpan(to);
    status = t("新文件");
  } else if (to === "/dev/null") {
    name = codeSpan(from);
    status = t("已删除");
  } else name = codeSpan(to || from || lines[0] || "");
  return { name, status, added, removed };
}

// The Markdown shown for a diff, and a map from its offsets to the diff's.
export function diffDocument(text) {
  const { lines, kinds } = diffLines(text);
  const starts = [];
  let offset = 0;
  const lineStart = lines.map((line) => {
    const at = offset;
    offset += line.length + 1;
    return at;
  });
  kinds.forEach((kind, i) => {
    if (kind === "file") starts.push(i);
  });
  const longest = Math.max(
    2,
    ...(text.match(/`+/g) || []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  let markdown = "";
  const segments = [];
  // Synthetic text (titles, fences) maps to where the next verbatim part
  // starts; verbatim text maps one to one.
  const add = (generated, original) => {
    segments.push({ at: markdown.length, from: original, length: 0 });
    markdown += generated;
  };
  const copy = (from, to) => {
    segments.push({ at: markdown.length, from, length: to - from });
    markdown += text.slice(from, to);
  };
  const block = (from, to, language) => {
    if (to <= from) return;
    add(fence + language + "\n", from);
    copy(from, to);
    add((text[to - 1] === "\n" ? "" : "\n") + fence + "\n\n", to);
  };
  const end = (index) =>
    index < lines.length ? lineStart[index] : text.length;
  // Before the first file: a commit message and its headers (format-patch),
  // or the whole text when no file header was found (bare hunks).
  const first = starts.length ? starts[0] : lines.length;
  if (/\S/.test(text.slice(0, end(first))))
    block(
      0,
      end(first),
      !starts.length && kinds.includes("hunk") ? "diff" : "",
    );
  starts.forEach((start, n) => {
    const stop = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const info = describe(lines.slice(start, stop), kinds.slice(start, stop));
    const counts = [
      info.added ? `+${info.added}` : "",
      info.removed ? `−${info.removed}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const title = [info.name, info.status, counts].filter(Boolean).join(" · ");
    add(`## ${title}\n\n`, end(start));
    block(end(start), end(stop), "diff");
  });
  const map = (position) => {
    let low = 0,
      high = segments.length - 1,
      found = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (segments[middle].at <= position) {
        found = segments[middle];
        low = middle + 1;
      } else high = middle - 1;
    }
    if (!found) return 0;
    return Math.min(
      found.from + Math.max(0, position - found.at),
      found.from + found.length,
    );
  };
  return { markdown, map, files: starts.length };
}
