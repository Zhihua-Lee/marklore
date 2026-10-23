import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createAiStore, LAPSE_DAYS } from "../desktop/ai-store.mjs";
import { createServer, dataFolder } from "../desktop/mcp-server.mjs";

const server = fileURLToPath(new URL("../desktop/mcp.mjs", import.meta.url));

// A data folder with two libraries, one of them opened to AI.
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-mcp-"));
  const notes = path.join(root, "Notes"),
    other = path.join(root, "Private");
  await fs.mkdir(path.join(notes, "Projects"), { recursive: true });
  await fs.mkdir(path.join(notes, ".hidden"), { recursive: true });
  await fs.mkdir(path.join(notes, "Data"), { recursive: true });
  await fs.mkdir(other, { recursive: true });
  await fs.writeFile(
    path.join(notes, "Plan.md"),
    "# Plan\r\n\r\nWrite the draft.\r\n\r\nSend it on Friday.\r\n",
  );
  await fs.writeFile(path.join(notes, "Projects", "Alpha.md"), "Alpha notes\n");
  await fs.writeFile(path.join(notes, ".hidden", "Secret.md"), "hidden\n");
  await fs.writeFile(path.join(notes, "Data", "Out.md"), "excluded\n");
  await fs.writeFile(path.join(notes, "image.png"), "not a note");
  await fs.writeFile(path.join(other, "Diary.md"), "private\n");
  const data = path.join(root, "data");
  const store = createAiStore(path.join(data, "ai"));
  await store.writeAccess({
    libraries: [{ path: notes }],
    excluded: [path.join(notes, "Data")],
  });
  return { root, notes, other, data, store };
}

// The server as an AI starts it: a program speaking JSON-RPC on stdio.
function start(data) {
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", FOLIO_DATA_DIR: data },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map();
  let next = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  const call = async (name, args = {}) => {
    const { result } = await request("tools/call", { name, arguments: args });
    const text = result.content[0].text;
    return result.isError ? { error: text } : JSON.parse(text);
  };
  return { child, request, call, close: () => child.stdin.end() };
}

test("an AI reads the opened library over stdio and proposes an edit", async () => {
  const { data, store, root } = await setup();
  const ai = start(data);
  try {
    const init = await ai.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "1" },
    });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "marklore");
    assert.match(init.result.instructions, /accept/);
    ai.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    const { result } = await ai.request("tools/list");
    assert.deepEqual(
      result.tools.map((t) => t.name),
      [
        "list_libraries",
        "list_notes",
        "search_notes",
        "read_note",
        "propose_edit",
        "propose_note",
        "list_proposals",
        "get_proposal",
        "withdraw_proposal",
        "list_comments",
        "add_comment",
        "reply_comment",
        "resolve_comment",
      ],
    );
    assert.deepEqual(
      (await ai.call("list_libraries")).map((l) => l.library),
      ["Notes"],
    );
    // Hidden folders, excluded folders and other files are left out.
    assert.deepEqual((await ai.call("list_notes")).notes, [
      "Notes/Plan.md",
      "Notes/Projects/Alpha.md",
    ]);
    assert.deepEqual(
      (await ai.call("list_notes", { folder: "Notes/Projects" })).notes,
      ["Notes/Projects/Alpha.md"],
    );
    const found = await ai.call("search_notes", { query: "friday" });
    assert.equal(found.results[0].note, "Notes/Plan.md");
    assert.equal(found.results[0].lines[0].line, 5);
    const note = await ai.call("read_note", { note: "Notes/Plan.md" });
    assert.equal(
      note.text,
      "# Plan\n\nWrite the draft.\n\nSend it on Friday.\n",
    );
    const proposal = await ai.call("propose_edit", {
      note: "notes\\Plan.md",
      summary: "Earlier deadline",
      edits: [{ old_text: "on Friday", new_text: "on Thursday" }],
    });
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.client, "claude-code");
    assert.equal(proposal.note, "Notes/Plan.md");
    // Nothing is written to the note.
    assert.match(
      await fs.readFile(path.join(root, "Notes", "Plan.md"), "utf8"),
      /on Friday/,
    );
    const kept = await store.get(proposal.proposal_id);
    assert.equal(kept.version, note.version);
    assert.deepEqual(kept.edits, [
      { old_text: "on Friday", new_text: "on Thursday" },
    ]);
    assert.deepEqual(
      (await ai.call("list_proposals")).map((p) => [p.proposal_id, p.yours]),
      [[proposal.proposal_id, true]],
    );
    const withdrawn = await ai.call("withdraw_proposal", {
      id: proposal.proposal_id,
    });
    assert.equal(withdrawn.status, "withdrawn");
    assert.deepEqual(await ai.call("list_proposals"), []);
    assert.equal(
      (await ai.call("list_proposals", { include_decided: true }))[0].status,
      "withdrawn",
    );
    const unknown = await ai.request("nothing/here");
    assert.equal(unknown.error.code, -32601);
  } finally {
    ai.close();
  }
});

