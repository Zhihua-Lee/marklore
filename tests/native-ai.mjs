// AI proposals end to end in the real app: an assistant starts Marklore's MCP
// server with the setup the app shows in Settings, reads a note of a library
// opened to AI and proposes an edit and a new note; the app shows them, and
// accepting writes them to disk. Closing the library to AI shuts the server
// out at once.
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
  profile = path.join(temp, "profile");
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
  const waiting = new Map();
  let next = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
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

  const setup = await page.evaluate(() => window.folio.aiSetup());
  assert.equal(setup.env.ELECTRON_RUN_AS_NODE, "1");
  ai = connect(setup);
  const init = await ai.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "claude-code", version: "1" },
  });
  assert.equal(init.result.serverInfo.name, "marklore");
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
  await page.locator("#content").getByText("Send it on Thursday.").waitFor();
  assert.equal(await fs.readFile(plan, "utf8"), note.text);
  await bar.getByRole("button", { name: "接受并保存" }).click();
  await bar.waitFor({ state: "hidden" });
  assert.equal(
    await fs.readFile(plan, "utf8"),
    "# Plan\n\nSend it on Thursday.\n",
  );
  const decided = await ai.call("get_proposal", { id: proposal.proposal_id });
  assert.equal(decided.status, "accepted");
  assert.equal(decided.saved, true);

  // A new note is written only on accept.
  const fresh = await ai.call("propose_note", {
    note: "kb/Meeting.md",
    summary: "Meeting notes",
    text: "# Meeting\n",
  });
  await button.waitFor({ state: "visible", timeout: 5000 });
  await button.click();
  await page.getByRole("menuitem", { name: /Meeting\.md/ }).click();
  await bar.getByRole("button", { name: "接受并创建" }).click();
  await bar.waitFor({ state: "hidden" });
  assert.equal(
    await fs.readFile(path.join(library, "Meeting.md"), "utf8"),
    "# Meeting\n",
  );
  assert.equal(
    (await ai.call("get_proposal", { id: fresh.proposal_id })).status,
    "accepted",
  );

  // Comments both ways: the AI comments on a passage, the reader sees it
  // underlined in the open note, answers it there, and the AI reads that.
  const comment = await ai.call("add_comment", {
    note: "kb/Plan.md",
    quote: "Thursday",
    text: "Morning or afternoon?",
  });
  assert.equal(comment.line, 3);
  await page.locator("#tree").getByText("Plan.md", { exact: true }).click();
  await page.waitForFunction(
    () =>
      [...(CSS.highlights.get("folio-comment") || [])].map(String).join() ===
      "Thursday",
    null,
    { timeout: 5000 },
  );
  await page
    .locator("#content")
    .getByText("Send it on Thursday.")
    .click({ position: { x: 100, y: 8 } });
  const card = page.locator(".comment-card");
  await card.getByText("Morning or afternoon?").waitFor();
  await card.getByRole("textbox").fill("Morning.");
  await card.getByRole("button", { name: "回复" }).click();
  await card.locator(".comment-messages li").nth(1).waitFor();
  const [answered] = await ai.call("list_comments");
  assert.equal(answered.comment_id, comment.comment_id);
  assert.deepEqual(
    answered.messages.map((m) => [m.from, m.text]),
    [
      ["claude-code", "Morning or afternoon?"],
      ["owner", "Morning."],
    ],
  );
  assert.equal(answered.needs_reply, true);
  // The AI settles it; the app drops the underline by itself.
  await ai.call("resolve_comment", { id: comment.comment_id });
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !CSS.highlights.get("folio-comment")?.size,
    null,
    { timeout: 5000 },
  );

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
    "Native AI passed: the server started with the app's setup reads an opened library; an edit and a new note proposed over MCP show in the app, and accepting writes them; comments go both ways; closing the library to AI shuts the server out.",
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
