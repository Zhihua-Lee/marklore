import { test } from "node:test";
import assert from "node:assert/strict";
import { numericCell, sortedIndices } from "../src/table-sort.js";
import { createBoundedCache } from "../src/bounded-cache.js";

test("strict numeric table values include currency, exponent, percentages and accounting", () => {
  for (const [input, expected] of [["10", 10], ["2", 2], ["−3", -3], ["$1,234.50", 1234.5], ["-$2", -2], ["(£20)", -20], ["3e2", 300], ["12%", 0.12], [" .5 ", 0.5]])
    assert.equal(numericCell(input), expected, input);
  for (const input of ["", " ", "1,2", "12px", "2/3", "2026-09-27", "Infinity", "1e999", "--1", "(-2)"])
    assert.equal(numericCell(input), null, input);
});
test("numeric sorting is stable and leaves empty cells last in both directions", () => {
  const values = ["10", "2", "", "2", "-5", " "];
  assert.deepEqual(sortedIndices(values), [4, 1, 3, 0, 2, 5]);
  assert.deepEqual(sortedIndices(values, "descending"), [0, 1, 3, 4, 2, 5]);
  assert.deepEqual(sortedIndices(values, "none"), [0, 1, 2, 3, 4, 5]);
});
test("text sorting is natural and case-insensitive, without partial-number parsing", () => {
  assert.deepEqual(sortedIndices(["item10", "item2", "Item2", ""]), [1, 2, 0, 3]);
  assert.deepEqual(sortedIndices(["20%", "2%", "0.1"]), [1, 2, 0]);
  assert.deepEqual(sortedIndices([]), []);
});
test("derived-string cache evicts least-recently-used entries", () => {
  const cache = createBoundedCache({ maxEntries: 2 });
  cache.set("a", "A"); cache.set("b", "B");
  assert.equal(cache.get("a"), "A");
  cache.set("c", "C");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "A");
  assert.equal(cache.get("c"), "C");
});
test("cache byte limits account for replacement and skip oversized results", () => {
  const cache = createBoundedCache({ maxBytes: 12 });
  cache.set("a", "123"); cache.set("a", "1"); cache.set("b", "123");
  assert.equal(cache.get("a"), "1");
  cache.set("x", "0123456789");
  assert.equal(cache.get("x"), undefined);
  assert.equal(cache.get("b"), "123");
  cache.set("c", "123");
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), "123");
});
