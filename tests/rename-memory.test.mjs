import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRenameMemory } from "../desktop/rename-memory.mjs";

// A clock and a disk the test controls.
function setup() {
  let now = 1000;
  const there = new Set();
  const memory = createRenameMemory({
    now: () => now,
    exists: async (p) => there.has(path.resolve(p).toLowerCase()),
  });
  const kb = path.resolve("kb");
  const at = (...parts) => path.join(kb, ...parts);
  const gone = (p) => {
    there.delete(p.toLowerCase());
    return memory.observe(p);
  };
  const come = (p) => {
    there.add(p.toLowerCase());
    return memory.observe(p);
  };
  return { memory, at, gone, come, tick: (ms) => (now += ms) };
}

test("an entry gone and one come in the same folder pair as a rename", async () => {
  const { memory, at, gone, come } = setup();
  await gone(at("Plan.md"));
  await come(at("Roadmap.md"));
  assert.equal(memory.lookup(at("Plan.md")), at("Roadmap.md"));
  assert.equal(memory.lookup(at("plan.MD")), at("Roadmap.md"));
  assert.equal(memory.lookup(at("Other.md")), null);
});

test("the same name in another folder pairs as a move; a folder carries its notes", async () => {
  const { memory, at, gone, come, tick } = setup();
  await come(at("Archive", "Plan.md"));
  tick(500);
  await gone(at("Topics", "Plan.md"));
  assert.equal(
    memory.lookup(at("Topics", "Plan.md")),
    at("Archive", "Plan.md"),
  );
  await gone(at("Topics"));
  await come(at("Subjects"));
  assert.equal(
    memory.lookup(at("Topics", "Deep", "T.md")),
    at("Subjects", "Deep", "T.md"),
  );
});

test("nothing is paired when it is unsure: too far apart, or two could match", async () => {
  const { memory, at, gone, come, tick } = setup();
  await gone(at("A.md"));
  tick(5000);
  await come(at("B.md"));
  assert.equal(memory.lookup(at("A.md")), null);
  tick(5000);
  // Two gone, one come in the same folder: which one was renamed?
  await gone(at("C.md"));
  await gone(at("D.md"));
  await come(at("E.md"));
  assert.equal(memory.lookup(at("C.md")), null);
  assert.equal(memory.lookup(at("D.md")), null);
  // Another kind of file does not pair with a note.
  tick(5000);
  await gone(at("F.md"));
  await come(at("F.txt"));
  assert.equal(memory.lookup(at("F.md")), null);
});

test("Marklore's own moves are remembered, renames are followed through, and old ones forgotten", async () => {
  const { memory, at, tick } = setup();
  memory.record([[at("A.md"), at("B.md")]]);
  tick(10);
  memory.record([[at("B.md"), at("Sub", "C.md")]]);
  assert.equal(memory.lookup(at("A.md")), at("Sub", "C.md"));
  tick(2 * 60 * 60e3);
  assert.equal(memory.lookup(at("A.md")), null);
});
