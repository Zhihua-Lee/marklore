import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiStore } from "../desktop/ai-store.mjs";
import { createServer } from "../desktop/mcp-server.mjs";
import { createAiBridge } from "../desktop/ai-bridge.mjs";
import {
  locateEdits,
  applyChanges,
  revisions,
  words,
  sourceHunks,
} from "../desktop/proposal-edits.mjs";

// The owner decides an edit proposal edit by edit (src/proposals.js): each
// decision is kept, and the proposal is decided when no edit waits.
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-decide-"));
  const notes = path.join(root, "Notes");
  await fs.mkdir(notes);
  const plan = path.join(notes, "Plan.md");
  await fs.writeFile(
    plan,
    "# Plan\n\nWrite the draft.\n\nSend it on Friday.\n",
  );
  const store = createAiStore(path.join(root, "data", "ai"));
  await store.writeAccess({ libraries: [{ path: notes }], excluded: [] });
  const messages = [];
  const server = createServer({
    store,
    version: "1",
    write: (m) => messages.push(m),
  });
  await server.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { clientInfo: { name: "claude-code" } },
    }),
  );
  const call = async (name, args = {}) => {
    await server.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: messages.length + 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
    const { result } = messages.at(-1);
    return result.isError
      ? { error: result.content[0].text }
      : JSON.parse(result.content[0].text);
  };
  const bridge = createAiBridge({
    store,
    openFile: async (p) => ({ path: p }),
    pathOf: (id) => id,
    notify: () => {},
    executable: "x",
    script: "y",
  });
  return { call, bridge };
}

async function propose(call, edits) {
  const made = await call("propose_edit", {
    note: "Notes/Plan.md",
    summary: "Two changes",
    edits,
  });
  assert.ok(made.proposal_id, JSON.stringify(made));
  return made.proposal_id;
}
const two = [
  { old_text: "Write the draft.", new_text: "Write the first draft." },
  { old_text: "on Friday", new_text: "on Thursday" },
];

test("edits decided one by one: the proposal waits until the last, then counts as accepted", async () => {
  const { call, bridge } = await setup();
  const id = await propose(call, two);
  let shown = await bridge.handlers.decideProposal(id, {
    status: "rejected",
    edit: 1,
  });
  assert.deepEqual(shown.results, ["pending", "rejected"]);
  assert.equal((await bridge.handlers.proposals()).length, 1);
  let seen = await call("get_proposal", { id });
  assert.equal(seen.status, "pending");
  assert.deepEqual(seen.edit_results, ["pending", "rejected"]);
  // The same edit cannot be decided twice.
  await assert.rejects(
    bridge.handlers.decideProposal(id, { status: "accepted", edit: 1 }),
  );
  await bridge.handlers.decideProposal(id, {
    status: "accepted",
    edit: 0,
    saved: true,
  });
  assert.deepEqual(await bridge.handlers.proposals(), []);
  seen = await call("get_proposal", { id });
  assert.equal(seen.status, "accepted");
  assert.equal(seen.saved, true);
  assert.deepEqual(seen.edit_results, ["accepted", "rejected"]);
});

test("rejecting the rest after accepting one keeps the proposal accepted; unsaved stays unsaved", async () => {
  const { call, bridge } = await setup();
  const id = await propose(call, two);
  await bridge.handlers.decideProposal(id, {
    status: "accepted",
    edit: 0,
    saved: false,
  });
  await bridge.handlers.decideProposal(id, { status: "rejected" });
  const seen = await call("get_proposal", { id });
  assert.equal(seen.status, "accepted");
  assert.equal(seen.saved, false);
  assert.deepEqual(seen.edit_results, ["accepted", "rejected"]);
  // Nothing decided edit by edit: no edit_results.
  const other = await propose(call, two);
  await bridge.handlers.decideProposal(other, { status: "rejected" });
  const plain = await call("get_proposal", { id: other });
  assert.equal(plain.status, "rejected");
  assert.equal(plain.edit_results, undefined);
});

