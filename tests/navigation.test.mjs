import test from "node:test";
import assert from "node:assert/strict";
import { createNavigationHistory } from "../src/navigation-history.js";
import {
  normalizeGroups,
  moveGroupedTab,
  moveGroup,
  insertDerivedTab,
  dropTarget,
} from "../src/tab-groups.js";
const at = (id, from = 0) => ({ id, anchor: { from, y: 32 } });

test("derived tabs inherit only a live opener group and stay adjacent", () => {
  const groups = [{ id: "research" }, { id: "other" }];
  const tabs = [
    { id: "a", groupId: "research" },
    { id: "b", groupId: "research" },
    { id: "c", groupId: "other" },
  ];
  const opener = { ...tabs[0] };
  insertDerivedTab(tabs, groups, { id: "child" }, opener);
  insertDerivedTab(tabs, groups, { id: "grandchild" }, tabs[1]);
  assert.deepEqual(
    tabs.map((t) => t.id),
    ["a", "child", "grandchild", "b", "c"],
  );
  assert.equal(tabs[2].groupId, "research");
  tabs.shift(); // A slow open may complete after its parent closes.
  insertDerivedTab(tabs, groups, { id: "late" }, opener);
  assert.equal(tabs.at(-2).id, "late");
  assert.equal(tabs.at(-2).groupId, "research");
  groups.shift(); // Removed groups must not be resurrected by a pending open.
  insertDerivedTab(tabs, groups, { id: "orphan" }, opener);
  insertDerivedTab(tabs, groups, { id: "external" });
  assert.equal(tabs.at(-2).groupId, null);
  assert.equal(tabs.at(-1).groupId, null);
});

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

test("a dragged tab lands in a group between or over its tabs, and keeps its group in a gap", () => {
  // Strip: x [0,28] | pill G [32,72] | a [76,104] | (gap) b [116,144] | y [150,178]
  // The dragged tab (a member of G) left a gap at [104,116].
  const items = [
    { id: "x", groupId: null, left: 0, right: 28 },
    { header: true, groupId: "G", first: "a", left: 32, right: 72 },
    { id: "a", groupId: "G", left: 76, right: 104 },
    { id: "b", groupId: "G", left: 116, right: 144 },
    { id: "y", groupId: null, left: 150, right: 178 },
  ];
  const drop = (x, own = null) => {
    const { beforeId, into } = dropTarget(items, x, own);
    return { beforeId, into };
  };
  // Over the pill: to the end of the group.
  assert.deepEqual(drop(50), { beforeId: undefined, into: "G" });
  // Between two tabs of the group, also in the gap its own place left.
  assert.deepEqual(drop(95), { beforeId: "b", into: "G" });
  assert.deepEqual(drop(110, "G"), { beforeId: "b", into: "G" });
  assert.deepEqual(drop(110), { beforeId: "b", into: "G" });
  // Over the right half of the last tab: still in the group, at its end.
  assert.deepEqual(drop(140), { beforeId: "y", into: "G" });
  // Over a tab after the group: out of it.
  assert.deepEqual(drop(155, "G"), { beforeId: "y", into: null });
  // In the gap at the group's end: a member stays, others stay out.
  assert.deepEqual(drop(146, "G"), { beforeId: "y", into: "G" });
  assert.deepEqual(drop(146), { beforeId: "y", into: null });
  // Before the pill: before the whole group.
  assert.deepEqual(drop(30), { beforeId: "a", into: null });
  // Past the end.
  assert.deepEqual(drop(400, "G"), { beforeId: undefined, into: null });
  // Next to a folded group's pill, a tab does not join it unless dropped on it.
  const folded = [
    {
      header: true,
      groupId: "F",
      collapsed: true,
      first: "f",
      left: 0,
      right: 40,
    },
    { id: "z", groupId: null, left: 44, right: 72 },
  ];
  assert.deepEqual(
    (({ beforeId, into }) => ({ beforeId, into }))(dropTarget(folded, 42)),
    { beforeId: "z", into: null },
  );
  // A drop before a folded group goes before its (hidden) first tab.
  assert.equal(dropTarget(folded, -5).beforeId, "f");
});
