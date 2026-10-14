import test from "node:test";
import assert from "node:assert/strict";
import {
  diffLines,
  diffMarkup,
  diffDocument,
  diffName,
} from "../src/diff-view.js";

const git = [
  "diff --git a/src/app.js b/src/app.js",
  "index 1111111..2222222 100644",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1,4 +1,4 @@",
  " keep",
  "--- a removed line that starts with two dashes",
  "+++ an added line that starts with two pluses",
  " keep",
  "\\ No newline at end of file",
  "diff --git a/README.md b/README.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/README.md",
  "@@ -0,0 +1,2 @@",
  "+# Title",
  "+`code` and ```fences```",
  "",
].join("\n");

test("diff and patch files are recognised by name", () => {
  assert.ok(diffName("fix.diff") && diffName("C:/x/0001-fix.PATCH"));
  assert.ok(!diffName("notes.md") && !diffName("diff.txt"));
});

test("lines inside a hunk are content, even when they look like headers", () => {
  const { kinds } = diffLines(git);
  assert.deepEqual(kinds.slice(0, 10), [
    "file",
    "meta",
    "meta",
    "meta",
    "hunk",
    "context",
    "del",
    "add",
    "context",
    "note",
  ]);
  assert.equal(kinds[10], "file");
  assert.deepEqual(kinds.slice(11, 17), [
    "meta",
    "meta",
    "meta",
    "hunk",
    "add",
    "add",
  ]);
});

test("wrong hunk counts (hand-made patches) fall back to first characters", () => {
  const text = [
    "--- a/x",
    "+++ b/x",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "+more than the count said",
    " context",
    "@@ -10,99 +10,99 @@",
    "-gone",
    "diff --git a/y b/y",
  ].join("\n");
  assert.deepEqual(diffLines(text).kinds, [
    "file",
    "meta",
    "hunk",
    "del",
    "add",
    "add",
    "context",
    "hunk",
    "del",
    "file",
  ]);
});

test("each line is its own element, escaped, with its newline kept for copy", () => {
  const html = diffMarkup("+<b>&\n-old\n x\n");
  assert.equal(
    html,
    '<span class="diff-line diff-add">+&lt;b&gt;&amp;\n</span>' +
      '<span class="diff-line diff-del">-old\n</span>' +
      '<span class="diff-line diff-context"> x\n</span>',
  );
  assert.ok(!diffMarkup("+a").endsWith("\n</span>"));
});

test("a diff becomes one section per file, and positions map back to it", () => {
  const { markdown, map, files } = diffDocument(git);
  assert.equal(files, 2);
  const titles = markdown.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(titles, [
    "## `src/app.js` · +1 −1",
    "## `README.md` · 新文件 · +2",
  ]);
  // Backticks in the diff need a longer fence.
  assert.match(markdown, /^````diff$/m);
  // Verbatim text maps one to one; generated text maps to where its part starts.
  const hunk = markdown.indexOf("@@ -0,0 +1,2 @@");
  assert.equal(map(hunk), git.indexOf("@@ -0,0 +1,2 @@"));
  const second = markdown.indexOf("## `README.md`");
  assert.equal(map(second), git.indexOf("diff --git a/README.md"));
  assert.equal(map(0), 0);
  assert.equal(map(markdown.length), git.length);
});

test("a format-patch message stays above the files; renames and deletions are named", () => {
  const text = [
    "From 1234 Mon Sep 17 00:00:00 2001",
    "Subject: [PATCH] Rename",
    "",
    "---",
    " a.txt | 0",
    "",
    "diff --git a/old name.txt b/new name.txt",
    "similarity index 100%",
    "rename from old name.txt",
    "rename to new name.txt",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
  ].join("\n");
  const { markdown, map } = diffDocument(text);
  assert.ok(markdown.startsWith("```\nFrom 1234"));
  assert.match(markdown, /^## `old name\.txt` → `new name\.txt`$/m);
  assert.match(markdown, /^## `gone\.txt` · 已删除 · −1$/m);
  assert.equal(map(markdown.indexOf("Subject:")), text.indexOf("Subject:"));
});

test("text without file headers is shown whole", () => {
  assert.equal(
    diffDocument("@@ -1 +1 @@\n-a\n+b\n").markdown,
    "```diff\n@@ -1 +1 @@\n-a\n+b\n```\n\n",
  );
  assert.equal(diffDocument("just words").markdown, "```\njust words\n```\n\n");
  assert.equal(diffDocument("").markdown, "");
});