test("notes outside the opened libraries cannot be read or proposed", async () => {
  const { data, other, notes } = await setup();
  const ai = start(data);
  try {
    await ai.request("initialize", { clientInfo: { name: "codex" } });
    for (const note of [
      path.join(other, "Diary.md"),
      "Private/Diary.md",
      "Notes/../Private/Diary.md",
      "Notes/.hidden/Secret.md",
      "Notes/Data/Out.md",
      "Notes/image.png",
    ])
      assert.ok((await ai.call("read_note", { note })).error, note);
    // A link inside a library does not lead out of it.
    try {
      await fs.symlink(other, path.join(notes, "Link"), "junction");
      assert.match(
        (await ai.call("read_note", { note: "Notes/Link/Diary.md" })).error,
        /not in a library|not open/,
      );
    } catch (error) {
      if (error.code !== "EPERM") throw error;
    }
    const exists = await ai.call("propose_note", {
      note: "Notes/Plan.md",
      summary: "x",
      text: "y",
    });
    assert.match(exists.error, /exists already/);
    const missing = await ai.call("propose_edit", {
      note: "Notes/Plan.md",
      summary: "x",
      edits: [{ old_text: "nowhere", new_text: "y" }],
    });
    assert.match(missing.error, /Edit 1: its old_text is not in the note/);
    const twice = await ai.call("propose_edit", {
      note: "Notes/Plan.md",
      summary: "x",
      edits: [{ old_text: "\n\n", new_text: "\n\n\n" }],
    });
    assert.match(twice.error, /occurs 2 times/);
    const created = await ai.call("propose_note", {
      note: "Notes/Projects/Beta.md",
      summary: "Start Beta",
      text: "# Beta\r\n",
    });
    assert.equal(created.kind, "note");
    assert.equal(created.status, "pending");
    await assert.rejects(fs.stat(path.join(notes, "Projects", "Beta.md")));
  } finally {
    ai.close();
  }
});

test("without opened libraries the AI is told where to open them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-mcp-"));
  const messages = [];
  const instance = createServer({
    store: createAiStore(path.join(root, "ai")),
    version: "1.0.0",
    write: (m) => messages.push(m),
  });
  await instance.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    }),
  );
  assert.equal(messages[0].result.protocolVersion, "2025-11-25");
  await instance.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_libraries" },
    }),
  );
  assert.equal(messages[1].result.isError, true);
  assert.match(messages[1].result.content[0].text, /Settings → AI assistant/);
  await instance.receive("{not json");
  assert.equal(messages[2].error.code, -32700);
});

test("only the AI that made a proposal withdraws it; lapsed ones are not offered", async () => {
  const { store } = await setup();
  const old = await store.create(
    {
      kind: "edit",
      client: "a",
      summary: "s",
      note: "Notes/Plan.md",
      edits: [],
    },
    new Date(Date.now() - (LAPSE_DAYS + 1) * 864e5),
  );
  const mine = await store.create({
    kind: "edit",
    client: "a",
    summary: "s",
    note: "n",
    edits: [],
  });
  const messages = [];
  const instance = createServer({
    store,
    version: "1",
    write: (m) => messages.push(m),
  });
  const call = async (name, args) => {
    await instance.receive(
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
  await instance.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { clientInfo: { name: "b" } },
    }),
  );
  assert.match(
    (await call("withdraw_proposal", { id: mine.id })).error,
    /made by a/,
  );
  assert.deepEqual(
    (await call("list_proposals", {})).map((p) => p.proposal_id),
    [mine.id],
  );
  assert.equal((await call("get_proposal", { id: old.id })).status, "lapsed");
  assert.match(
    (await call("get_proposal", { id: "../x" })).error,
    /no proposal/,
  );
  await assert.rejects(
    store.decide(old.id, () => ({ status: "accepted" })),
    /lapsed/,
  );
});

test("the server finds the data folder the app uses", () => {
  const exe = path.join("C:", "Apps", "Marklore", "Marklore.exe");
  const has = (set) => (p) => set.includes(p);
  const env = { APPDATA: path.join("C:", "Users", "u", "AppData", "Roaming") };
  assert.equal(
    dataFolder({
      env: { ...env, FOLIO_DATA_DIR: path.resolve("/iso") },
      executable: exe,
    }),
    path.resolve("/iso"),
  );
  // A portable copy keeps its data beside the program.
  const portable = path.join(path.dirname(exe), "data");
  assert.equal(
    dataFolder({ env, executable: exe, exists: has([portable]) }),
    portable,
  );
  // Only a packaged copy is portable; development runs use the profile.
  if (process.platform === "win32") {
    assert.equal(
      dataFolder({ env, executable: exe, exists: has([]) }),
      path.join(env.APPDATA, "Marklore"),
    );
    assert.equal(
      dataFolder({
        env,
        executable: path.join("C:", "dev", "electron.exe"),
        exists: has([path.join("C:", "dev", "data")]),
      }),
      path.join(env.APPDATA, "Marklore"),
    );
    // The Folio Notes folder until the app has moved it.
    const legacy = path.join(env.APPDATA, "folio-notes");
    assert.equal(
      dataFolder({ env, executable: exe, exists: has([legacy]) }),
      legacy,
    );
  }
});
