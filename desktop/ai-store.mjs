// What AI assistants (through Marklore's MCP server, desktop/mcp.mjs) and the
// app share, in the "ai" folder of Marklore's data folder:
// - access.json: the library folders the owner opened to AI (Settings → AI
//   assistant) and the folders left out of search; the app writes it, the
//   server reads it on every call, so a change applies at once.
// - proposals/<id>.json: one file per proposal, so the server and the app
//   never rewrite each other's files. The server creates them; the app
//   decides them; the AI that made one may withdraw it.
// - marks/<key>.json: the owner's marks on one note: a passage and what they
//   want of the AI about it. The app adds, edits and removes them; the
//   server notes on a mark the proposal that answers it or the AI's reply.
//   Both write, so a change takes a lock.
// - context.json: what the owner is looking at in Marklore (the note, the
//   selected text), written by the app as it changes, read by the server
//   when the AI asks.
// - runs/<id>.json: a background AI run the app started on the owner's
//   marks (desktop/ai-runs.mjs): its marks, state and outcome.
// - sessions/<id>.json: one per running server (one per assistant session):
//   which assistant, in which folder, when last active. Settings counts
//   them beside each assistant.
// (comments/, from earlier versions, is read once: open comments by the
// owner become marks.)
// No Electron here: the MCP server runs in Node mode.
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