test("each change's pieces pair the removed words with the words put in their place", () => {
  const note =
    "Matrix A is invertible when its rank is below n.\n\n秩小于 n。\n";
  const { changes, order } = locateEdits(note, [
    { old_text: "秩小于 n", new_text: "秩等于 n" },
    {
      old_text: "when its rank is below n",
      new_text: "when, as shown, its rank equals n",
    },
  ]);
  assert.deepEqual(order, [1, 0]);
  const after = applyChanges(note, changes);
  const pairs = revisions(note, changes).map((r) =>
    r.pieces.map((p) => [
      note.slice(p.oldFrom, p.oldTo),
      after.slice(p.from, p.to),
    ]),
  );
  assert.deepEqual(pairs, [
    [
      ["", ", as shown,"],
      ["is below", "equals"],
    ],
    [["小", "等"]],
  ]);
  assert.deepEqual(words("ab 中文, x1"), [
    "ab",
    " ",
    "中",
    "文",
    ",",
    " ",
    "x1",
  ]);
});

test("a changed word is shown whole, not cut where it matches", () => {
  const note = "Send it on Friday.\n";
  const { changes } = locateEdits(note, [
    { old_text: "on Friday", new_text: "on Thursday" },
  ]);
  const after = applyChanges(note, changes);
  const pairs = revisions(note, changes).map((r) =>
    r.pieces.map((p) => [
      note.slice(p.oldFrom, p.oldTo),
      after.slice(p.from, p.to),
    ]),
  );
  assert.deepEqual(pairs, [[["Friday", "Thursday"]]]);
});

// A review finished in Marklore (src/proposals.js): every decision in one
// answer, edits decided earlier keeping theirs.
test("a finished review decides every edit at once", async () => {
  const { call, bridge } = await setup();
  const id = await propose(call, two);
  await bridge.handlers.decideProposal(id, {
    results: ["rejected", "accepted"],
    saved: true,
  });
  let seen = await call("get_proposal", { id });
  assert.equal(seen.status, "accepted");
  assert.equal(seen.saved, true);
  assert.deepEqual(seen.edit_results, ["rejected", "accepted"]);
  // All rejected; and an edit decided before keeps its decision.
  const other = await propose(call, two);
  await bridge.handlers.decideProposal(other, {
    status: "accepted",
    edit: 1,
    saved: false,
  });
  await bridge.handlers.decideProposal(other, {
    results: ["rejected", "rejected"],
  });
  seen = await call("get_proposal", { id: other });
  assert.equal(seen.status, "accepted");
  assert.equal(seen.saved, false);
  assert.deepEqual(seen.edit_results, ["rejected", "accepted"]);
  const third = await propose(call, two);
  await assert.rejects(
    bridge.handlers.decideProposal(third, { results: ["accepted"] }),
  );
  await assert.rejects(
    bridge.handlers.decideProposal(third, { results: ["accepted", "maybe"] }),
  );
  await bridge.handlers.decideProposal(third, {
    results: ["rejected", "rejected"],
  });
  assert.equal((await call("get_proposal", { id: third })).status, "rejected");
});

// The source view's hunks: each change widened to whole lines on both
// sides, changes sharing a line in one hunk, lines numbered in both texts.
test("source hunks pair the changed lines of both texts", () => {
  const note = "# Plan\n\nWrite the draft.\n\nSend it on Friday.\nThen rest.\n";
  const edits = [
    { old_text: "draft", new_text: "first draft" },
    { old_text: "Send it on Friday.\n", new_text: "" },
    { old_text: "Then rest", new_text: "Then rest a while" },
  ];
  const { changes } = locateEdits(note, edits);
  const after = applyChanges(note, changes);
  const { hunks } = sourceHunks(note, after, revisions(note, changes));
  assert.deepEqual(
    hunks.map((h) => h.changes),
    [[0], [1, 2]],
  );
  assert.deepEqual(
    hunks[0].rows.map((r) => [r.kind, r.line, r.old, r.new]),
    [
      ["-", "Write the draft.", 3, null],
      ["+", "Write the first draft.", null, 3],
    ],
  );
  assert.deepEqual(
    hunks[1].rows.map((r) => [r.kind, r.line, r.old, r.new]),
    [
      ["-", "Send it on Friday.", 5, null],
      ["-", "Then rest.", 6, null],
      ["+", "Then rest a while.", null, 5],
    ],
  );
});
