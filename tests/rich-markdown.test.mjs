import test from "node:test";
import assert from "node:assert/strict";
import { Transform } from "prosemirror-transform";
import {
  schema,
  load,
  write,
  mapBlocks,
  mapText,
} from "../src/rich/markdown.js";

// The Edit mode's reading and writing of Markdown (src/rich/markdown.js):
// a note read and written without a change is the same text, and a change
// writes a file that reads back as what the editor shows.

const M = schema.marks;
// The note after `change` (on a Transform of its document), as written.
function edit(src, change) {
  const loaded = load(src);
  const tr = new Transform(loaded.doc);
  change(tr, loaded.doc);
  mapBlocks(loaded, tr.mapping);
  return { text: write(tr.doc, loaded).text, doc: tr.doc };
}
function at(doc, needle, offset = 0) {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text.includes(needle))
      found = pos + node.text.indexOf(needle) + offset;
  });
  assert.ok(found >= 0, "no " + needle);
  return found;
}
const split =
  (needle, offset = 0) =>
  (tr, doc) =>
    tr.split(at(doc, needle, offset));
const type =
  (needle, text, offset = 0) =>
  (tr, doc) => {
    const pos = at(doc, needle, offset);
    tr.insert(pos, schema.text(text, doc.resolve(pos).marks()));
  };
// What the written text shows, block by block.
const shown = (text) => load(text).doc.toString();

test("a note read and written unchanged is the same text", () => {
  for (const src of [
    "---\ntitle: T\n---\n\n# H\n\ntext\n",
    "intro:\n- a\n- b\n",
    "1.  wide &nbsp; item\n2.  second\n",
    "[text][ref]\n\n[ref]: http://x 'T'\n",
    "| a | b |\n|---|---|\n| `x\\|y` | $a\\|b$ |\n",
    "text[^1]\n\n[^1]: note\n",
    "````md\n```js\nx\n```\n````\n",
    "- [ ] todo\n- [X] Done\n- [ ] \n",
    "no final newline",
    "\\<b>not html\\</b> &amp;copy;\n",
  ])
    assert.equal(write(load(src).doc, load(src)).text, src, src);
});

test("an address with a space stays an address", () => {
  const link = "See the plan: [notes](<My Note.md>) here.\n";
  let r = edit(link, split("notes"));
  assert.equal(r.text, "See the plan: \n\n[notes](<My Note.md>) here.\n");
  r = edit("Intro. ![pic](<my img.png>) end\n", split("Intro.", 6));
  assert.match(r.text, /!\[pic\]\(<my img\.png>\)/);
  // As the link box adds one.
  r = edit("go to notes now\n", (tr, doc) => {
    const pos = at(doc, "notes");
    tr.addMark(pos, pos + 5, M.link.create({ href: "My Note.md" }));
  });
  assert.equal(r.text, "go to [notes](<My Note.md>) now\n");
  assert.match(shown(r.text), /link\("notes"\)/);
});

test("text that looks like HTML or an entity stays text", () => {
  const r = edit(
    "Title here. Use \\<b>bold\\</b> and &amp;copy; in HTML.\n",
    split("Use"),
  );
  assert.match(
    shown(r.text),
    /paragraph\("Use <b>bold<\/b> and &copy; in HTML\."\)/,
  );
});

test("new neighbours are apart by a blank line", () => {
  let r = edit("intro:\n- a\n- b\n", split("intro:", 2));
  assert.equal(r.text, "in\n\ntro:\n\n- a\n- b\n");
  r = edit("text one\n## Heading\ntext two\n", (tr, doc) => {
    const pos = at(doc, "Heading");
    tr.delete(pos - 1, pos + 8);
  });
  assert.equal(r.text, "text one\n\ntext two\n");
  // Untouched neighbours keep their one line break.
  r = edit("intro:\n- a\n- b\n", type("intro:", "Z"));
  assert.equal(r.text, "Zintro:\n- a\n- b\n");
});

test("a fence line in code lengthens the fence", () => {
  const r = edit("```md\ncode\n```\n\nafter\n", (tr, doc) => {
    const pos = at(doc, "code", 4);
    tr.insert(pos, schema.text("\n```js\nx\n```"));
  });
  assert.equal(r.text, "````md\ncode\n```js\nx\n```\n````\n\nafter\n");
  assert.match(shown(r.text), /paragraph\("after"\)\)$/);
});

test("a pipe in a cell's code stays escaped", () => {
  const r = edit(
    "| a | b |\n|---|---|\n| `x\\|y` | z |\n",
    type("x|y", "Z", 1),
  );
  assert.equal(r.text, "| a | b |\n|---|---|\n| `xZ\\|y` | z |\n");
});

test("typing changes only what was typed", () => {
  assert.equal(
    edit("1.  first &nbsp; item\n2.  second\n", type("second", "Z")).text,
    "1.  first &nbsp; item\n2.  Zsecond\n",
  );
  assert.equal(
    edit("-   wide marker\n-   two\n", type("two", "Z")).text,
    "-   wide marker\n-   Ztwo\n",
  );
  // After a link written by reference, at the end of its paragraph.
  const byReference = "See [the Plan][Ref]\n\n[ref]: http://x 'T'\n";
  assert.equal(
    edit(byReference, (tr, doc) =>
      tr.insert(at(doc, "the Plan", 8), schema.text(" more")),
    ).text,
    "See [the Plan][Ref] more\n\n[ref]: http://x 'T'\n",
  );
  assert.equal(
    edit(byReference, type("See", "Now ")).text,
    "Now See [the Plan][Ref]\n\n[ref]: http://x 'T'\n",
  );
});

test("a task item with no text yet is still a task", () => {
  const src = "- [ ] todo\n- [ ] \n";
  assert.match(shown(src), /list_item\(paragraph\(task_box, " "\)\)\)\)$/);
});

test("places in a long table map to its Markdown", () => {
  const rows = Array.from({ length: 400 }, (_, i) => `| row${i} | value${i} |`);
  const src = ["| a | b |", "|---|---|", ...rows].join("\n") + "\n";
  const node = load(src).doc.firstChild;
  const flat = node.textBetween(0, node.content.size, "\n", "￼");
  const k = flat.indexOf("row399");
  const offset = mapText(flat, src, k);
  assert.equal(src.slice(offset, offset + 6), "row399");
});
