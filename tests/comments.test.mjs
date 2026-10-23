import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiStore } from "../desktop/ai-store.mjs";
import { createServer } from "../desktop/mcp-server.mjs";
import { createAiBridge } from "../desktop/ai-bridge.mjs";
import { anchorOf, locateAnchor, lineAt } from "../desktop/comment-anchors.mjs";

test("an anchor finds its passage again after edits elsewhere, and the right one of two", () => {
  const text = "Alpha beta.\n\nThe proof holds.\n\nAgain: the proof holds.\n";
  const second = text.lastIndexOf("the proof holds");
  const anchor = anchorOf(text, second, second + "the proof holds".length);
  assert.equal(anchor.quote, "the proof holds");
  const edited = "# New title\n\n" + text.replace("Alpha", "Gamma");
  const at = locateAnchor(edited, anchor);
  assert.equal(at.from, edited.lastIndexOf("the proof holds"));
  assert.equal(lineAt(edited, at.from), 7);
  // The first occurrence differs in case: only the second matches.
  assert.equal(locateAnchor(text, anchorOf(text, 13, 28)).from, 13);
  assert.equal(locateAnchor("gone", anchor), null);
  assert.equal(locateAnchor(text, { quote: "" }), null);
});

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-comments-"));
  const notes = path.join(root, "Notes");
  await fs.mkdir(notes);
  const plan = path.join(notes, "Plan.md");
  await fs.writeFile(plan, "# Plan\n\nSend it on Friday.\n\nAsk Ana.\n");
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
  // The app's side, as the page would use it (file ids are the paths here).
  const bridge = createAiBridge({
    store,
    openFile: async (p) => ({ path: p }),
    pathOf: (id) => id,
    notify: () => {},
    executable: "x",
    script: "y",
  });
  return { root, plan: await fs.realpath(plan), store, call, bridge };
}

test("comments go both ways: the owner asks, the AI answers and resolves", async () => {
  const { plan, call, bridge } = await setup();
  const text = await fs.readFile(plan, "utf8");
  const at = text.indexOf("on Friday");
  // The owner comments in the app.
  let threads = await bridge.handlers.changeComment(plan, "add", {
    ...anchorOf(text, at, at + "on Friday".length),
    text: "Can this be earlier?",
  });
  assert.equal(threads.length, 1);
  const id = threads[0].id;
  // The AI sees it waiting for an answer, placed by line.
  const listed = await call("list_comments");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].comment_id, id);
  assert.equal(listed[0].note, "Notes/Plan.md");
  assert.equal(listed[0].quote, "on Friday");
  assert.equal(listed[0].line, 3);
  assert.equal(listed[0].needs_reply, true);
  assert.deepEqual(
    listed[0].messages.map((m) => m.from),
    ["owner"],
  );
  // It answers and settles it.
  const reply = await call("reply_comment", {
    id,
    text: "Thursday works; I proposed the edit.",
  });
  assert.equal(reply.needs_reply, false);
  assert.deepEqual(
    reply.messages.map((m) => m.from),
    ["owner", "claude-code"],
  );
  assert.equal((await call("resolve_comment", { id })).resolved, true);
  assert.deepEqual(await call("list_comments"), []);
  assert.equal(
    (await call("list_comments", { include_resolved: true }))[0].resolved,
    true,
  );
  // The owner's answer reopens it; the note itself never changed.
  threads = await bridge.handlers.changeComment(plan, "reply", {
    id,
    text: "Thanks!",
  });
  assert.equal(threads[0].resolved, false);
  assert.equal((await call("list_comments"))[0].needs_reply, true);
  assert.equal(await fs.readFile(plan, "utf8"), text);
  threads = await bridge.handlers.changeComment(plan, "remove", { id });
  assert.deepEqual(threads, []);
});

test("the AI comments on a passage it quotes exactly once", async () => {
  const { plan, call, bridge } = await setup();
  const made = await call("add_comment", {
    note: "Notes/Plan.md",
    quote: "Ask Ana.",
    text: "Who is Ana?",
  });
  assert.equal(made.started_by, "claude-code");
  assert.equal(made.line, 5);
  assert.equal(made.needs_reply, false);
  const threads = await bridge.handlers.comments(plan);
  assert.equal(threads[0].prefix, "# Plan\n\nSend it on Friday.\n\n");
  assert.equal(threads[0].by, "claude-code");
  assert.match(
    (
      await call("add_comment", {
        note: "Notes/Plan.md",
        quote: "\n\n",
        text: "x",
      })
    ).error,
    /occurs 2 times/,
  );
  assert.match(
    (
      await call("add_comment", {
        note: "Notes/Plan.md",
        quote: "Bob",
        text: "x",
      })
    ).error,
    /not in the note/,
  );
  assert.match(
    (await call("reply_comment", { id: "zzzzzz-000000", text: "x" })).error,
    /no comment/,
  );
  // A passage that is gone stays listed, without a line.
  await fs.writeFile(plan, "# Plan\n\nSend it on Friday.\n");
  const [lost] = await call("list_comments");
  assert.equal(lost.anchor, "lost");
});

test("comments on a note closed to AI stay out of its reach", async () => {
  const { plan, call, bridge, store } = await setup();
  const text = await fs.readFile(plan, "utf8");
  const [thread] = await bridge.handlers.changeComment(plan, "add", {
    ...anchorOf(text, 0, 6),
    text: "Private remark",
  });
  await store.writeAccess({ libraries: [], excluded: [] });
  assert.deepEqual(await call("list_comments"), []);
  assert.match(
    (await call("reply_comment", { id: thread.id, text: "x" })).error,
    /not opened any library/,
  );
});

test("concurrent writers keep every thread", async () => {
  const { plan, store } = await setup();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.changeComments(plan, (doc) => {
        doc.threads.push({ id: `t${i}`, quote: "x", messages: [] });
      }),
    ),
  );
  assert.equal((await store.commentsOf(plan)).threads.length, 12);
  const left = await fs.readdir(store.comments);
  assert.deepEqual(
    left.filter((name) => !name.endsWith(".json")),
    [],
  );
});
