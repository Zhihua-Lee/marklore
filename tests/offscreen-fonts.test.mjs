// Which arriving fonts re-measure the skipped parts of a long note
// (src/offscreen-blocks.js): only faces the note is set in that cover a
// character it has, not the interface's (the format toolbar's labels).
import test from "node:test";
import assert from "node:assert/strict";
import { fontsMatter, unicodeRanges } from "../src/offscreen-blocks.js";

const families =
  '"Marklore Serif Latin", "Marklore Serif SC", serif,' +
  ' "JetBrains Mono Variable", "Noto Sans SC Variable", monospace';

test("unicode-range lists, wildcards and unreadable ranges", () => {
  assert.deepEqual(unicodeRanges("U+0-FF, U+131, U+4E??"), [
    [0, 0xff],
    [0x131, 0x131],
    [0x4e00, 0x4eff],
  ]);
  assert.equal(unicodeRanges(""), null);
  assert.equal(unicodeRanges("latin"), null);
});

test("a subset of a font the note uses matters only for characters it has", () => {
  const toolbar = {
    family: "Noto Sans SC Variable",
    unicodeRange: "U+52A0, U+7C97", // 加粗
  };
  // Noto Sans SC is in the code stack, but the note has neither character.
  assert.equal(
    fontsMatter([toolbar], { families, text: "Reading paragraph energy" }),
    false,
  );
  assert.equal(
    fontsMatter([toolbar], { families, text: "代码里写着加粗" }),
    true,
  );
});

test("the interface's own font never matters; formulas' always can", () => {
  const ui = { family: "Inter Variable", unicodeRange: "U+0-FF" };
  assert.equal(fontsMatter([ui], { families, text: "abc" }), false);
  const math = { family: "KaTeX_Main", unicodeRange: "U+0-10FFFF" };
  assert.equal(fontsMatter([math], { families, text: "x" }), true);
  // Quoted family names and faces without a readable range.
  const quoted = { family: '"Marklore Serif Latin"', unicodeRange: "" };
  assert.equal(fontsMatter([quoted], { families, text: "x" }), true);
  // Nothing said about the faces: re-measure, as before.
  assert.equal(fontsMatter([], { families, text: "x" }), true);
});
