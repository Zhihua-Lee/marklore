// Plays Claude Code in print mode for background runs (desktop/ai-runs.mjs):
// starts the MCP servers its --mcp-config names, as Claude Code would, reads
// the marks it is given and proposes on each note what they ask ("!" after
// the passage), answers the marks it cannot reach, and prints the JSON
// result. FAKE_CLAUDE=fail reports an expired sign-in; FAKE_CLAUDE=hang waits to be
// stopped. FAKE_CLAUDE_ARGS names a file to write its arguments to.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_ARGS)
  fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify(argv));
if (process.env.FAKE_CLAUDE === "fail") {
  // As Claude Code reports a sign-in that ran out.
  process.stdout.write(
    JSON.stringify({
      type: "result",
      is_error: true,
      result:
        "Failed to authenticate: OAuth session expired and could not be refreshed",
    }) + "\n",
  );
  process.exit(1);
}
if (process.env.FAKE_CLAUDE === "hang") setInterval(() => {}, 1000);
else {
  const config = JSON.parse(
    fs.readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8"),
  ).mcpServers.marklore;
  const child = spawn(config.command, config.args, {
    env: { ...process.env, ...config.env },
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
  const call = async (name, args) => {
    const { result } = await request("tools/call", { name, arguments: args });
    if (result.isError) throw Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "claude-code", version: "fake" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  const { marks } = await call("get_marks", {});
  const byNote = new Map();
  for (const m of marks)
    if (m.unavailable)
      await call("reply_mark", {
        mark_id: m.mark_id,
        text: "I can't read it.",
      });
    else {
      if (!byNote.has(m.note)) byNote.set(m.note, []);
      byNote.get(m.note).push(m);
    }
  for (const [note, list] of byNote)
    await call("propose_edit", {
      note,
      summary: `As marked (${list.length})`,
      edits: list.map((m) => ({ old_text: m.quote, new_text: m.quote + "!" })),
      marks: list.map((m) => m.mark_id),
    });
  child.stdin.end();
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: `Proposed changes to ${byNote.size} notes.`,
    }) + "\n",
  );
}
