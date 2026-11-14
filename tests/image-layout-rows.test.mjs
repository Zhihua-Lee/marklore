import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "prosemirror-state";
import { schema, load, write, mapBlocks } from "../src/rich/markdown.js";
import {
  besideBefore,
  takeOut,
  moveBeside,
  moveOut,
} from "../src/rich/image-layout.js";

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
  // The first block has nothing before it.
  assert.equal(run("![b](b.png)\n\nText.\n", besideBefore, 0), null);
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

const columns = (...cells) =>
  '<div class="columns">\n' +
  cells
    .map(
      ([width, text]) =>
        `<div class="column" data-width="${width}%">\n\n${text}\n\n</div>\n`,
    )
    .join("") +
  "</div>";

test("beside text: two columns; out of a column: the columns written again", () => {
  const made = run("Text.\n\n![a](a.png)\n", besideBefore, 0);
  assert.equal(made, columns([50, "Text."], [50, "![a](a.png)"]) + "\n");
  // Taken out: one column left is just its text.
  assert.equal(run(made, takeOut, 0), "Text.\n\n![a](a.png)\n");
  // A third column takes an even share.
  const three = run(made + "\n![b](b.png)\n", besideBefore, 1);
  assert.equal(
    three,
    columns([33.3, "Text."], [33.3, "![a](a.png)"], [33.4, "![b](b.png)"]) +
      "\n",
  );
  // Columns of images only are a row of images.
  assert.equal(
    run(
      columns([30, "![a](a.png)"], [30, "![b](b.png)"], [40, "![c](c.png)"]) +
        "\n",
      takeOut,
      2,
    ),
    '<img src="a.png" alt="a" width="49%"> <img src="b.png" alt="b" width="49%">\n\n![c](c.png)\n',
  );
});

// Where image `nth` would be dropped: beside image `target`, or a block.
function drag(src, nth, target) {
  const loaded = load(src);
  const state = EditorState.create({ doc: loaded.doc, schema });
  const found = [];
  state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.image) found.push(pos);
  });
  const blocks = [];
  state.doc.forEach((_n, pos) => blocks.push(pos));
  const to =
    target.image !== undefined
      ? { kind: "image", pos: found[target.image], side: target.side }
      : target.between !== undefined
        ? blocks[target.between]
        : {
            kind: target.kind || "block",
            pos: blocks[target.block],
            side: target.side,
          };
  const tr =
    typeof to === "number"
      ? moveOut(state, found[nth], to)
      : moveBeside(state, found[nth], to);
  if (!tr) return null;
  mapBlocks(loaded, tr.mapping);
  return write(tr.doc, loaded).text;
}

test("dragged to a side: into a row, beside text, out again", () => {
  const two = "![a](a.png)\n\n![b](b.png)\n";
  assert.equal(
    drag(two, 1, { image: 0, side: "left" }),
    '<img src="b.png" alt="b" width="49%"> <img src="a.png" alt="a" width="49%">\n',
  );
  const row =
    '<img src="a.png" alt="a" width="49%"> <img src="b.png" alt="b" width="49%">\n\nEnd.\n';
  // Within its row: another place.
  assert.equal(
    drag(row, 0, { image: 1, side: "right" }),
    '<img src="b.png" alt="b" width="49%"> <img src="a.png" alt="a" width="49%">\n\nEnd.\n',
  );
  // Out of the row, before the block after it.
  assert.equal(
    drag(row, 1, { between: 1 }),
    "![a](a.png)\n\n![b](b.png)\n\nEnd.\n",
  );
  assert.equal(
    drag("Text.\n\n![a](a.png)\n", 0, { block: 0, side: "right" }),
    columns([50, "Text."], [50, "![a](a.png)"]) + "\n",
  );
  // An image alone, dropped between blocks: left to the editor.
  assert.equal(drag("![a](a.png)\n\nText.\n", 0, { between: 1 }), null);
});
