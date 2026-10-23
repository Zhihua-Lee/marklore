// Marklore's MCP server (desktop/mcp.mjs starts it): JSON-RPC messages in
// and out, the data folder the app uses, and the tools (desktop/mcp-tools.mjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTools, INSTRUCTIONS } from "./mcp-tools.mjs";
import { isPortable, portableDir } from "./portable.mjs";
import { profileName, legacyProfileName } from "./profile-folder.mjs";

// The folder Electron's app.getPath("appData") gives on each system.
function appData(env = process.env) {
  if (process.platform === "win32")
    return env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support");
  return env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

// As desktop/main.mjs chooses it: an isolated profile (tests), a portable
// copy's "data" folder, or the profile folder (the old Folio Notes one while
// it has not been moved yet; only the app moves it).
export function dataFolder({
  env = process.env,
  executable = process.execPath,
  exists = fs.existsSync,
} = {}) {
  const isolated = env.FOLIO_DATA_DIR;
  if (isolated && path.isAbsolute(isolated)) return isolated;
  const packaged = !/^electron(\.exe)?$/i.test(path.basename(executable));
  if (packaged && isPortable(executable, exists))
    return portableDir(executable);
  const stand = env.FOLIO_PROFILE_DIR;
  if (stand && path.isAbsolute(stand)) return stand;
  const current = path.join(appData(env), profileName),
    legacy = path.join(appData(env), legacyProfileName);
  return exists(current) || !exists(legacy) ? current : legacy;
}

// The versions of the protocol this server speaks, newest first.
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export function createServer({ store, version, write }) {
  const tools = createTools({ store });
  let client = "unknown";
  const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
  const error = (id, code, message) =>
    write({ jsonrpc: "2.0", id, error: { code, message } });
  async function handle(message) {
    const { id, method, params } = message;
    const request = id !== undefined && id !== null;
    if (method === "initialize") {
      client = String(params?.clientInfo?.name || "unknown").slice(0, 100);
      return reply(id, {
        protocolVersion: VERSIONS.includes(params?.protocolVersion)
          ? params.protocolVersion
          : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "marklore", title: "Marklore", version },
        instructions: INSTRUCTIONS,
      });
    }
    if (method === "ping") return request && reply(id, {});
    if (method === "tools/list")
      return reply(id, {
        tools: tools.map(({ run, ...tool }) => tool),
      });
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(params.arguments || {}, { client });
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        return reply(id, {
          content: [{ type: "text", text: e.message || String(e) }],
          isError: true,
        });
      }
    }
    // Notifications (initialized, cancelled) need no answer.
    if (request) error(id, -32601, `Unknown method: ${method}`);
  }
  return {
    async receive(line) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return error(null, -32700, "Parse error");
      }
      if (Array.isArray(message)) {
        for (const item of message) await handle(item);
        return;
      }
      await handle(message);
    },
  };
}
