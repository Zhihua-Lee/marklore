import test from "node:test";
import assert from "node:assert/strict";
import { addsOnly, applyChanges } from "../src/format-units.js";

// A bold, italic or strike from inside other emphasis is kept only when the
// note renders as meant (src/format-check.js, src/format-units.js).
const units = (text, formats = []) =>
  [...text].map((key) => ({ key, formats }));

test("changes from the same text are applied in order", () => {
  assert.equal(
    applyChanges(
      "**ab** cd",
      [
        { from: 4, to: 4, insert: "*" },
        { from: 3, to: 3, insert: "*" },
      ].sort((a, b) => a.from - b.from),
    ),
    "**a*b*** cd",
  );
  assert.equal(
    applyChanges("one two", [
      { from: 0, to: 3, insert: "**one**" },
      { from: 4, to: 7, insert: "<em>two</em>" },
    ]),
    "**one** <em>two</em>",
  );
});

test("only the selected units gain the format, the others keep theirs", () => {
  const before = [...units("ab", ["strong"]), ...units(" cd")];
  const selected = (_, i) => i >= 1;
  const meant = [
    { key: "a", formats: ["strong"] },
    { key: "b", formats: ["strong", "em"] },
    { key: " ", formats: ["em"] },
    { key: "c", formats: ["em"] },
    { key: "d", formats: ["em"] },
  ];
  assert.equal(addsOnly(before, meant, selected, "em"), true);
  // A selected space may stay out of the delimiters.
  const outside = meant.map((unit, i) =>
    i === 2 ? { ...unit, formats: [] } : unit,
  );
  assert.equal(addsOnly(before, outside, selected, "em"), true);
  // The unselected part of the bold took the format too.
  const wider = meant.map((unit, i) =>
    i === 0 ? { ...unit, formats: ["strong", "em"] } : unit,
  );
  assert.equal(addsOnly(before, wider, selected, "em"), false);
  // The bold was lost, or a letter not formatted.
  const lost = meant.map((unit, i) =>
    i === 1 ? { ...unit, formats: ["em"] } : unit,
  );
  assert.equal(addsOnly(before, lost, selected, "em"), false);
  const missed = meant.map((unit, i) =>
    i === 3 ? { ...unit, formats: [] } : unit,
  );
  assert.equal(addsOnly(before, missed, selected, "em"), false);
  // Delimiters left as text: the units differ.
  assert.equal(
    addsOnly(before, [...meant, { key: "*", formats: [] }], selected, "em"),
    false,
  );
  assert.equal(
    addsOnly(
      before,
      meant.map((unit, i) => (i === 4 ? { ...unit, key: "*" } : unit)),
      selected,
      "em",
    ),
    false,
  );
});
