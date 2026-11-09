import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

async function setup({ claude = true } = {}) {
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
    executable: process.execPath,
    script: fileURLToPath(new URL("../desktop/mcp.mjs", import.meta.url)),
    // Claude Code played by a script (tests/fake-claude.mjs).
    runOptions: {
      findClaude: async () =>
        claude
          ? {
              command: process.execPath,
              args: [
                fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)),
              ],
              env: { ELECTRON_RUN_AS_NODE: "1" },
            }
          : null,
    },
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

const byText = (state, text) => state.marks.find((m) => m.text === text);

test("marks are read when asked; a proposal answering them shows, and accepting it takes them away", async (t) => {
  const { plan, ideas, bridge, session, mark, done } = await setup();
  t.after(done);
  const claude = await session();
  assert.deepEqual((await claude.call("get_marks")).marks, []);
  await mark(plan, "on Friday", "Can this be earlier?");
  await mark(plan, "Ask Ana.", "Who?");
  let state = await mark(ideas, "A reading list.", "Add two books.");
  assert.deepEqual(
    state.marks.map((m) => m.state),
    ["open", "open", "open"],
  );
  const earlier = byText(state, "Can this be earlier?"),
    who = byText(state, "Who?"),
    books = byText(state, "Add two books.");
  // The AI reads them all, placed in their notes.
  const { marks } = await claude.call("get_marks");
  assert.deepEqual(
    marks.find((m) => m.mark_id === earlier.id),
    {
      mark_id: earlier.id,
      note: "Notes/Plan.md",
      quote: "on Friday",
      line: 3,
      text: "Can this be earlier?",
      status: "open",
    },
  );
  assert.equal(
    (await claude.call("get_marks", { note: "Notes/Ideas.md" })).marks.length,
    1,
  );
  // A proposal names the marks it answers: only marks on its note.
  const stray = await claude.call("propose_edit", {
    note: "Notes/Plan.md",
    summary: "Thursday",
    edits: [{ old_text: "on Friday", new_text: "on Thursday" }],
    marks: [earlier.id, books.id],
  });
  assert.match(stray.error, /is not a mark on Notes\/Plan\.md/);
  const made = await claude.call("propose_edit", {
    note: "Notes/Plan.md",
    summary: "Thursday",
    edits: [{ old_text: "on Friday", new_text: "on Thursday" }],
    marks: [earlier.id],
  });
  state = await bridge.handlers.marks();
  assert.equal(byText(state, "Can this be earlier?").state, "proposed");
  const again = await claude.call("get_marks", { note: "Notes/Plan.md" });
  assert.equal(
    again.marks.find((m) => m.mark_id === earlier.id).proposal_id,
    made.proposal_id,
  );
  // A mark not acted on gets a reply; asked anew, the reply goes.
  assert.deepEqual(
    await claude.call("reply_mark", {
      mark_id: who.id,
      text: "Ana Lee, from finance?",
    }),
    { mark_id: who.id, status: "replied" },
  );
  state = await bridge.handlers.marks();
  assert.equal(byText(state, "Who?").state, "replied");
  assert.equal(byText(state, "Who?").answer.text, "Ana Lee, from finance?");
  // Asked further: the exchange so far stays with it, for the AI too.
  state = await bridge.handlers.changeMark("edit", {
    id: who.id,
    text: "Who is Ana? Her full name.",
  });
  const asked = byText(state, "Who is Ana? Her full name.");
  assert.equal(asked.state, "open");
  assert.equal(asked.answer, undefined);
  assert.deepEqual(asked.earlier, [
    { by: "owner", text: "Who?" },
    { by: "claude-code", text: "Ana Lee, from finance?" },
  ]);
  const read = (await claude.call("get_marks")).marks.find(
    (m) => m.mark_id === who.id,
  );
  assert.deepEqual(read.earlier, [
    { from: "owner", text: "Who?" },
    { from: "you", text: "Ana Lee, from finance?" },
  ]);
  // Accepted: the mark it answered is done.
  await bridge.handlers.decideProposal(made.proposal_id, {
    results: ["accepted"],
    saved: true,
  });
  state = await bridge.handlers.marks();
  assert.equal(byText(state, "Can this be earlier?"), undefined);
  assert.equal(state.marks.length, 2);
  // Rejected: the mark it answered is the owner's again.
  const second = await claude.call("propose_edit", {
    note: "Notes/Ideas.md",
    summary: "Two books",
    edits: [{ old_text: "A reading list.", new_text: "A reading list: X, Y." }],
    marks: [books.id],
  });
  await bridge.handlers.decideProposal(second.proposal_id, {
    results: ["rejected"],
    saved: true,
  });
  state = await bridge.handlers.marks();
  assert.equal(byText(state, "Add two books.").state, "open");
});

