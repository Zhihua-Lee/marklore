import test from "node:test";
import assert from "node:assert/strict";
import { Transform } from "prosemirror-transform";
import {
  readImgTag,
  imgTag,
  readImgLine,
  readAlignedLine,
  spread,
  rowTotal,
} from "../src/image-layout.js";
import { blockPieces } from "../src/markdown.js";
import { planEdit } from "../src/incremental-render.js";
import { schema, load, write, mapBlocks } from "../src/rich/markdown.js";

// Image size, alignment and rows as kept in the note (src/image-layout.js):
// an image never resized stays `![alt](src)`; a resized one is an `<img>`
// tag, an aligned one is wrapped in `<p align>`, images in a row are tags in
// one line, and anything else side by side is a `<div class="columns">`.

const S = schema.nodes;
const forms = {
  plain: "![A cat](assets/cat.png)",
  resized: '<img src="assets/cat.png" alt="A cat" width="60%">',
  aligned:
    '<p align="right"><img src="assets/cat.png" alt="A cat" width="40%"></p>',
  alignedNatural: '<p align="left"><img src="assets/cat.png" alt="A cat"></p>',
  row: '<img src="a.png" alt="A" width="49%"> <img src="b.png" alt="B" width="49%">',
  columns: [
    '<div class="columns">',
    '<div class="column" data-width="60%">',
    "",
    "Some **text** and $x^2$.",
    "",
    "- an item",
    "",
    "</div>",
    '<div class="column" data-width="40%">',
    "",
    "![c](c.png)",
    "",
    "</div>",
    "</div>",
  ].join("\n"),
};
const note = (...blocks) => "# Note\n\n" + blocks.join("\n\n") + "\n\nEnd.\n";

test("an <img> tag is read only with the attributes the layout writes", () => {
  assert.deepEqual(readImgTag('<img src="a b.png" alt="x &amp; y">').image, {
    src: "a b.png",
    alt: "x & y",
    title: null,
    width: null,
  });
  assert.equal(readImgTag("<img src='a.png' width=300 />").image.width, "300");
  for (const other of [
    '<img src="a.png" style="zoom: 50%">',
    '<img src="a.png" onerror="x()">',
    '<img alt="no address">',
    '<img src="a.png" width="wide">',
    '<img src="a.png" alt="&copy;">',
  ])
    assert.equal(readImgTag(other), null, other);
  const image = { src: 'a"b.png', alt: "<x>", title: "T", width: "60%" };
  assert.deepEqual(readImgTag(imgTag(image)).image, image);
  assert.equal(readImgLine("<img src=a.png> \n <img src=b.png>").length, 2);
  assert.equal(readImgLine("<img src=a.png> text"), null);
  assert.equal(
    readAlignedLine('<p align="center">\n  <img src="a.png">\n</p>').align,
    "center",
  );
  assert.deepEqual(spread([1, 1, 1], rowTotal(3)), [32, 32, 32]);
  assert.deepEqual(spread([30, 70], 98), [29.4, 68.6]);
});

test("the reading view renders each form with its place in the source", () => {
  const src = note(...Object.values(forms));
  const blocks = blockPieces(src);
  const html = (needle) => blocks.find((b) => b.html.includes(needle)).html;
  assert.match(html('alt="A cat"'), /^<p data-from/);
  const resized = blocks[2].html;
  assert.match(resized, /^<p class="image-line" data-from="\d+"/);
  assert.match(resized, /<img src="assets\/cat.png" alt="A cat" width="60%"/);
  const at = src.indexOf(forms.resized);
  assert.match(
    resized,
    new RegExp(
      `data-src-from="${at}" data-src-to="${at + forms.resized.length}"`,
    ),
  );
  assert.match(blocks[3].html, /class="image-line image-align-right"/);
  assert.match(blocks[4].html, /class="image-line image-align-left"/);
  assert.match(blocks[5].html, /^<p class="image-row"/);
  assert.equal((blocks[5].html.match(/<img /g) || []).length, 2);
  const columns = blocks[6];
  assert.equal(columns.type, "columns_open");
  assert.equal(columns.formulas, 1);
  assert.match(columns.html, /^<div class="columns" data-from/);
  assert.match(columns.html, /<div class="column" style="--share: 60"/);
  assert.match(columns.html, /<strong data-src-from/);
  assert.match(columns.html, /<li data-from/);
  // Each block renders apart: a note with columns is not rendered whole.
  assert.equal(blocks.length, 8);
});

test("a plain image and HTML the layout does not read stay as they were", () => {
  const blocks = blockPieces(
    note('<img src="a.png" class="x">', "Text <img src=a.png width=10> text"),
  );
  assert.equal(blocks[1].type, "html_block");
  assert.doesNotMatch(blocks[2].html, /image-line|image-row/);
  assert.match(blocks[2].html, /<img src="a.png" alt="" width="10"/);
});

// --- The editor's model --------------------------------------------------

function edit(src, change) {
  const loaded = load(src);
  const tr = new Transform(loaded.doc);
  change(tr, loaded.doc);
  mapBlocks(loaded, tr.mapping);
  return write(tr.doc, loaded).text;
}
// The position of the first image (or the nth) in the document.
function imageAt(doc, nth = 0) {
  const found = [];
  doc.descendants((node, pos) => {
    if (node.type === S.image) found.push({ node, pos });
  });
  return found[nth];
}
const setImage =
  (attrs, nth = 0) =>
  (tr, doc) => {
    const { node, pos } = imageAt(doc, nth);
    tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs });
  };

