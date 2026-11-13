import test from "node:test";
import assert from "node:assert/strict";
import { createParser } from "../src/markdown.js";

// The places in the source the reading view gives its text (src/markdown.js):
// formatting from Read mode edits the note at them, so each piece of text
// must point at itself, not at the same characters elsewhere in its line.

const md = createParser();
function render(src) {
  const env = {};
  return md.render(src, env).split(env.mathPipe).join("|");
}
const plain = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
// Every run of text with its place: [text, from, to].
function leaves(src) {
  const out = [];
  for (const m of render(src).matchAll(
    /data-text-from="(\d+)" data-text-to="(\d+)">([^<]*)</g,
  ))
    out.push([plain(m[3]), Number(m[1]), Number(m[2])]);
  return out;
}
function sound(src) {
  for (const [text, from, to] of leaves(src))
    assert.equal(
      src.slice(from, to),
      text,
      `${JSON.stringify(src)} at ${from}`,
    );
}

test("text is not taken for what begins its line", () => {
  for (const src of [
    "1. 1\n",
    "10. 1\n",
    "> 1. 1\n",
    "3. 3**rd** place\n",
    "# # *#*\n",
    "> > *>*\n",
    "- - x\n",
    "* *important* note\n",
  ])
    sound(src);
  assert.deepEqual(leaves("1. 1\n"), [["1", 3, 4]]);
  assert.deepEqual(leaves("10. 1\n"), [["1", 4, 5]]);
  // The emphasis is the one after the bullet.
  assert.match(
    render("* *important* note\n"),
    /<em data-src-from="2" data-src-to="13" data-src-inner-from="3" data-src-inner-to="12">/,
  );
});

test("text after code, a footnote or a formula is not found inside it", () => {
  assert.deepEqual(leaves("`x\ny z` z\n").at(-1), [" z", 7, 9]);
  assert.deepEqual(leaves("Yes^[or no] no\n").at(-1), [" no", 11, 14]);
  assert.deepEqual(
    leaves("x[^note]note\n\n[^note]: n\n").find(([text]) => text === "note"),
    ["note", 8, 12],
  );
  assert.deepEqual(leaves("> $x +\n> y$ y\n").at(-1), [" y", 11, 13]);
});

test("amounts of money in a table row are not a formula", () => {
  const row = render("| Item | Price |\n| --- | --- |\n| tea $5 | was $6 |\n");
  assert.match(row, />tea \$5<\/span><\/td>/);
  assert.match(row, />was \$6<\/span><\/td>/);
  assert.match(
    render("| cost $5 | tax $6 |\n| --- | --- |\n| a | b |\n"),
    /<table/,
  );
  // A formula with a pipe still keeps its cell.
  assert.equal(
    render("| a | b |\n| --- | --- |\n| $x|y$ | z |\n").match(/<td/g).length,
    2,
  );
});

test("HTML in a note cannot claim a place in the source", () => {
  const html = render(
    'a <span data-text-from="0" data-text-to="5" data-note="kept">click</span>\n\n<div data-from="0" data-to="3">x</div>\n',
  );
  assert.doesNotMatch(html, /<span data-text-from="0" data-text-to="5"/);
  assert.doesNotMatch(html, /<div data-from/);
  assert.match(html, /data-note="kept"/);
});
