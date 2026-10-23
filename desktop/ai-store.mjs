// What AI assistants (through Marklore's MCP server, desktop/mcp.mjs) and the
// app share, in the "ai" folder of Marklore's data folder:
// - access.json: the library folders the owner opened to AI (Settings → AI
//   assistant) and the folders left out of search; the app writes it, the
//   server reads it on every call, so a change applies at once.
// - proposals/<id>.json: one file per proposal, so the server and the app
//   never rewrite each other's files. The server creates them; the app
//   decides them; the AI that made one may withdraw it.
// - comments/<key>.json: the comment threads on one note, by the owner and
//   by AI, both ways. Both sides write these, so a change takes a lock.
// No Electron here: the MCP server runs in Node mode.
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

export const AI_FOLDER = "ai";
// A proposal nobody decided within two weeks is no longer offered; decided
// ones are kept a month for get_proposal and list_proposals.
export const LAPSE_DAYS = 14;
export const KEEP_DAYS = 30;
const DAY = 864e5;
const ID = /^[a-z0-9]{6,20}-[a-f0-9]{6}$/;

export const newId = (now = Date.now()) =>
  now.toString(36) + "-" + randomBytes(3).toString("hex");

export const isLapsed = (proposal, now = Date.now()) =>
  proposal.status === "pending" &&
  now - Date.parse(proposal.created) >= LAPSE_DAYS * DAY;

// Written whole under a temporary name, then renamed over the old file, so a
// reader never sees half a file. Sync clients and antivirus briefly lock
// files on Windows: retry the rename.
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  for (let attempt = 0; ; attempt++)
    try {
      await fs.rename(temp, file);
      return;
    } catch (error) {
      if (attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
}

// One writer at a time for files both the app and the server change: a
// lock folder beside the file (made atomically), taken over when stale.
async function withLock(file, change) {
  const lock = file + ".lock";
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt > 200) throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 10000)
        await fs.rm(lock, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await change();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export function createAiStore(folder) {
  const proposals = path.join(folder, "proposals"),
    comments = path.join(folder, "comments"),
    accessFile = path.join(folder, "access.json");
  // A note's comment file, by its path (any case, either slash).
  const commentFile = (file) =>
    path.join(
      comments,
      createHash("sha256")
        .update(path.resolve(file).toLowerCase())
        .digest("hex")
        .slice(0, 16) + ".json",
    );
  const readComments = async (file) =>
    (await readJson(commentFile(file))) || { file, threads: [] };
  const fileOf = (id) => {
    if (typeof id !== "string" || !ID.test(id))
      throw Error(`There is no proposal ${id}.`);
    return path.join(proposals, id + ".json");
  };
  return {
    folder,
    proposals,
    comments,
    // The threads on one note: { file, threads }.
    commentsOf: readComments,
    // Every note's threads.
    async allComments() {
      let names = [];
      try {
        names = await fs.readdir(comments);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const out = [];
      for (const name of names)
        if (/^[a-f0-9]{16}\.json$/.test(name)) {
          const value = await readJson(path.join(comments, name));
          if (value?.threads?.length) out.push(value);
        }
      return out;
    },
    // Changes a note's threads under the lock: `change` edits the value
    // in place and returns the result to give back.
    async changeComments(file, change) {
      const target = commentFile(file);
      return withLock(target, async () => {
        const value = await readComments(file);
        value.file = file;
        const result = await change(value);
        await writeJson(target, value);
        return result;
      });
    },
    // A thread by its id, wherever it is: { file, thread } or null.
    async findThread(id) {
      if (typeof id !== "string" || !ID.test(id)) return null;
      for (const value of await this.allComments()) {
        const thread = value.threads.find((t) => t.id === id);
        if (thread) return { file: value.file, thread };
      }
      return null;
    },
    async access() {
      const value = await readJson(accessFile);
      return {
        libraries: Array.isArray(value?.libraries) ? value.libraries : [],
        excluded: Array.isArray(value?.excluded) ? value.excluded : [],
      };
    },
    writeAccess: (access) => writeJson(accessFile, access),
    async create(proposal, now = new Date()) {
      const value = {
        ...proposal,
        id: newId(now.getTime()),
        created: now.toISOString(),
        status: "pending",
      };
      await writeJson(fileOf(value.id), value);
      return value;
    },
    async get(id) {
      return readJson(fileOf(id));
    },
    // Every proposal kept, oldest first. Decided ones past a month are
    // removed on the way.
    async list(now = Date.now()) {
      let names = [];
      try {
        names = await fs.readdir(proposals);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const out = [];
      for (const name of names) {
        if (!name.endsWith(".json") || !ID.test(name.slice(0, -5))) continue;
        const value = await readJson(path.join(proposals, name));
        if (!value) continue;
        const done = Date.parse(value.decided || value.created);
        if (value.status !== "pending" || isLapsed(value, now)) {
          if (now - done > KEEP_DAYS * DAY) {
            await fs.rm(path.join(proposals, name), { force: true });
            continue;
          }
        }
        out.push(value);
      }
      return out.sort((a, b) => a.created.localeCompare(b.created));
    },
    // Changes a proposal still waiting: `change` returns the fields to set.
    async decide(id, change, now = new Date()) {
      const value = await readJson(fileOf(id));
      if (!value) throw Error(`There is no proposal ${id}.`);
      if (value.status !== "pending" || isLapsed(value, now.getTime()))
        throw Error(
          `Proposal ${id} is already ${isLapsed(value, now.getTime()) ? "lapsed" : value.status}.`,
        );
      const next = { ...value, ...change(value), decided: now.toISOString() };
      await writeJson(fileOf(id), next);
      return next;
    },
  };
}