test("every form reads into the editor and writes back as it was", () => {
  for (const src of [
    note(...Object.values(forms)),
    '<img src=a.png width=30%>\n\nText <img src="b.png"> here.\n',
    '<p align="center">\n<img src="a.png" width="40%">\n<img src="b.png" width="40%">\n</p>\n',
    '<div class="columns">\n<div class="column">\nno blank lines\n</div>\n<div class="column">\n\n```\n</div>\n```\n\n</div>\n</div>\n',
    '- item\n\n  <img src="a.png" width="20%">\n',
  ]) {
    const loaded = load(src);
    assert.equal(write(loaded.doc, loaded).text, src, src);
  }
  const doc = load(note(...Object.values(forms))).doc;
  assert.equal(
    doc.toString(),
    'doc(heading("Note"), paragraph(image), paragraph(image), paragraph(image), paragraph(image), paragraph(image, " ", image), columns(column(paragraph("Some ", strong("text"), " and ", math_inline, "."), bullet_list(list_item(paragraph("an item")))), column(paragraph(image))), paragraph("End."))',
  );
  assert.deepEqual(
    { ...imageAt(doc, 2).node.attrs },
    {
      src: "assets/cat.png",
      alt: "A cat",
      title: null,
      width: "40%",
      align: "right",
    },
  );
});

test("resizing, aligning and resetting an image write its forms", () => {
  const src = note(forms.plain);
  const resized = edit(src, setImage({ width: "60%" }));
  assert.equal(resized, note(forms.resized));
  assert.equal(
    edit(resized, setImage({ width: "40%", align: "right" })),
    note(forms.aligned),
  );
  assert.equal(
    edit(note(forms.aligned), setImage({ width: null, align: null })),
    note(forms.plain),
  );
  // Another image in the note, untouched, keeps its Markdown.
  assert.equal(
    edit(note(forms.plain, forms.plain), setImage({ width: "50%" }, 1)),
    note(forms.plain, forms.resized.replace("60%", "50%")),
  );
  // An image resized with a list right under it: a blank line between, or
  // the list would read as part of the HTML.
  assert.equal(
    edit("Text\n\n![a](a.png)\n- item\n", setImage({ width: "30%" })),
    'Text\n\n<img src="a.png" alt="a" width="30%">\n\n- item\n',
  );
});

test("a row and columns made in the editor write their forms", () => {
  const src = note(forms.plain, "![B](b.png)");
  const row = edit(src, (tr, doc) => {
    const a = imageAt(doc, 0);
    const b = imageAt(doc, 1);
    const para = tr.doc.resolve(b.pos).before();
    tr.delete(para, para + tr.doc.nodeAt(para).nodeSize);
    tr.insert(a.pos + 1, [
      schema.text(" "),
      b.node.type.create({ ...b.node.attrs, width: "49%" }),
    ]);
    tr.setNodeMarkup(a.pos, null, { ...a.node.attrs, width: "49%" });
  });
  assert.equal(
    row,
    note(
      '<img src="assets/cat.png" alt="A cat" width="49%"> <img src="b.png" alt="B" width="49%">',
    ),
  );
  const columns = edit(note("Some text.", forms.plain), (tr, doc) => {
    const text = doc.child(1);
    const image = doc.child(2);
    const from = doc.child(0).nodeSize;
    tr.replaceWith(
      from,
      from + text.nodeSize + image.nodeSize,
      S.columns.create(null, [
        S.column.create({ width: 50 }, text),
        S.column.create({ width: 50 }, image),
      ]),
    );
  });
  assert.equal(
    columns,
    note(
      '<div class="columns">\n<div class="column" data-width="50%">\n\nSome text.\n\n</div>\n<div class="column" data-width="50%">\n\n![A cat](assets/cat.png)\n\n</div>\n</div>',
    ),
  );
  assert.equal(write(load(columns).doc, load(columns)).text, columns);
});

// --- Rendering block by block ----------------------------------------------

const positions =
  / data-(?:text-|edit-|block-|cell-|src-(?:inner-)?)?(?:from|to)="(\d+)"/g;
const plain = (html) =>
  html.replace(/ data-folio-(formula|edit)="[^"]*"/g, " data-folio-$1");
// The blocks an edit renders again, with the old ones around them, are
// those of the whole note rendered again (as in incremental-render.test.mjs).
function same(before, after) {
  const old = blockPieces(before);
  assert.ok(old, "split");
  const plan = planEdit(old, before, after);
  const window = { line: plan.line, stop: plan.stop };
  const pieces = blockPieces(after, window);
  assert.ok(pieces, "window");
  const last = plan.last(window.end);
  const moved = (html) =>
    html.replace(positions, (m, n) =>
      m.replace(n, String(Number(n) + plan.delta)),
    );
  const blocks = [
    ...old.slice(0, plan.first),
    ...pieces,
    ...old.slice(last).map((b) => ({
      ...b,
      from: b.from + plan.delta,
      to: b.to + plan.delta,
      html: moved(b.html),
    })),
  ];
  const view = (list) =>
    list.map(({ from, to, type, html }) => ({
      from,
      to,
      type,
      html: plain(html),
    }));
  assert.deepEqual(view(blocks), view(blockPieces(after)));
  return pieces.length;
}

test("an edit inside columns renders the container again, alone", () => {
  const before = note("Before.", forms.columns, forms.row, "After.");
  const at = before.indexOf("an item") + 2;
  const after = before.slice(0, at) + " edited" + before.slice(at);
  assert.equal(same(before, after), 1);
  // The container broken (its last line removed): rendered as it now reads.
  const broken = before.replace("</div>\n</div>", "</div>");
  assert.equal(blockPieces(broken), null);
  // A width changed in a row.
  assert.equal(same(before, before.replace("49%", "30%")), 1);
});
