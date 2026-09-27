import test from "node:test";
import assert from "node:assert/strict";
import { createNavigationHistory } from "../src/navigation-history.js";
import {
  normalizeGroups,
  moveGroupedTab,
  moveGroup,
} from "../src/tab-groups.js";
const at = (id, from = 0) => ({ id, anchor: { from, y: 32 } });

test("reading history captures departure position, forwards and branches without document copies", () => {
  const h = createNavigationHistory();
  h.visit(at("a"));
  h.visit(at("b", 20), at("a", 8));
  h.visit(at("c", 30), at("b", 25));
  assert.deepEqual(h.go(-1, at("c", 35)), at("b", 25));
  assert.deepEqual(h.go(-1, at("b", 25)), at("a", 8));
  assert.deepEqual(h.go(1, at("a", 8)), at("b", 25));
  h.visit(at("d"), at("b", 28));
  assert.equal(h.can(1), false);
  assert.deepEqual(h.go(-1, at("d")), at("b", 28));
});
test("current-note history skips other notes; closed notes are removed; edits remap locations", () => {
  const h = createNavigationHistory();
  h.visit(at("a", 10));
  h.visit(at("b", 20));
  h.visit(at("a", 30));
  assert.deepEqual(h.go(-1, at("a", 30), true), at("a", 10));
  assert.deepEqual(h.go(1, at("a", 10), true), at("a", 30));
  h.remove("b");
  h.map("a", { length: 100, mapPos: (p) => p + 5 });
  assert.deepEqual(h.go(-1, at("a", 35)), at("a", 15));
  h.remove("a");
  assert.equal(h.can(1), false);
  assert.equal(h.can(-1), false);
});
test("history is bounded and identical destinations do not create extra stops", () => {
  const h = createNavigationHistory(3);
  for (let i = 0; i < 10; i++) {
    h.visit(at(String(i)));
    h.visit(at(String(i)));
  }
  assert.deepEqual(h.go(-1, at("9")), at("8"));
  assert.deepEqual(h.go(-1, at("8")), at("7"));
  assert.equal(h.go(-1, at("7")), null);
});
test("groups normalize restored input, preserve contiguity and move whole groups", () => {
  const tabs = [
    { id: "a", groupId: "x" },
    { id: "b" },
    { id: "c", groupId: "x" },
    { id: "d", groupId: "missing" },
  ];
  const groups = [
    { id: "x", name: " Study ", color: "invalid", collapsed: true },
    { id: "empty", name: "Empty" },
    { id: "x", name: "Duplicate" },
  ];
  normalizeGroups(tabs, groups);
  assert.deepEqual(
    tabs.map((t) => t.id),
    ["a", "c", "b", "d"],
  );
  assert.deepEqual(groups, [
    { id: "x", name: "Study", color: "green", collapsed: true },
  ]);
  moveGroupedTab(tabs, "b", undefined, "x");
  assert.deepEqual(
    tabs.map((t) => t.id),
    ["a", "c", "b", "d"],
  );
  moveGroup(tabs, "x", undefined);
  assert.deepEqual(
    tabs.map((t) => t.id),
    ["d", "a", "c", "b"],
  );
  moveGroupedTab(tabs, "c", "d", null);
  normalizeGroups(tabs, groups);
  assert.deepEqual(
    tabs.map((t) => t.id),
    ["c", "d", "a", "b"],
  );
  assert.equal(tabs[0].groupId, null);
});
