import test from "node:test";
import assert from "node:assert/strict";
import { scrollSpeed } from "../src/drag-autoscroll.js";

test("a drag near a list's edge scrolls it, faster nearer and past the edge", () => {
  // A list from y=100 to y=700.
  assert.equal(scrollSpeed(400, 100, 700), 0);
  assert.equal(scrollSpeed(160, 100, 700), 0);
  const slow = scrollSpeed(140, 100, 700);
  const fast = scrollSpeed(102, 100, 700);
  assert.ok(slow < 0 && fast < slow, "up, faster at the edge");
  assert.ok(scrollSpeed(60, 100, 700) <= fast, "past the edge: fastest");
  assert.equal(scrollSpeed(-500, 100, 700), scrollSpeed(60, 100, 700));
  assert.ok(scrollSpeed(690, 100, 700) > scrollSpeed(660, 100, 700));
  assert.ok(scrollSpeed(900, 100, 700) > 0);
  // A short list keeps a middle where nothing scrolls.
  assert.equal(scrollSpeed(130, 100, 160), 0);
});

test("the edge and the top speed can be chosen", () => {
  assert.equal(scrollSpeed(170, 100, 700, 80), -2);
  assert.equal(scrollSpeed(170, 100, 700), 0);
  assert.equal(scrollSpeed(100, 100, 700, 48, 10), -10);
  assert.equal(scrollSpeed(900, 100, 700, 48, 10), 10);
});
