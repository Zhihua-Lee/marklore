// Marklore's MCP server, for AI assistants (Claude Code, Codex, Claude
// Desktop…). The assistant starts it as Marklore's own program in Node mode:
//   ELECTRON_RUN_AS_NODE=1 Marklore.exe <app>/desktop/mcp.mjs
// (Settings → AI assistant shows the exact command). It speaks JSON-RPC over
// stdin and stdout, one message per line; nothing else may go to stdout.
// It reads only the libraries access.json opens, and writes only proposals
// (desktop/ai-store.mjs); the app applies them when the owner accepts.
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { createAiStore, AI_FOLDER } from "./ai-store.mjs";
import { createServer, dataFolder } from "./mcp-server.mjs";

let version = "0.0.0";
try {
  version = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
} catch {
  /* Reported as 0.0.0. */
}
const server = createServer({
  store: createAiStore(path.join(dataFolder(), AI_FOLDER)),
  version,
  write: (message) => process.stdout.write(JSON.stringify(message) + "\n"),
});
// One message at a time, in order.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  queue = queue.then(() => server.receive(line).catch((e) => console.error(e)));
});