test("get_context tells the AI the note open in Marklore and the text selected in it", async (t) => {
  const { root, plan, bridge, session, mark, done } = await setup();
  t.after(done);
  const claude = await session();
  assert.deepEqual(await claude.call("get_context"), {
    open_note: null,
    note: "No note is open in Marklore.",
  });
  await mark(plan, "Ask Ana.", "Who?");
  const text = await fs.readFile(plan, "utf8");
  await bridge.handlers.setContext({
    fileId: plan,
    selection: { text: "on Friday", from: text.indexOf("on Friday") },
  });
  const context = await claude.call("get_context");
  assert.equal(context.open_note, "Notes/Plan.md");
  assert.deepEqual(context.selection, { text: "on Friday", line: 3 });
  assert.deepEqual(
    context.marks.map((m) => m.text),
    ["Who?"],
  );
  // Nothing selected.
  await bridge.handlers.setContext({ fileId: plan, selection: null });
  assert.equal((await claude.call("get_context")).selection, null);
  // A note outside the libraries open to AI: neither its name nor its text.
  const other = path.join(root, "Private.md");
  await fs.writeFile(other, "# Private\n\nSecret.\n");
  await bridge.handlers.setContext({
    fileId: other,
    selection: { text: "Secret.", from: 11 },
  });
  assert.deepEqual(await claude.call("get_context"), {
    open_note: null,
    note: "The note open in Marklore is not in a library open to AI.",
  });
  const written = await fs.readFile(
    path.join(root, "data", "ai", "context.json"),
    "utf8",
  );
  assert.doesNotMatch(written, /Secret|Private/);
});

test("marks on a note closed to AI show the AI only the owner's words", async (t) => {
  const { plan, store, session, mark, done } = await setup();
  t.after(done);
  const claude = await session();
  const state = await mark(plan, "on Friday", "Earlier?");
  await store.writeAccess({ libraries: [], excluded: [] });
  assert.deepEqual((await claude.call("get_marks")).marks, [
    {
      mark_id: state.marks[0].id,
      unavailable: "This note is not in a library open to AI.",
      text: "Earlier?",
      status: "open",
    },
  ]);
});

