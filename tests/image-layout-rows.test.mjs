import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "prosemirror-state";
import { schema, load, write, mapBlocks } from "../src/rich/markdown.js";
import { besideBefore, takeOut } from "../src/rich/image-layout.js";

// The editor's row actions (src/rich/image-layout.js) as the note writes
// them: a row's shares sum to 98% (2% per space between two images), an
// image leaving a row is at its own size again.

function run(src, action, nth) {
  const loaded = load(src);
  const state = EditorState.create({ doc: loaded.doc, schema });
  const found = [];
  state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.image) found.push(pos);
  });
  const tr = action(state, found[nth]);
  if (!tr) return null;
  mapBlocks(loaded, tr.mapping);
  return write(tr.doc, loaded).text;
}
const shares = (text) =>
  [...text.matchAll(/width="([\d.]+)%"/g)].map((m) => Number(m[1]));

test("beside the image before: a row, its shares kept in proportion", () => {
  assert.equal(
    run("![a](a.png)\n\n![b](b.png)\n", besideBefore, 1),
    '<img src="a.png" alt="a" width="49%"> <img src="b.png" alt="b" width="49%">\n',
  );
  assert.equal(run("![a](a.png)\n\n![b](b.png)\n", besideBefore, 0), null);
  assert.equal(run("Text.\n\n![b](b.png)\n", besideBefore, 0), null);
  const three = shares(
    run(
      '<img src="a.png" alt="a" width="60%"> <img src="b.png" alt="b" width="38%">\n\n![c](c.png)\n',
      besideBefore,
      2,
    ),
  );
  assert.equal(Math.round(three.reduce((a, b) => a + b) * 10) / 10, 96);
  assert.ok(three[0] > three[1]);
});

test("taken out of a row: alone at its own size, after the row", () => {
  const row =
    '<img src="a.png" alt="a" width="32%"> <img src="b.png" alt="b" width="32%"> <img src="c.png" alt="c" width="32%">\n';
  assert.equal(
    run(row, takeOut, 1),
    '<img src="a.png" alt="a" width="49%"> <img src="c.png" alt="c" width="49%">\n\n![b](b.png)\n',
  );
  assert.equal(
    run(
      '<img src="a.png" alt="a" width="49%"> <img src="b.png" alt="b" width="49%">\n',
      takeOut,
      0,
    ),
    "![b](b.png)\n\n![a](a.png)\n",
  );
  assert.equal(run("![a](a.png)\n", takeOut, 0), null);
});
