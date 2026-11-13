// Adding Marklore's MCP server to an assistant's own settings, so the owner
// connects it with one button instead of pasting lines: Claude Code keeps
// its user-wide servers in `.claude.json` (in CLAUDE_CONFIG_DIR, else the
// home folder), Codex in `config.toml` (in CODEX_HOME, else ~/.codex).
// Each assistant is either not connected, connected to this copy of
// Marklore, or connected to another one (an older copy, or one moved or
// deleted since), which one button points at this copy again.
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const NAME = "marklore";
const same = (a, b) =>
  !!a &&
  !!b &&
  (process.platform === "win32" || process.platform === "darwin"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b));

// Written whole under another name, then moved over the file.
async function writeWhole(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, text, "utf8");
  for (let i = 0; ; i++)
    try {
      return await fs.rename(temp, file);
    } catch (error) {
      if (i >= 5) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
}
const readText = (file) =>
  fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

// ---- Codex: a [mcp_servers.marklore] table in TOML ----

// The lines of `[mcp_servers.marklore]` and its sub-tables, as [start, end).
function tomlBlock(lines) {
  const head =
    /^\s*\[\s*mcp_servers\s*\.\s*(?:"marklore"|'marklore'|marklore)\s*(?:\.|\])/;
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) {
    // Written on one line instead: "marklore = { ... }" in [mcp_servers],
    // or "mcp_servers.marklore = { ... }" before any table.
    const name = `(?:"marklore"|'marklore'|marklore)`,
      inline = new RegExp(`^\\s*${name}\\s*=\\s*\\{.*\\}\\s*(?:#.*)?$`),
      dotted = new RegExp(
        `^\\s*mcp_servers\\s*\\.\\s*${name}\\s*=\\s*\\{.*\\}\\s*(?:#.*)?$`,
      );
    let table = "";
    for (let i = 0; i < lines.length; i++) {
      const opened = /^\s*\[\s*([^\]]*?)\s*\]/.exec(lines[i]);
      if (opened) table = opened[1];
      else if (
        (table === "" && dotted.test(lines[i])) ||
        (table === "mcp_servers" && inline.test(lines[i]))
      )
        return [i, i + 1];
    }
    return null;
  }
  let end = start + 1;
  while (
    end < lines.length &&
    !(/^\s*\[/.test(lines[end]) && !head.test(lines[end]))
  )
    end++;
  // Blank lines and comments before the next table stay with it.
  while (end > start + 1 && /^\s*(#.*)?$/.test(lines[end - 1])) end--;
  return [start, end];
}
function tomlString(value) {
  value = value.trim();
  if (value.startsWith("'")) return value.slice(1, value.indexOf("'", 1));
  if (value.startsWith('"'))
    try {
      return JSON.parse(value.slice(0, value.lastIndexOf('"') + 1));
    } catch {
      return null;
    }
  return null;
}
function tomlEntry(text) {
  const lines = text.split(/\r?\n/);
  const block = tomlBlock(lines);
  if (!block) return null;
  const body = lines.slice(...block);
  // On one line ("{ command = ..., args = [...] }"), each key is looked
  // for within the braces.
  const within =
    body.length === 1 && !/^\s*\[/.test(body[0])
      ? body[0].slice(body[0].indexOf("{") + 1)
      : null;
  const value = (key) =>
    within !== null
      ? new RegExp(
          `(?:^|[,\\s])${key}\\s*=\\s*(\\[[^\\]]*\\]|"(?:[^"\\\\]|\\\\.)*"|'[^']*')`,
        ).exec(within)?.[1]
      : body
          .map((l) => new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(l))
          .find(Boolean)?.[1];
  const args = value("args");
  return {
    command: value("command") ? tomlString(value("command")) : null,
    args: args
      ? [...args.matchAll(/"(?:[^"\\]|\\.)*"|'[^']*'/g)].map((m) =>
          tomlString(m[0]),
        )
      : [],
  };
}
// JSON strings are TOML basic strings.
const toml = (s) => JSON.stringify(s);
function tomlWith(text, setup) {
  // With the file's own line ends.
  const eol = /\r\n/.test(text || "") ? "\r\n" : "\n";
  return tomlLines(text, setup).replace(/\n/g, eol);
}
function tomlLines(text, setup) {
  const lines = text ? text.split(/\r?\n/) : [];
  const block = tomlBlock(lines);
  if (block) {
    lines.splice(block[0], block[1] - block[0]);
    // One blank line where the table stood, not the two around it.
    if (
      block[0] > 0 &&
      !lines[block[0] - 1].trim() &&
      lines[block[0]]?.trim() === ""
    )
      lines.splice(block[0], 1);
  }
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  // Nor a blank line left at the top where the entry was the first thing.
  if (block?.[0] === 0) while (lines.length && !lines[0].trim()) lines.shift();
  if (!setup) return lines.length ? lines.join("\n") + "\n" : "";
  const env = Object.entries(setup.env)
    .map(([k, v]) => `${k} = ${toml(v)}`)
    .join(", ");
  const table = [
    `[mcp_servers.${NAME}]`,
    `command = ${toml(setup.command)}`,
    `args = [${setup.args.map(toml).join(", ")}]`,
    `env = { ${env} }`,
  ];
  return [...lines, ...(lines.length ? [""] : []), ...table, ""].join("\n");
}

export function createConnections({
  setup,
  home = os.homedir(),
  env = process.env,
}) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || null;
  const codexDir = env.CODEX_HOME || path.join(home, ".codex");
  const kinds = {
    claude: {
      client: /^claude-code\b/i,
      file: path.join(claudeDir || home, ".claude.json"),
      installed: () =>
        existsSync(claudeDir || path.join(home, ".claude")) ||
        existsSync(path.join(claudeDir || home, ".claude.json")),
      async read() {
        const text = await readText(this.file);
        if (text === null) return { data: {}, entry: null };
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw Error("unreadable");
        }
        const entry = data?.mcpServers?.[NAME];
        return {
          data,
          entry: entry
            ? { command: entry.command, args: entry.args || [] }
            : null,
        };
      },
      async write(value) {
        const { data } = await this.read();
        const servers = { ...(data.mcpServers || {}) };
        if (value)
          servers[NAME] = {
            type: "stdio",
            command: value.command,
            args: value.args,
            env: value.env,
          };
        else delete servers[NAME];
        await writeWhole(
          this.file,
          JSON.stringify({ ...data, mcpServers: servers }, null, 2),
        );
      },
    },
    codex: {
      client: /^codex/i,
      file: path.join(codexDir, "config.toml"),
      installed: () => existsSync(codexDir),
      async read() {
        const text = await readText(this.file);
        return { text, entry: text ? tomlEntry(text) : null };
      },
      async write(value) {
        const { text } = await this.read();
        await writeWhole(this.file, tomlWith(text || "", value));
      },
    },
  };

  async function status(kind) {
    const k = kinds[kind];
    let entry;
    try {
      ({ entry } = await k.read());
    } catch {
      return { kind, file: k.file, state: "unreadable" };
    }
    const base = { kind, file: k.file, installed: k.installed() };
    if (!entry) return { ...base, state: "none" };
    const ours =
      same(entry.command, setup.command) && same(entry.args[0], setup.args[0]);
    return ours
      ? { ...base, state: "ok" }
      : {
          ...base,
          state: "other",
          command: entry.command,
          script: entry.args[0] ?? null,
          missing: !!entry.command && !existsSync(entry.command),
        };
  }

  return {
    kinds: Object.keys(kinds),
    clientOf: (kind) => kinds[kind].client,
    status,
    async connect(kind) {
      await kinds[kind].write(setup);
      return status(kind);
    },
    async disconnect(kind) {
      await kinds[kind].write(null);
      return status(kind);
    },
  };
}
