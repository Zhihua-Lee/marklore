// AI proposals and marks end to end in the real app: an assistant starts
// Marklore's MCP server with the setup the app shows in Settings, reads a
// note of a library opened to AI and proposes an edit and a new note; the app
// shows them, and accepting writes them to disk, the assistant hearing it at
// once (Claude Code's channel events). The reader marks a passage; asked,
// the assistant reads it with the note open, proposes what it asks, and the
// mark goes once that is accepted. A mark handed to a background AI (Claude
// Code played by tests/fake-claude.mjs) comes back as a proposal from it.
// Closing the library to AI shuts the server out at once.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "marklore-ai-")),
);
const library = path.join(temp, "kb"),
  profile = path.join(temp, "profile"),
  // The assistants' own settings, here and not the owner's.
  claudeDir = path.join(temp, "claude"),
  codexDir = path.join(temp, "codex");
await fs.mkdir(library);
await fs.mkdir(profile);
const plan = path.join(library, "Plan.md");
await fs.writeFile(plan, "# Plan\n\nSend it on Friday.\n");
await fs.writeFile(
  path.join(profile, "session.json"),
  JSON.stringify({
    roots: [library],
    settings: { sidebar: true, aiLibraries: [library] },
  }),
);

// The server as an assistant runs it, speaking JSON-RPC over stdio.
function connect(setup) {
  const child = spawn(setup.command, setup.args, {
    env: {
      ...process.env,
      ...setup.env,
      FOLIO_DATA_DIR: profile,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map(),
    events = [];
  let next = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "notifications/claude/channel")
      events.push(message.params);
    else waiting.get(message.id)?.(message);
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, resolve);
      setTimeout(() => reject(Error(`No answer to ${method}`)), 15000);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  return {
    request,
    notify: (method) =>
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n"),
    // The next event pushed into the session, of a kind.
    async event(kind) {
      for (let i = 0; i < 100; i++) {
        const found = events.findIndex((e) => e.meta.event === kind);
        if (found >= 0) return events.splice(found, 1)[0];
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error(`No ${kind} event`);
    },
    async call(name, args = {}) {
      const { result } = await request("tools/call", {
        name,
        arguments: args,
      });
      const text = result.content[0].text;
      return result.isError ? { error: text } : JSON.parse(text);
    },
    close: () => child.stdin.end(),
  };
}

const exe = process.env.FOLIO_TEST_EXE;
let instance, ai;
try {
  instance = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: exe ? [] : [project],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      CLAUDE_CONFIG_DIR: claudeDir,
      CODEX_HOME: codexDir,
      FOLIO_CLAUDE: fileURLToPath(
        new URL("./fake-claude.mjs", import.meta.url),
      ),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await page.locator("#tree").getByText("Plan.md", { exact: true }).waitFor();
  // The app opened the ticked library to AI.
  const accessFile = path.join(profile, "ai", "access.json");
  let access;
  for (let i = 0; i < 50 && !access; i++) {
    access = await fs
      .readFile(accessFile, "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (!access) await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(access.libraries, [{ path: library }]);

  // Connected with one button: the app writes Claude Code's settings, and
  // the assistant starts the server as written there.
  const before = await page.evaluate(() => window.folio.aiConnections());
  assert.deepEqual(
    before.map((c) => [c.kind, c.state]),
    [
      ["claude", "none"],
      ["codex", "none"],
    ],
  );
  const connected = await page.evaluate(() => window.folio.aiConnect("claude"));
  assert.equal(connected.state, "ok");
  const written = JSON.parse(
    await fs.readFile(path.join(claudeDir, ".claude.json"), "utf8"),
  ).mcpServers.marklore;
  assert.equal(written.type, "stdio");
  assert.equal(written.env.ELECTRON_RUN_AS_NODE, "1");
  ai = connect(written);
  const init = await ai.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "claude-code", version: "1" },
  });
  assert.equal(init.result.serverInfo.name, "marklore");
  assert.deepEqual(init.result.capabilities.experimental, {
    "claude/channel": {},
  });
  ai.notify("notifications/initialized");
  // The running session is counted beside the connection.
  for (let i = 0; i < 50; i++) {
    const [claude] = await page.evaluate(() => window.folio.aiConnections());
    if (claude.sessions === 1) break;
    assert.ok(i < 49, "the session is not counted");
    await new Promise((r) => setTimeout(r, 100));
  }
  const note = await ai.call("read_note", { note: "kb/Plan.md" });
  assert.equal(note.text, "# Plan\n\nSend it on Friday.\n");
  const proposal = await ai.call("propose_edit", {
    note: "kb/Plan.md",
    summary: "Earlier deadline",
    edits: [{ old_text: "on Friday", new_text: "on Thursday" }],
  });
  assert.equal(proposal.status, "pending");

  // The app learns of it by itself and offers it.
  const button = page.locator("#proposals-button");
  await button.waitFor({ state: "visible", timeout: 5000 });
  await button.click();
  await page.getByRole("menuitem", { name: /Plan\.md/ }).click();
  const bar = page.locator("#proposal-bar");
  await bar.getByText("Earlier deadline").waitFor();
  // Reviewing at once: the removed word struck through where it was.
  await page.locator("#content del", { hasText: "Friday" }).waitFor();
  await page
    .locator("#content")
    .getByText(/Send it on Friday\s*Thursday\./)
    .waitFor();
  assert.equal(await fs.readFile(plan, "utf8"), note.text);
  // Deciding the only change ends the review and writes it.
  await bar.getByRole("button", { name: "接受这处", exact: true }).click();
  await bar.waitFor({ state: "hidden" });
  assert.equal(
    await fs.readFile(plan, "utf8"),
    "# Plan\n\nSend it on Thursday.\n",
  );
  const decided = await ai.call("get_proposal", { id: proposal.proposal_id });
  assert.equal(decided.status, "accepted");
  assert.equal(decided.saved, true);
  assert.deepEqual(decided.edit_results, ["accepted"]);
  // The session heard it without asking.
  const heard = await ai.event("proposal");
  assert.equal(heard.meta.proposal_id, proposal.proposal_id);
  assert.match(heard.content, /accepted edit 1/);

  // A new note is written only on accept.
  const fresh = await ai.call("propose_note", {
    note: "kb/Meeting.md",
    summary: "Meeting notes",
    text: "# Meeting\n",
  });
  await button.waitFor({ state: "visible", timeout: 5000 });
  await button.click();
  await page.getByRole("menuitem", { name: /Meeting\.md/ }).click();
  await bar.getByRole("button", { name: "全部接受", exact: true }).click();
  await bar.waitFor({ state: "hidden" });
  assert.equal(
    await fs.readFile(path.join(library, "Meeting.md"), "utf8"),
    "# Meeting\n",
  );
  assert.equal(
    (await ai.call("get_proposal", { id: fresh.proposal_id })).status,
    "accepted",
  );

  // Marks: the reader marks a passage, and asks the session about it.
  await page.locator("#tree").getByText("Plan.md", { exact: true }).click();
  await page.locator("#content").getByText("Send it on Thursday.").waitFor();
  await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector("#content"),
      NodeFilter.SHOW_TEXT,
    );
    for (let node; (node = walker.nextNode());) {
      const at = node.data.indexOf("Thursday");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "Thursday".length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
  });
  await page.keyboard.press("Control+Alt+m");
  const card = page.locator(".mark-card");
  await card.getByRole("textbox").fill("Morning or afternoon?");
  await card.getByRole("textbox").press("Control+Enter");
  await page.waitForFunction(
    () =>
      [...(CSS.highlights.get("folio-mark") || [])].map(String).join() ===
      "Thursday",
    null,
    { timeout: 5000 },
  );
  // The AI reads the note open and its marks, and answers with a
  // proposal; dotted while it waits, gone once it is accepted.
  // (The app tells what is open a moment after it changes.)
  let context = null;
  for (let i = 0; i < 50; i++) {
    context = await ai.call("get_context");
    if (context.open_note) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(context.open_note, "kb/Plan.md", JSON.stringify(context));
  assert.deepEqual(
    context.marks.map((m) => [m.quote, m.line, m.text, m.status]),
    [["Thursday", 3, "Morning or afternoon?", "open"]],
  );
  const [asked] = (await ai.call("get_marks")).marks;
  await ai.call("propose_edit", {
    note: "kb/Plan.md",
    summary: "In the morning",
    edits: [{ old_text: "on Thursday.", new_text: "on Thursday morning." }],
    marks: [asked.mark_id],
  });
  await page.waitForFunction(
    () => CSS.highlights.get("folio-mark-sent")?.size === 1,
    null,
    { timeout: 5000 },
  );
  await button.click();
  await page.getByRole("menuitem", { name: /In the morning/ }).click();
  await bar.getByRole("button", { name: "全部接受", exact: true }).click();
  await bar.waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      !CSS.highlights.get("folio-mark")?.size &&
      !CSS.highlights.get("folio-mark-sent")?.size,
    null,
    { timeout: 5000 },
  );
  assert.deepEqual((await ai.call("get_marks")).marks, []);
  assert.equal(
    await fs.readFile(plan, "utf8"),
    "# Plan\n\nSend it on Thursday morning.\n",
  );

  // Handed to a background AI: it proposes, and the proposal says so.
  await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector("#content"),
      NodeFilter.SHOW_TEXT,
    );
    for (let node; (node = walker.nextNode());) {
      const at = node.data.indexOf("Send it");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "Send it".length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
  });
  await page.keyboard.press("Control+Alt+m");
  await card.getByRole("textbox").fill("Say who sends it.");
  await card.getByRole("textbox").press("Control+Enter");
  const marksButton = page.locator("#marks-button");
  await marksButton.click();
  const panel = page.locator(".marks-panel");
  await panel.getByRole("button", { name: "交给后台 AI（1 条）" }).click();
  await panel
    .locator(".marks-run-line", { hasText: "后台 AI 处理完了：提了 1 条修改" })
    .waitFor({ timeout: 60000 });
  await page.keyboard.press("Escape");
  await button.click();
  await page
    .getByRole("menuitem", { name: /Claude Code（后台）：As marked/ })
    .click();
  await bar.getByRole("button", { name: "全部接受", exact: true }).click();
  await bar.waitFor({ state: "hidden" });
  assert.equal(
    await fs.readFile(plan, "utf8"),
    "# Plan\n\nSend it! on Thursday morning.\n",
  );
  assert.deepEqual((await ai.call("get_marks")).marks, []);

  // Closed to AI in Settings: the server can no longer read it.
  await page.locator("#weight").click();
  await page
    .locator(".settings-nav")
    .getByRole("button", { name: "AI 助手" })
    .click();
  await page.getByRole("checkbox", { name: "kb" }).uncheck();
  let closed = null;
  for (let i = 0; i < 50 && !closed; i++) {
    const answer = await ai.call("read_note", { note: "kb/Plan.md" });
    if (answer.error) closed = answer.error;
    else await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(closed, /not opened any library/);
  console.log(
    "Native AI passed: connected with one button, the server started as Claude Code's settings say reads an opened library; an edit and a new note proposed over MCP show in the app, and accepting writes them and tells the session; a marked passage is read with the open note and answered with a proposal, and a mark handed to a background AI comes back as one; closing the library to AI shuts the server out.",
  );
} finally {
  ai?.close();
  if (instance) {
    await instance
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await instance.close().catch(() => {});
  }
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
