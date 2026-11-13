import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConnections } from "../desktop/ai-connect.mjs";

const setup = {
  command: "C:\\Apps\\Marklore\\Marklore.exe",
  args: ["C:\\Apps\\Marklore\\resources\\app.asar\\desktop\\mcp.mjs"],
  env: { ELECTRON_RUN_AS_NODE: "1" },
};
async function place() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-connect-"));
  return { home, connections: createConnections({ setup, home, env: {} }) };
}

test("Claude Code: connected in its user settings, the rest kept", async () => {
  const { home, connections } = await place();
  const file = path.join(home, ".claude.json");
  let status = await connections.status("claude");
  assert.equal(status.state, "none");
  assert.equal(status.installed, false);

  await fs.writeFile(
    file,
    JSON.stringify({
      numStartups: 3,
      mcpServers: {
        other: { type: "http", url: "https://example.invalid/mcp" },
        marklore: { command: "C:\\Old\\Marklore.exe", args: ["x"] },
      },
      projects: { a: 1 },
    }),
  );
  status = await connections.status("claude");
  assert.equal(status.state, "other");
  assert.equal(status.command, "C:\\Old\\Marklore.exe");
  assert.equal(status.missing, true);

  status = await connections.connect("claude");
  assert.equal(status.state, "ok");
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(Object.keys(data), [
    "numStartups",
    "mcpServers",
    "projects",
  ]);
  assert.deepEqual(data.mcpServers.marklore, { type: "stdio", ...setup });
  assert.equal(data.mcpServers.other.url, "https://example.invalid/mcp");

  status = await connections.disconnect("claude");
  assert.equal(status.state, "none");
  const after = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(Object.keys(after.mcpServers), ["other"]);
  assert.deepEqual(after.projects, { a: 1 });
});

test("Claude Code: CLAUDE_CONFIG_DIR is where its settings are", async () => {
  const { home } = await place();
  const dir = path.join(home, "elsewhere");
  await fs.mkdir(dir);
  const connections = createConnections({
    setup,
    home,
    env: { CLAUDE_CONFIG_DIR: dir },
  });
  assert.equal((await connections.status("claude")).installed, true);
  await connections.connect("claude");
  const data = JSON.parse(
    await fs.readFile(path.join(dir, ".claude.json"), "utf8"),
  );
  assert.equal(data.mcpServers.marklore.command, setup.command);
});

test("an unreadable settings file is left alone", async () => {
  const { home, connections } = await place();
  await fs.writeFile(path.join(home, ".claude.json"), "{ not json");
  assert.equal((await connections.status("claude")).state, "unreadable");
  await assert.rejects(connections.connect("claude"));
  assert.equal(
    await fs.readFile(path.join(home, ".claude.json"), "utf8"),
    "{ not json",
  );
});

test("Codex: one table in config.toml, replaced whole, the rest kept", async () => {
  const { home, connections } = await place();
  const dir = path.join(home, ".codex");
  await fs.mkdir(dir);
  const file = path.join(dir, "config.toml");
  assert.equal((await connections.status("codex")).state, "none");
  assert.equal((await connections.status("codex")).installed, true);
  await fs.writeFile(
    file,
    [
      'model = "x"',
      "",
      "[mcp_servers.marklore]",
      "command = 'D:\\Old\\Marklore.exe'",
      "args = ['D:\\Old\\mcp.mjs']",
      "",
      "[mcp_servers.marklore.env]",
      'ELECTRON_RUN_AS_NODE = "1"',
      "",
      "[mcp_servers.other]",
      'command = "other"',
      "",
    ].join("\n"),
  );
  let status = await connections.status("codex");
  assert.equal(status.state, "other");
  assert.equal(status.command, "D:\\Old\\Marklore.exe");
  assert.equal(status.script, "D:\\Old\\mcp.mjs");

  status = await connections.connect("codex");
  assert.equal(status.state, "ok");
  const text = await fs.readFile(file, "utf8");
  assert.equal(text.match(/\[mcp_servers\.marklore/g).length, 1);
  assert.match(text, /\[mcp_servers\.other\]\ncommand = "other"/);
  assert.match(text, /^model = "x"/);
  assert.ok(
    text.includes(
      'command = "C:\\\\Apps\\\\Marklore\\\\Marklore.exe"\nargs = ["C:\\\\Apps\\\\Marklore\\\\resources\\\\app.asar\\\\desktop\\\\mcp.mjs"]\nenv = { ELECTRON_RUN_AS_NODE = "1" }',
    ),
  );

  status = await connections.disconnect("codex");
  assert.equal(status.state, "none");
  const left = await fs.readFile(file, "utf8");
  assert.doesNotMatch(left, /marklore/);
  assert.match(left, /\[mcp_servers\.other\]/);
});

test("Codex: a new config.toml holds only the table", async () => {
  const { home, connections } = await place();
  await connections.connect("codex");
  const text = await fs.readFile(
    path.join(home, ".codex", "config.toml"),
    "utf8",
  );
  assert.match(text, /^\[mcp_servers\.marklore\]\ncommand = /);
  assert.equal((await connections.status("codex")).state, "ok");
});

test("Codex: an entry written on one line is seen and replaced", async () => {
  for (const [before, rest] of [
    [
      'model = "x"\n\n[mcp_servers]\nother = { command = "o" }\nmarklore = { command = "D:\\\\Old\\\\Marklore.exe", args = ["a.mjs"] }\n',
      /^model = "x"\n\n\[mcp_servers\]\nother = \{ command = "o" \}\n\n\[mcp_servers\.marklore\]\n/,
    ],
    [
      "mcp_servers.marklore = { args = ['a.mjs'], command = 'D:\\Old\\Marklore.exe' }\n\n[profile]\nx = 1\n",
      /^\[profile\]\nx = 1\n\n\[mcp_servers\.marklore\]\n/,
    ],
  ]) {
    const { home, connections } = await place();
    const dir = path.join(home, ".codex");
    await fs.mkdir(dir);
    const file = path.join(dir, "config.toml");
    await fs.writeFile(file, before);
    const status = await connections.status("codex");
    assert.equal(status.state, "other");
    assert.equal(status.command, "D:\\Old\\Marklore.exe");
    assert.equal((await connections.connect("codex")).state, "ok");
    const text = await fs.readFile(file, "utf8");
    assert.match(text, rest);
    assert.equal(text.match(/marklore/g).length, 1);
  }
});
