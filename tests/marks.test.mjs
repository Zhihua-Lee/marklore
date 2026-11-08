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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-marks-"));
  const notes = path.join(root, "Notes");
  await fs.mkdir(notes);
  const plan = path.join(notes, "Plan.md"),
    ideas = path.join(notes, "Ideas.md");
  await fs.writeFile(plan, "# Plan\n\nSend it on Friday.\n\nAsk Ana.\n");
  await fs.writeFile(ideas, "# Ideas\n\nA reading list.\n");
  const store = createAiStore(path.join(root, "data", "ai"));
  await store.writeAccess({ libraries: [{ path: notes }], excluded: [] });
  const project = path.join(root, "project");
  const servers = [];
  // An assistant session: its server, started as the assistant would.
  async function session(client = "claude-code", cwd = project) {
    const messages = [];
    const server = createServer({
      store,
      version: "1",
      write: (m) => messages.push(m),
      channel: { cwd },
    });
    servers.push(server);
    const send = (message) =>
      server.receive(JSON.stringify({ jsonrpc: "2.0", ...message }));
    await send({
      id: 0,
      method: "initialize",
      params: { clientInfo: { name: client } },
    });
    await send({ method: "notifications/initialized" });
    let next = 1;
    const call = async (name, args = {}) => {
      const id = next++;
      await send({
        id,
        method: "tools/call",
        params: { name, arguments: args },
      });
      const { result } = messages.find((m) => m.id === id);
      return result.isError
        ? { error: result.content[0].text }
        : JSON.parse(result.content[0].text);
    };
    // Events pushed into the session so far.
    const events = () =>
      messages
        .filter((m) => m.method === "notifications/claude/channel")
        .map((m) => m.params);
    return {
      server,
      call,
      events,
      messages,
      check: () => server.channel().check(),
    };
  }
  // The app's side, as the page uses it (file ids are the paths here).
  const bridge = createAiBridge({
    store,
    openFile: async (p) => ({ path: p }),
    pathOf: (id) => id,
    notify: () => {},
    executable: "x",
    script: "y",
  });
  const mark = async (file, quote, words) => {
    const text = await fs.readFile(file, "utf8");
    const at = text.indexOf(quote);
    return bridge.handlers.changeMark("add", {
      fileId: file,
      ...anchorOf(text, at, at + quote.length),
      text: words,
    });
  };
  const done = () => Promise.all(servers.map((s) => s.stop()));
  return {
    root,
    project,
    plan: await fs.realpath(plan),
    ideas: await fs.realpath(ideas),
    store,
    bridge,
    session,
    mark,
    done,
  };
}