// The run's end, as the page sees it.
async function ended(bridge) {
  for (let i = 0; i < 600; i++) {
    const state = await bridge.handlers.marks();
    if (state.run && state.run.status !== "running") return state;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("The run did not end.");
}

test("a background run takes the open marks, proposes on each note and answers the rest", async (t) => {
  const { root, plan, ideas, store, bridge, session, mark, done } =
    await setup();
  t.after(done);
  const claude = await session();
  await mark(plan, "on Friday", "Earlier?");
  await mark(plan, "Ask Ana.", "Full name.");
  await mark(ideas, "A reading list.", "Add two books.");
  const argsFile = path.join(root, "args.json");
  process.env.FAKE_CLAUDE_ARGS = argsFile;
  t.after(() => delete process.env.FAKE_CLAUDE_ARGS);
  let state = await bridge.handlers.startRun();
  assert.equal(state.run.status, "running");
  assert.equal(state.run.count, 3);
  // While it works, its marks are not anyone else's.
  if (state.marks.every((m) => m.state === "background")) {
    assert.deepEqual((await claude.call("get_marks")).marks, []);
    await assert.rejects(
      bridge.handlers.changeMark("edit", { id: state.marks[0].id, text: "x" }),
      /后台 AI 正在处理这条标记/,
    );
  }
  await assert.rejects(bridge.handlers.startRun(), /后台 AI 正在处理标记/);
  state = await ended(bridge);
  assert.equal(state.run.status, "done");
  assert.equal(state.run.proposals, 2);
  assert.equal(state.run.result, "Proposed changes to 2 notes.");
  assert.deepEqual(
    state.marks.map((m) => m.state),
    ["proposed", "proposed", "proposed"],
  );
  const proposals = await bridge.handlers.proposals();
  assert.equal(proposals.length, 2);
  assert.ok(proposals.every((p) => p.background === true));
  // Claude Code was started with Marklore's server only, no tools of its
  // own, none of the owner's settings, and nothing to ask.
  const args = JSON.parse(await fs.readFile(argsFile, "utf8"));
  for (const flag of [
    "-p",
    "--restricted",
    "--strict-mcp-config",
    "--no-session-persistence",
  ])
    assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__marklore");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  // Its folder is gone with it; its note can be put away.
  assert.deepEqual(await fs.readdir(store.runs), [
    (await store.listRuns())[0].id + ".json",
  ]);
  state = await bridge.handlers.dismissRun(state.run.id);
  assert.equal(state.run, null);
});

test("a background run that fails or is stopped gives the marks back", async (t) => {
  const { plan, store, bridge, mark, done } = await setup();
  t.after(done);
  await mark(plan, "on Friday", "Earlier?");
  process.env.FAKE_CLAUDE = "fail";
  t.after(() => delete process.env.FAKE_CLAUDE);
  await bridge.handlers.startRun();
  let state = await ended(bridge);
  assert.equal(state.run.status, "failed");
  assert.match(state.run.error, /没有登录或登录已过期/);
  assert.equal(state.marks[0].state, "open");
  process.env.FAKE_CLAUDE = "hang";
  state = await bridge.handlers.startRun();
  assert.equal(state.marks[0].state, "background");
  await bridge.handlers.stopRun(state.run.id);
  state = await ended(bridge);
  assert.equal(state.run.status, "stopped");
  assert.equal(state.marks[0].state, "open");
  // Left running when Marklore closed: over at the next start.
  const run = await store.createRun({
    client: "claude-code",
    marks: [{ id: state.marks[0].id, file: plan }],
  });
  await store.changeMarks(plan, (doc) => {
    doc.marks[0].run = run.id;
  });
  bridge.start();
  t.after(() => bridge.close());
  state = await ended(bridge);
  assert.equal(state.run.status, "failed");
  assert.equal(state.marks[0].state, "open");
});

test("without Claude Code, or with nothing open, a run does not start", async (t) => {
  const { plan, store, bridge, mark, done } = await setup({ claude: false });
  t.after(done);
  await assert.rejects(bridge.handlers.startRun(), /没有找到 Claude Code/);
  const withClaude = await setup();
  t.after(withClaude.done);
  await assert.rejects(
    withClaude.bridge.handlers.startRun(),
    /没有要交给 AI 的标记/,
  );
  await withClaude.mark(withClaude.plan, "on Friday", "Earlier?");
  await withClaude.store.writeAccess({ libraries: [], excluded: [] });
  await assert.rejects(withClaude.bridge.handlers.startRun(), /没有开放给 AI/);
  (void plan, store, mark);
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

test("open comments of earlier versions become marks, once", async (t) => {
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
    marks.map((m) => [m.id, m.text, m.state]),
    [["aaaaaaa-111111", "Earlier?\n\nYes", "open"]],
  );
});

test("concurrent writers keep every mark", async (t) => {
  const { plan, store, done } = await setup();
  t.after(done);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.changeMarks(plan, (doc) => {
        doc.marks.push({ id: `m${i}`, quote: "x", text: "y" });
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