export const AI_FOLDER = "ai";
// A proposal nobody decided within two weeks is no longer offered; decided
// ones are kept a month for get_proposal and list_proposals.
export const LAPSE_DAYS = 14;
export const KEEP_DAYS = 30;
// A session that has not said it is alive within this time is gone.
export const SESSION_STALE = 150e3;
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
    marks = path.join(folder, "marks"),
    runs = path.join(folder, "runs"),
    sessions = path.join(folder, "sessions"),
    accessFile = path.join(folder, "access.json"),
    contextFile = path.join(folder, "context.json");
  // A note's marks file, by its path (any case, either slash).
  const marksFile = (file) =>
    path.join(
      marks,
      createHash("sha256")
        .update(path.resolve(file).toLowerCase())
        .digest("hex")
        .slice(0, 16) + ".json",
    );
  const readMarks = async (file) =>
    (await readJson(marksFile(file))) || { file, marks: [] };
  const named = (kind) => (id) => {
    if (typeof id !== "string" || !ID.test(id))
      throw Error(`There is no ${kind} ${id}.`);
    return id + ".json";
  };
  const fileOf = (id) => path.join(proposals, named("proposal")(id));
  const runFile = (id) => path.join(runs, named("run")(id));
  const sessionFile = (id) => path.join(sessions, named("session")(id));
  // The JSON files of a folder whose names match, read; unreadable ones are
  // left out.
  async function readAll(dir, pattern) {
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const out = [];
    for (const name of names)
      if (pattern.test(name)) {
        const value = await readJson(path.join(dir, name));
        if (value) out.push({ name, value });
      }
    return out;
  }
  const byId = /^[a-z0-9]{6,20}-[a-f0-9]{6}\.json$/;
  const store = {
    folder,
    proposals,
    marks,
    runs,
    sessions,
    // The marks on one note: { file, marks }.
    marksOf: readMarks,
    // Every note's marks.
    async allMarks() {
      return (await readAll(marks, /^[a-f0-9]{16}\.json$/))
        .map((x) => x.value)
        .filter((v) => v.marks?.length);
    },
    // Changes a note's marks under the lock: `change` edits the value in
    // place and returns the result to give back.
    async changeMarks(file, change) {
      const target = marksFile(file);
      return withLock(target, async () => {
        const value = await readMarks(file);
        value.file = file;
        const result = await change(value);
        await writeJson(target, value);
        return result;
      });
    },
    // What the owner is looking at: { file, selection: { text, from, to } }.
    writeContext: (value) => writeJson(contextFile, value),
    readContext: () => readJson(contextFile),
    async createRun(run, now = new Date()) {
      const value = {
        ...run,
        id: newId(now.getTime()),
        started: now.toISOString(),
        status: "running",
      };
      await writeJson(runFile(value.id), value);
      return value;
    },
    getRun: (id) => readJson(runFile(id)),
    // Every run kept, newest first; finished ones past a month go.
    async listRuns(now = Date.now()) {
      const out = [];
      for (const { name, value } of await readAll(runs, byId)) {
        if (
          value.finished &&
          now - Date.parse(value.finished) > KEEP_DAYS * DAY
        ) {
          await fs.rm(path.join(runs, name), { force: true });
          continue;
        }
        out.push(value);
      }
      return out.sort((a, b) => b.started.localeCompare(a.started));
    },
    // Changes a run: `change` edits it in place.
    async changeRun(id, change) {
      const file = runFile(id);
      return withLock(file, async () => {
        const value = await readJson(file);
        if (!value) throw Error(`There is no run ${id}.`);
        const result = await change(value);
        await writeJson(file, value);
        return result;
      });
    },
    // A running server says who it is and that it is alive.
    writeSession: (id, value) => writeJson(sessionFile(id), value),
    removeSession: (id) => fs.rm(sessionFile(id), { force: true }),
    // The servers alive now, most recently active first. `alive(pid)` checks
    // the process where the caller can; files long stale are removed.
    async liveSessions(now = Date.now(), alive = () => true) {
      const out = [];
      for (const { name, value } of await readAll(sessions, byId)) {
        const age = now - Date.parse(value.active || 0);
        if (age > SESSION_STALE || !alive(value.pid)) {
          if (!(age <= 10 * SESSION_STALE))
            await fs.rm(path.join(sessions, name), { force: true });
          continue;
        }
        out.push(value);
      }
      return out.sort((a, b) => b.active.localeCompare(a.active));
    },
    // Open comments of earlier versions, started by the owner, become marks
    // not sent yet. Once: a file in marks/ remembers it was done.
    async carryComments() {
      const done = path.join(marks, "from-comments");
      if (
        await fs.stat(done).then(
          () => true,
          () => false,
        )
      )
        return 0;
      let count = 0;
      for (const { value } of await readAll(comments, /^[a-f0-9]{16}\.json$/)) {
        const open = (value.threads || []).filter(
          (t) =>
            t.by === "owner" &&
            !t.resolved &&
            typeof t.quote === "string" &&
            Array.isArray(t.messages),
        );
        if (!open.length || typeof value.file !== "string") continue;
        await store.changeMarks(value.file, (doc) => {
          for (const t of open) {
            if (doc.marks.some((m) => m.id === t.id)) continue;
            doc.marks.push({
              id: t.id,
              quote: t.quote,
              prefix: t.prefix || "",
              suffix: t.suffix || "",
              text: t.messages
                .filter((m) => m.by === "owner")
                .map((m) => m.text)
                .join("\n\n")
                .slice(0, 5000),
              created: t.created,
            });
            count++;
          }
        });
      }
      await fs.mkdir(marks, { recursive: true });
      await fs.writeFile(done, "");
      return count;
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
      const out = [];
      for (const { name, value } of await readAll(proposals, byId)) {
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
      return settle(id, change, now, true);
    },
    // The same, the proposal still waiting after it (one of its edits
    // decided).
    async update(id, change, now = new Date()) {
      return settle(id, change, now, false);
    },
  };
  return store;
  async function settle(id, change, now, decided) {
    const value = await readJson(fileOf(id));
    if (!value) throw Error(`There is no proposal ${id}.`);
    if (value.status !== "pending" || isLapsed(value, now.getTime()))
      throw Error(
        `Proposal ${id} is already ${isLapsed(value, now.getTime()) ? "lapsed" : value.status}.`,
      );
    const next = {
      ...value,
      ...change(value),
      ...(decided ? { decided: now.toISOString() } : {}),
    };
    await writeJson(fileOf(id), next);
    return next;
  }
}
