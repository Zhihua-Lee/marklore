import test from "node:test";
import assert from "node:assert/strict";
import { readingWeight } from "../src/typography.js";

test("automatic reading weights preserve small glyphs and fixed choices", () => {
  for (const [zoom, expected] of [
    [50, 400],
    [60, 400],
    [70, 400],
    [90, 400],
    [100, 400],
    [200, 400],
  ]) {
    assert.equal(readingWeight({ weight: "auto", zoom }), expected);
    for (const weight of [400, 450, 500, 600]) {
      assert.equal(readingWeight({ weight, zoom }), weight);
    }
  }
});