test("marks wait until sent; the session they go to hears at once, reads, answers, and the owner finishes", async (t) => {
  const { plan, ideas, project, bridge, session, mark, done } = await setup();
  t.after(done);
  const claude = await session();
  // The app lists the running session, with where it runs.
  let state = await bridge.handlers.marks();
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].client, "claude-code");
  assert.equal(state.sessions[0].cwd, project);
  assert.equal(state.sessions[0].push, true);
  // Marks on two notes: kept, not sent.
  await mark(plan, "on Friday", "Can this be earlier?");
  state = await mark(
    ideas,
    "A reading list.",
    "Add the two books from Monday.",
  );
  assert.equal(state.marks.length, 2);
  assert.ok(state.marks.every((m) => m.batch === null));
  assert.deepEqual(await claude.call("get_marks"), []);
  await claude.check();
  assert.deepEqual(claude.events(), []);
  // A mark not sent can still change, or go.
  state = await mark(plan, "Ask Ana.", "Who?");
  const extra = state.marks.find((m) => m.text === "Who?");
  state = await bridge.handlers.changeMark("edit", {
    id: extra.id,
    text: "Who is Ana?",
  });
  assert.ok(state.marks.some((m) => m.text === "Who is Ana?"));
  state = await bridge.handlers.changeMark("remove", { id: extra.id });
  assert.equal(state.marks.length, 2);
  // Sent together, to that session.
  state = await bridge.handlers.sendMarks({
    client: "claude-code",
    cwd: project,
    session: state.sessions[0].id,
  });
  assert.equal(state.batches.length, 1);
  const batch = state.batches[0];
  assert.equal(batch.status, "sent");
  assert.ok(state.marks.every((m) => m.batch === batch.id));
  await assert.rejects(
    bridge.handlers.changeMark("edit", { id: state.marks[0].id, text: "x" }),
    /已发送/,
  );
  await assert.rejects(bridge.handlers.sendMarks(batch.target), /没有要发送/);
  // The session hears, once.
  await claude.check();
  await claude.check();
  assert.equal(claude.events().length, 1);
  assert.equal(claude.events()[0].meta.event, "marks");
  assert.equal(claude.events()[0].meta.batch_id, batch.id);
  assert.match(claude.events()[0].content, /2 marks on 2 notes/);
  assert.doesNotMatch(claude.events()[0].content, /Friday/);
  // It reads them, placed in the notes; the app sees it read.
  const [read] = await claude.call("get_marks", { batch_id: batch.id });
  assert.deepEqual(
    read.marks.map((m) => [m.n, m.note, m.quote, m.line, m.text]),
    [
      [1, "Notes/Plan.md", "on Friday", 3, "Can this be earlier?"],
      [
        2,
        "Notes/Ideas.md",
        "A reading list.",
        3,
        "Add the two books from Monday.",
      ],
    ],
  );
  state = await bridge.handlers.marks();
  assert.equal(state.batches[0].status, "read");
  assert.equal(state.batches[0].readBy, "claude-code");
  // One answer for the batch.
  const answered = await claude.call("reply_marks", {
    batch_id: batch.id,
    text: "1: proposed Thursday. 2: which books?",
  });
  assert.equal(answered.status, "replied");
  state = await bridge.handlers.marks();
  assert.equal(
    state.batches[0].replies[0].text,
    "1: proposed Thursday. 2: which books?",
  );
  assert.equal(state.batches[0].replies[0].by, "claude-code");
  // Finished: the marks leave the notes, the batch the lists.
  state = await bridge.handlers.finishBatch(batch.id);
  assert.deepEqual(state.marks, []);
  assert.deepEqual(state.batches, []);
  assert.deepEqual(await claude.call("get_marks"), []);
  assert.equal(
    (await claude.call("get_marks", { batch_id: batch.id })).at(0).status,
    "finished",
  );
  assert.match(
    (await claude.call("reply_marks", { batch_id: batch.id, text: "x" })).error,
    /finished/,
  );
  assert.match(
    (await claude.call("get_marks", { batch_id: "zzzzzz-000000" })).error,
    /no batch/,
  );
});

