import test from "node:test";
import assert from "node:assert/strict";
import {
  locateEdits,
  applyChanges,
  changedRanges,
  unifiedDiff,
} from "../desktop/proposal-edits.mjs";

const note = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";

test("edits are found once each and applied in note order", () => {
  const { changes } = locateEdits(note, [
    { old_text: "Second", new_text: "Last" },
    { old_text: "First paragraph.", new_text: "First paragraph, longer." },
  ]);
  assert.deepEqual(
    changes.map((c) => c.from),
    [9, 27],
  );
  assert.equal(
    applyChanges(note, changes),
    "# Title\n\nFirst paragraph, longer.\n\nLast paragraph.\n",
  );
});

test("a missing, repeated, empty, unchanged or overlapping old text is refused", () => {
  assert.deepEqual(locateEdits(note, [{ old_text: "Third", new_text: "x" }]), {
    error: { edit: 0, reason: "missing" },
  });
  assert.deepEqual(
    locateEdits(note, [{ old_text: "paragraph", new_text: "x" }]),
    { error: { edit: 0, reason: "ambiguous", count: 2 } },
  );
  assert.equal(
    locateEdits(note, [{ old_text: "", new_text: "x" }]).error.reason,
    "empty",
  );
  assert.equal(
    locateEdits(note, [{ old_text: "Title", new_text: "Title" }]).error.reason,
    "unchanged",
  );
  assert.deepEqual(
    locateEdits(note, [
      { old_text: "First paragraph", new_text: "A" },
      { old_text: "paragraph.\n\nSecond", new_text: "B" },
    ]),
    { error: { edit: 1, reason: "overlap" } },
  );
});

test("Windows line ends in an edit match the note's", () => {
  const { changes } = locateEdits(note, [
    { old_text: "Title\r\n\r\nFirst", new_text: "Name\r\n\r\nFirst" },
  ]);
  assert.equal(applyChanges(note, changes).slice(0, 13), "# Name\n\nFirst");
});

test("changed ranges leave out what an edit keeps", () => {
  const { changes } = locateEdits(note, [
    { old_text: "First paragraph.", new_text: "First short paragraph." },
    { old_text: "Second paragraph.\n", new_text: "" },
  ]);
  const after = applyChanges(note, changes);
  const ranges = changedRanges(note, changes);
  assert.equal(after.slice(ranges[0].from, ranges[0].to), "short ");
  assert.equal(ranges[0].removed, 0);
  assert.equal(ranges[1].from, ranges[1].to);
  assert.equal(ranges[1].removed, "Second paragraph.\n".length);
  assert.equal(after.slice(ranges[1].from - 2), "\n\n");
});

test("the unified diff shows the changed lines with context", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
    "\n",
  );
  const after = before.replace("line 3", "line three").replace("line 15\n", "");
  assert.equal(
    unifiedDiff(before, after, "a.md"),
    [
      "--- a/a.md",
      "+++ b/a.md",
      "@@ -1,6 +1,6 @@",
      " line 1",
      " line 2",
      "-line 3",
      "+line three",
      " line 4",
      " line 5",
      " line 6",
      "@@ -12,7 +12,6 @@",
      " line 12",
      " line 13",
      " line 14",
      "-line 15",
      " line 16",
      " line 17",
      " line 18",
      "",
    ].join("\n"),
  );
  assert.equal(unifiedDiff("same", "same"), "");
  assert.equal(
    unifiedDiff("", "new\n", "n.md"),
    "--- a/n.md\n+++ b/n.md\n@@ -1 +1,2 @@\n+new\n \n",
  );
});

test("nearby changes share a hunk", () => {
  const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\n";
  const after = "A\nb\nc\nd\ne\nf\nG\nh\ni\n";
  const diff = unifiedDiff(before, after);
  assert.equal(diff.match(/^@@/gm).length, 1);
  assert.match(diff, /^-a\n\+A$/m);
  assert.match(diff, /^-g\n\+G$/m);
});

// Applies a unified diff to `before`, checking every context and removed line.
function patch(before, diff) {
  const lines = before.split("\n"),
    out = [];
  let at = 0;
  const body = diff.split("\n").slice(2, -1);
  for (let i = 0; i < body.length; i++) {
    const head = body[i].match(/^@@ -(\d+)(?:,(\d+))? /);
    if (head) {
      const start = Number(head[1]) - (head[2] === "0" ? 0 : 1);
      while (at < start) out.push(lines[at++]);
      continue;
    }
    const kind = body[i][0],
      text = body[i].slice(1);
    if (kind === "+") out.push(text);
    else {
      assert.equal(lines[at], text);
      if (kind === " ") out.push(text);
      at++;
    }
  }
  while (at < lines.length) out.push(lines[at++]);
  return out.join("\n");
}

test("random line edits round-trip through the unified diff", () => {
  let seed = 7;
  const random = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let round = 0; round < 300; round++) {
    const before = Array.from({ length: random(30) }, () => "abcde"[random(5)]);
    const after = [...before];
    for (let k = random(6); k > 0; k--) {
      const at = random(after.length + 1);
      if (random(2)) after.splice(at, 1);
      else after.splice(at, 0, "xyz"[random(3)]);
    }
    const a = before.join("\n"),
      b = after.join("\n");
    const diff = unifiedDiff(a, b);
    if (a === b) assert.equal(diff, "");
    else assert.equal(patch(a, diff), b);
  }
});
