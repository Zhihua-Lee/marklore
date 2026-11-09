// Where Claude Code's program is on this computer, for background runs on
// the owner's marks (ai-runs.mjs): on the PATH, in ~/.local/bin (its own
// installer), or the copy the Claude desktop app keeps for its Code tab (the
// newest version). FOLIO_CLAUDE names another program (tests use a script
// that plays Claude Code: a .mjs file runs in Node mode).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const isFile = (file) =>
  fs.stat(file).then(
    (s) => s.isFile(),
    () => false,
  );
// "2.1.317" before "2.1.309"; names that are no version last.
const byVersion = (a, b) => {
  const pa = a.split(".").map(Number),
    pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return Number.isNaN(d) ? 0 : d;
  }
  return 0;
};
async function bundled(folder, exe) {
  let versions = [];
  try {
    versions = (await fs.readdir(folder)).filter((v) =>
      /^\d+(\.\d+)*$/.test(v),
    );
  } catch {
    return null;
  }
  for (const version of versions.sort(byVersion)) {
    const dir = path.join(folder, version);
    if (await isFile(path.join(dir, exe))) return path.join(dir, exe);
    let inner = [];
    try {
      inner = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of inner)
      if (await isFile(path.join(dir, name, exe)))
        return path.join(dir, name, exe);
  }
  return null;
}

// { command, args, env } to start Claude Code with, or null.
export async function findClaude({
  env = process.env,
  home = os.homedir(),
  platform = process.platform,
  node = process.execPath,
} = {}) {
  if (env.FOLIO_CLAUDE)
    return (await isFile(env.FOLIO_CLAUDE))
      ? /\.mjs$/i.test(env.FOLIO_CLAUDE)
        ? {
            command: node,
            args: [env.FOLIO_CLAUDE],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          }
        : { command: env.FOLIO_CLAUDE, args: [], env: {} }
      : null;
  const exe = platform === "win32" ? "claude.exe" : "claude";
  const dirs = (env.PATH || env.Path || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const file of [
    ...dirs.map((d) => path.join(d, exe)),
    path.join(home, ".local", "bin", exe),
    ...(platform === "darwin"
      ? ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
      : []),
  ])
    if (await isFile(file)) return { command: file, args: [], env: {} };
  const app =
    platform === "win32"
      ? path.join(
          env.APPDATA || path.join(home, "AppData", "Roaming"),
          "Claude",
        )
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support", "Claude")
        : null;
  const found = app && (await bundled(path.join(app, "claude-code"), exe));
  return found ? { command: found, args: [], env: {} } : null;
}
