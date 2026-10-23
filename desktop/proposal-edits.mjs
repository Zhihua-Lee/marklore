// AI proposals (MCP): an edit replaces an exact piece of a note's text, as in
// an editor's find and replace. Each old text must occur in the note exactly
// once, so a proposal names its places without line numbers that go stale.
// Pure JavaScript, shared by the MCP server (it checks a proposal when it is
// made) and the renderer (it applies the proposal to the open note and marks
// what changed).

export const MAX_EDITS = 50;

const unix = (text) => String(text).replace(/\r\n?/g, "\n");

// The edits' places in `text`, in order: [{ from, to, insert }]. A problem
// comes back as { error: { edit, reason, count } } (edit counts from 0):
// "empty" (no old text), "missing", "ambiguous" (found `count` times),
// "overlap" (with the edit before it in the note) or "unchanged".
export function locateEdits(text, edits) {
  const changes = [];
  for (let i = 0; i < edits.length; i++) {
    const old = unix(edits[i].old_text ?? ""),
      insert = unix(edits[i].new_text ?? "");
    if (!old) return { error: { edit: i, reason: "empty" } };
    if (old === insert) return { error: { edit: i, reason: "unchanged" } };
    const from = text.indexOf(old);
    if (from < 0) return { error: { edit: i, reason: "missing" } };
    let count = 1;
    for (let at = text.indexOf(old, from + 1); at >= 0;) {
      count++;
      at = text.indexOf(old, at + 1);
    }
    if (count > 1) return { error: { edit: i, reason: "ambiguous", count } };
    changes.push({ from, to: from + old.length, insert, edit: i });
  }
  changes.sort((a, b) => a.from - b.from);
  for (let i = 1; i < changes.length; i++)
    if (changes[i].from < changes[i - 1].to)
      return { error: { edit: changes[i].edit, reason: "overlap" } };
  return {
    changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
  };
}

export function applyChanges(text, changes) {
  let out = "",
    at = 0;
  for (const change of changes) {
    out += text.slice(at, change.from) + change.insert;
    at = change.to;
  }
  return out + text.slice(at);
}

// Where the new text differs, as ranges in it: each change without the text
// it keeps at its start and end. A pure deletion is an empty range where the
// text went.
export function changedRanges(text, changes) {
  const ranges = [];
  let shift = 0;
  for (const { from, to, insert } of changes) {
    const old = text.slice(from, to);
    let head = 0;
    while (
      head < old.length &&
      head < insert.length &&
      old[head] === insert[head]
    )
      head++;
    let tail = 0;
    while (
      tail < old.length - head &&
      tail < insert.length - head &&
      old[old.length - 1 - tail] === insert[insert.length - 1 - tail]
    )
      tail++;
    const start = from + shift + head;
    ranges.push({
      from: start,
      to: start + insert.length - head - tail,
      removed: old.length - head - tail,
    });
    shift += insert.length - (to - from);
  }
  return ranges;
}

// Line diff (Myers) of two short line lists: the operations that turn a into b.
function diffLines(a, b) {
  const n = a.length,
    m = b.length,
    max = n + m,
    trace = [];
  const v = new Map([[1, 0]]);
  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v.get(k - 1) < v.get(k + 1))
          ? v.get(k + 1)
          : v.get(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
  }
  return [];
}
function backtrack(trace, a, b, depth) {
  const ops = [];
  let x = a.length,
    y = b.length;
  for (let d = depth; d > 0; d--) {
    const v = trace[d],
      k = x - y;
    const prev =
      k === -d || (k !== d && v.get(k - 1) < v.get(k + 1)) ? k + 1 : k - 1;
    const px = v.get(prev),
      py = px - prev;
    while (x > px && y > py) (ops.push(["=", a[--x]]), y--);
    if (x === px) ops.push(["+", b[--y]]);
    else ops.push(["-", a[--x]]);
  }
  while (x > 0) (ops.push(["=", a[--x]]), y--);
  return ops.reverse();
}

// A unified diff from `before` to `after`, with three lines of context, for
// the side-by-side source view of a proposal. Lines both texts share at their
// start and end are left out of the comparison, which keeps it small.
export function unifiedDiff(before, after, name = "note.md") {
  const a = before.split("\n"),
    b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const ops = [
    ...a.slice(0, head).map((line) => ["=", line]),
    ...diffLines(
      a.slice(head, a.length - tail),
      b.slice(head, b.length - tail),
    ),
    ...a.slice(a.length - tail).map((line) => ["=", line]),
  ];
  // Each line with its numbers in both texts.
  let oldLine = 1,
    newLine = 1;
  const rows = ops.map(([kind, line]) => {
    const row = { kind, line, old: oldLine, new: newLine };
    if (kind !== "+") oldLine++;
    if (kind !== "-") newLine++;
    return row;
  });
  // Changed rows, grouped while fewer than 2 × 3 unchanged lines part them.
  const context = 3,
    groups = [];
  rows.forEach((row, i) => {
    if (row.kind === "=") return;
    const last = groups.at(-1);
    if (last && i - last.end <= 2 * context) last.end = i;
    else groups.push({ start: i, end: i });
  });
  if (!groups.length) return "";
  const range = (start, count) =>
    count === 1 ? String(start) : `${count ? start : start - 1},${count}`;
  const out = [`--- a/${name}`, `+++ b/${name}`];
  for (const { start, end } of groups) {
    const shown = rows.slice(
      Math.max(0, start - context),
      Math.min(rows.length, end + context + 1),
    );
    const oldCount = shown.filter((r) => r.kind !== "+").length,
      newCount = shown.filter((r) => r.kind !== "-").length;
    out.push(
      `@@ -${range(shown[0].old, oldCount)} +${range(shown[0].new, newCount)} @@`,
      ...shown.map((r) => (r.kind === "=" ? " " : r.kind) + r.line),
    );
  }
  return out.join("\n") + "\n";
}
