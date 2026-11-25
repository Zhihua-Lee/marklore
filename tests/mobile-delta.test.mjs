import test from "node:test";
import assert from "node:assert/strict";
import { applyDelta, filePaths, planSync, kindOf } from "../mobile/delta.js";

const root = "R";
const page1 = [
  { id: "R", name: "数学笔记", folder: {} },
  { id: "F1", name: "第一章 实数", folder: {}, parentReference: { id: "R" } },
  {
    id: "N1",
    name: "一致收敛.md",
    file: {},
    size: 10,
    cTag: "a1",
    parentReference: { id: "R" },
  },
  {
    id: "N2",
    name: "确界原理.md",
    file: {},
    size: 10,
    cTag: "b1",
    parentReference: { id: "F1" },
  },
  {
    id: "I1",
    name: "curve.png",
    file: {},
    size: 99,
    cTag: "c1",
    parentReference: { id: "F1" },
  },
  {
    id: "X1",
    name: "slides.pptx",
    file: {},
    size: 5,
    cTag: "d1",
    parentReference: { id: "R" },
  },
];

test("kinds: notes and images; other files and oversized images are ignored", () => {
  assert.equal(kindOf("a.md"), "note");
  assert.equal(kindOf("a.MARKDOWN"), "note");
  assert.equal(kindOf("a.JPG", 10), "image");
  assert.equal(kindOf("a.png", 30 * 1024 * 1024), null);
  assert.equal(kindOf("a.pdf"), null);
});

test("paths are derived from parents up to the chosen folder", () => {
  const items = applyDelta(new Map(), page1, root);
  assert.deepEqual([...filePaths(items, root)].sort(), [
    ["I1", "第一章 实数/curve.png"],
    ["N1", "一致收敛.md"],
    ["N2", "第一章 实数/确界原理.md"],
  ]);
});

test("first sync downloads everything relevant", () => {
  const items = applyDelta(new Map(), page1, root);
  const plan = planSync(items, root, new Map());
  assert.deepEqual(plan.download.map((d) => d.id).sort(), ["I1", "N1", "N2"]);
  assert.equal(plan.move.length + plan.remove.length, 0);
});

test("a renamed folder moves its files without downloading them", () => {
  const items = applyDelta(new Map(), page1, root);
  const stored = new Map(
    [...filePaths(items, root)].map(([id, path]) => [
      id,
      { path, tag: items.get(id).tag },
    ]),
  );
  applyDelta(
    items,
    [{ id: "F1", name: "第一章", folder: {}, parentReference: { id: "R" } }],
    root,
  );
  const plan = planSync(items, root, stored);
  assert.equal(plan.download.length, 0);
  assert.deepEqual(
    plan.move.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "I1", from: "第一章 实数/curve.png", to: "第一章/curve.png" },
      { id: "N2", from: "第一章 实数/确界原理.md", to: "第一章/确界原理.md" },
    ],
  );
});

test("edits download again; deletions and moves out of the folder remove", () => {
  const items = applyDelta(new Map(), page1, root);
  const stored = new Map(
    [...filePaths(items, root)].map(([id, path]) => [
      id,
      { path, tag: items.get(id).tag },
    ]),
  );
  applyDelta(
    items,
    [
      {
        id: "N1",
        name: "一致收敛.md",
        file: {},
        size: 12,
        cTag: "a2",
        parentReference: { id: "R" },
      },
      { id: "I1", deleted: {} },
      {
        id: "N2",
        name: "确界原理.md",
        file: {},
        size: 10,
        cTag: "b1",
        parentReference: { id: "ELSEWHERE" },
      },
    ],
    root,
  );
  const plan = planSync(items, root, stored);
  assert.deepEqual(
    plan.download.map((d) => [d.id, d.path]),
    [["N1", "一致收敛.md"]],
  );
  assert.deepEqual(plan.remove.map((r) => r.id).sort(), ["I1", "N2"]);
});

test("a file renamed to a non-note extension is dropped", () => {
  const items = applyDelta(new Map(), page1, root);
  applyDelta(
    items,
    [
      {
        id: "N1",
        name: "一致收敛.txt",
        file: {},
        size: 10,
        cTag: "a1",
        parentReference: { id: "R" },
      },
    ],
    root,
  );
  assert.equal(items.has("N1"), false);
});