test("a finished review tells the session that proposed it, with the owner's reasons", async (t) => {
  const { bridge, session, done } = await setup();
  t.after(done);
  const claude = await session();
  const other = await session("claude-code", "elsewhere");
  const made = await claude.call("propose_edit", {
    note: "Notes/Plan.md",
    summary: "Earlier, and who Ana is",
    edits: [
      { old_text: "on Friday", new_text: "on Thursday" },
      { old_text: "Ask Ana.", new_text: "Ask Ana Lee." },
    ],
  });
  await claude.check();
  assert.deepEqual(claude.events(), []);
  await bridge.handlers.decideProposal(made.proposal_id, {
    results: ["accepted", "rejected"],
    saved: true,
    reasons: [null, "  Her name stays short.  "],
    note: "Thanks",
  });
  await claude.check();
  await other.check();
  assert.deepEqual(other.events(), []);
  const [event] = claude.events();
  assert.equal(event.meta.event, "proposal");
  assert.equal(event.meta.proposal_id, made.proposal_id);
  assert.match(event.content, /accepted edit 1; rejected edit 2/);
  assert.match(
    event.content,
    /Why edit 2 was rejected: "Her name stays short\."/,
  );
  assert.match(event.content, /The owner's note: "Thanks"/);
  assert.match(event.content, /saved/);
  const got = await claude.call("get_proposal", { id: made.proposal_id });
  assert.deepEqual(got.edit_results, ["accepted", "rejected"]);
  assert.deepEqual(got.edit_reasons, [null, "Her name stays short."]);
  assert.equal(got.owner_note, "Thanks");
  // Nothing more to tell.
  await claude.check();
  assert.equal(claude.events().length, 1);
});

test("only Claude Code is pushed to; marks sent to a session that ended go to the next one in its folder", async (t) => {
  const { plan, project, bridge, session, mark, done } = await setup();
  t.after(done);
  const codex = await session("codex-mcp-client");
  const init = codex.messages.find((m) => m.id === 0).result;
  assert.equal(init.capabilities.experimental, undefined);
  const claude = await session();
  assert.deepEqual(
    claude.messages.find((m) => m.id === 0).result.capabilities.experimental,
    { "claude/channel": {} },
  );
  let state = await bridge.handlers.marks();
  assert.deepEqual(state.sessions.map((s) => [s.client, s.push]).sort(), [
    ["claude-code", true],
    ["codex-mcp-client", false],
  ]);
  // Sent to Codex: nothing pushed anywhere; Codex reads them when asked.
  await mark(plan, "on Friday", "Earlier?");
  await bridge.handlers.sendMarks({
    client: "codex-mcp-client",
    cwd: project,
    session: state.sessions.find((s) => s.client === "codex-mcp-client").id,
  });
  await codex.check();
  await claude.check();
  assert.deepEqual([...codex.events(), ...claude.events()], []);
  assert.equal((await codex.call("get_marks")).length, 1);
  // Sent to a Claude Code session that has ended: the next one started in
  // that folder hears it when it starts.
  await mark(plan, "Ask Ana.", "Who?");
  const gone = claude.server.channel().id;
  await claude.server.stop();
  state = await bridge.handlers.sendMarks({
    client: "claude-code",
    cwd: project,
    session: gone,
  });
  assert.ok(!state.sessions.some((s) => s.id === gone));
  const elsewhere = await session(
    "claude-code",
    path.join(project, "..", "other"),
  );
  const later = await session();
  await elsewhere.check();
  await later.check();
  assert.deepEqual(elsewhere.events(), []);
  assert.equal(later.events().length, 1);
  assert.equal(later.events()[0].meta.event, "marks");
});

test("marks on a note closed to AI show the AI only the owner's words", async (t) => {
  const { plan, project, store, bridge, session, mark, done } = await setup();
  t.after(done);
  const claude = await session();
  await mark(plan, "on Friday", "Earlier?");
  await bridge.handlers.sendMarks({
    client: "claude-code",
    cwd: project,
    session: null,
  });
  await store.writeAccess({ libraries: [], excluded: [] });
  const [batch] = await claude.call("get_marks");
  assert.deepEqual(batch.marks, [
    {
      n: 1,
      unavailable: "This note is not in a library open to AI.",
      text: "Earlier?",
    },
  ]);
});

test("open comments of earlier versions become marks not sent, once", async (t) => {
  const { plan, store, bridge, done } = await setup();
  t.after(done);
  const comments = path.join(store.folder, "comments");
  await fs.mkdir(comments, { recursive: true });
  const thread = (id, by, resolved, texts) => ({
    id,
    quote: "on Friday",
    prefix: "Send it ",
    suffix: ".",
    by,
    created: "2026-10-30T10:00:00.000Z",
    resolved,
    messages: texts.map(([who, text]) => ({ by: who, text, at: "x" })),
  });
  await fs.writeFile(
    path.join(comments, "0123456789abcdef.json"),
    JSON.stringify({
      file: plan,
      threads: [
        thread("aaaaaaa-111111", "owner", false, [
          ["owner", "Earlier?"],
          ["claude-code", "Thursday?"],
          ["owner", "Yes"],
        ]),
        thread("bbbbbbb-222222", "owner", true, [["owner", "Done one"]]),
        thread("ccccccc-333333", "claude-code", false, [["claude-code", "Q"]]),
      ],
    }),
  );
  assert.equal(await store.carryComments(), 1);
  assert.equal(await store.carryComments(), 0);
  const { marks } = await bridge.handlers.marks();
  assert.deepEqual(
    marks.map((m) => [m.id, m.text, m.batch]),
    [["aaaaaaa-111111", "Earlier?\n\nYes", null]],
  );
});

test("concurrent writers keep every mark", async (t) => {
  const { plan, store, done } = await setup();
  t.after(done);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.changeMarks(plan, (doc) => {
        doc.marks.push({ id: `m${i}`, quote: "x", text: "y", batch: null });
      }),
    ),
  );
  assert.equal((await store.marksOf(plan)).marks.length, 12);
  const left = await fs.readdir(store.marks);
  assert.deepEqual(
    left.filter((name) => !name.endsWith(".json")),
    [],
  );
});
