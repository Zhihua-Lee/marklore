// The app's side of AI proposals and marks (the MCP server is desktop/mcp.mjs):
// keeps access.json in step with the libraries ticked in Settings → AI
// assistant, tells the page when proposals or marks change, and carries out
// the owner's decisions. An accepted edit is applied by the page to the open
// note (so it can be undone, and saves as any edit does); an accepted new
// note is written here. The owner's marks are written here; an AI reads them
// through the server when asked, or a background run (ai-runs.mjs) takes
// them. A mark goes once a proposal answering it is accepted. What the owner
// is looking at (the note, the selection) is written for the server too.
import fs from "node:fs/promises";
import { watch, mkdirSync } from "node:fs";
import path from "node:path";
import { normalizeExcluded } from "./excluded.mjs";
import { isLapsed, newId } from "./ai-store.mjs";
import { locate } from "./mcp-tools.mjs";
import { createConnections } from "./ai-connect.mjs";
import { createRuns } from "./ai-runs.mjs";
import { findClaude } from "./claude-cli.mjs";
import { t } from "./i18n.mjs";

const key = (p) =>
  p
    .replace(/[\\/]+/g, "\\")
    .replace(/\\$/, "")
    .toLowerCase();

const string = (value, max) => {
  if (typeof value !== "string" || value.length > max)
    throw Error(t("无效操作"));
  return value;
};
// The owner's words to the AI: trimmed, or nothing when empty.
const words = (value, max) => {
  if (value == null) return null;
  const s = string(value, max).trim();
  return s || null;
};

// Whether a process still runs (a session's server).
function running(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// notify(kind): "proposals" or "marks" changed on disk. pathOf: a note's path
// from the page's file id.
export function createAiBridge({
  store,
  openFile,
  pathOf,
  notify,
  executable,
  script,
  connections = null,
  runOptions = {},
}) {
  let accessText = null;
  const setup = {
    command: executable,
    args: [script],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
  connections ??= createConnections({ setup });
  const runs = createRuns({
    store,
    setup,
    dataFolder: path.dirname(store.folder),
    findClaude: () => findClaude(),
    notify: () => notify("marks"),
    ...runOptions,
  });
  const assistant = (kind) => {
    if (!connections.kinds.includes(kind)) throw Error(t("无效操作"));
    return kind;
  };
  // An assistant's connection, and how many of its sessions run now.
  async function connection(kind) {
    const status = await connections.status(kind);
    const live = await store.liveSessions(Date.now(), running);
    const client = connections.clientOf(kind);
    return {
      ...status,
      sessions: live.filter((s) => client.test(s.client)).length,
    };
  }
  async function changeConnection(kind, connect) {
    const before = await connections.status(assistant(kind));
    if (before.state === "unreadable")
      throw Error(t("读不了它的设置文件：{file}", { file: before.file }));
    await (connect ? connections.connect(kind) : connections.disconnect(kind));
    return connection(kind);
  }
  const watchers = [],
    timers = {};
  // roots: the library folders; settings.aiLibraries: those ticked for AI.
  // A ticked folder removed from the library is no longer open.
  async function sync(roots, settings = {}) {
    const chosen = new Set(normalizeExcluded(settings.aiLibraries).map(key));
    const value = {
      libraries: roots
        .filter((p) => chosen.has(key(p)))
        .map((p) => ({ path: p })),
      excluded: normalizeExcluded(settings.searchExclude),
    };
    const text = JSON.stringify(value);
    if (text === accessText) return;
    // Nothing opened and nothing written before: leave the profile as it is.
    if (accessText === null && !value.libraries.length) {
      const old = await store.access();
      accessText = text;
      if (!old.libraries.length) return;
    }
    accessText = text;
    await store.writeAccess(value);
  }
  function start() {
    store
      .carryComments()
      .then((count) => count && notify("marks"))
      .catch(() => {});
    runs.recover().catch(() => {});
    // A mark's state follows the proposals that answer it.
    for (const [kinds, folder] of [
      [["proposals", "marks"], store.proposals],
      [["marks"], store.marks],
      [["marks"], store.runs],
    ])
      try {
        mkdirSync(folder, { recursive: true });
        const watcher = watch(folder, (_type, name) => {
          // Lock folders and temporary files come and go with each write.
          if (name && !/^[\w-]+\.json$/.test(String(name))) return;
          for (const kind of kinds) {
            clearTimeout(timers[kind]);
            timers[kind] = setTimeout(() => notify(kind), 150);
          }
        });
        watcher.on("error", () => watcher.close());
        watchers.push(watcher);
      } catch {
        /* The page also asks again when the window gets the focus. */
      }
  }

  // Marks: every note's, each with its state (open; replied: the AI
  // answered it; proposed: a proposal answering it waits for review;
  // background: a background run works on it), and the latest run.
  async function marksState() {
    const notes = await store.allMarks();
    const pending = new Set((await waiting()).map((p) => p.id));
    const all = await store.listRuns();
    const running = new Set(
      all.filter((r) => r.status === "running").map((r) => r.id),
    );
    const latest = all.find((r) => !r.dismissed) || null;
    const made = latest
      ? (await store.list()).filter((p) => p.run === latest.id).length
      : 0;
    return {
      marks: notes.flatMap((n) =>
        n.marks.map((m) => ({
          id: m.id,
          quote: m.quote,
          prefix: m.prefix,
          suffix: m.suffix,
          text: m.text,
          created: m.created,
          file: n.file,
          name: path.basename(n.file),
          state:
            m.run && running.has(m.run)
              ? "background"
              : m.proposal && pending.has(m.proposal)
                ? "proposed"
                : m.answer
                  ? "replied"
                  : "open",
          ...(m.answer ? { answer: m.answer } : {}),
          ...(m.earlier?.length ? { earlier: m.earlier } : {}),
        })),
      ),
      run: latest && {
        id: latest.id,
        status: latest.status,
        started: latest.started,
        finished: latest.finished || null,
        count: latest.marks.length,
        proposals: made,
        ...(latest.error ? { error: latest.error } : {}),
        ...(latest.result ? { result: latest.result } : {}),
      },
    };
  }
  // A mark, wherever it is: its note's file.
  async function markFile(id) {
    for (const note of await store.allMarks())
      if (note.marks.some((m) => m.id === id)) return note.file;
    throw Error(t("这条标记已不存在"));
  }
  async function changeMark(action, args = {}) {
    if (action === "add") {
      const file = pathOf(args.fileId);
      await store.changeMarks(file, (doc) => {
        if (doc.marks.length >= 500) throw Error(t("无效操作"));
        doc.marks.push({
          id: newId(),
          quote: string(args.quote, 1000),
          prefix: string(args.prefix ?? "", 100),
          suffix: string(args.suffix ?? "", 100),
          text: words(args.text, 5000) ?? "",
          created: new Date().toISOString(),
        });
      });
    } else if (action === "edit" || action === "remove") {
      const file = await markFile(args.id);
      const running = new Set(
        (await store.listRuns())
          .filter((r) => r.status === "running")
          .map((r) => r.id),
      );
      await store.changeMarks(file, (doc) => {
        const at = doc.marks.findIndex((m) => m.id === args.id);
        if (at < 0) throw Error(t("这条标记已不存在"));
        const mark = doc.marks[at];
        if (action === "remove") return void doc.marks.splice(at, 1);
        if (mark.run && running.has(mark.run))
          throw Error(t("后台 AI 正在处理这条标记"));
        // Answered, then asked further: the exchange so far stays with
        // the mark for the AI to read (the last ten turns).
        if (mark.answer)
          mark.earlier = [
            ...(mark.earlier || []),
            { by: "owner", text: mark.text },
            { by: mark.answer.by, text: mark.answer.text },
          ].slice(-10);
        mark.text = words(args.text, 5000) ?? "";
        delete mark.answer;
      });
    } else throw Error(t("无效操作"));
    return marksState();
  }
  // A proposal accepted: the marks it answered are done.
  async function settleMarks(id) {
    const p = await store.get(id);
    if (p?.status !== "accepted" || !p.marks?.length || !p.file) return;
    await store
      .changeMarks(p.file, (doc) => {
        doc.marks = doc.marks.filter((m) => m.proposal !== id);
      })
      .catch(() => {});
  }
  // What the owner is looking at, for the AI (get_context): the note, if it
  // is open to AI, and the text selected in it.
  let contextText = null;
  async function setContext({ fileId, selection } = {}) {
    let file = null;
    try {
      file = fileId ? pathOf(fileId) : null;
    } catch {
      /* A note that is gone. */
    }
    const open =
      file &&
      (await locate(store, file).then(
        () => true,
        () => false,
      ));
    const chosen =
      open && typeof selection?.text === "string" && selection.text.trim()
        ? {
            text: selection.text.slice(0, 20000),
            from: Number.isInteger(selection.from) ? selection.from : null,
          }
        : null;
    const value = open
      ? { file, selection: chosen }
      : { file: null, closed: !!file };
    const text = JSON.stringify(value);
    if (text === contextText) return;
    contextText = text;
    await store.writeContext({ ...value, at: new Date().toISOString() });
  }

  const waiting = async () =>
    (await store.list()).filter((p) => p.status === "pending" && !isLapsed(p));
  // What the page shows of a proposal.
  const shown = (p) => ({
    id: p.id,
    kind: p.kind,
    summary: p.summary,
    client: p.client,
    ...(p.run ? { background: true } : {}),
    created: p.created,
    note: p.note,
    file: p.file,
    name: path.basename(p.file || p.note || ""),
    ...(p.kind === "edit"
      ? { edits: p.edits, ...(p.results ? { results: p.results } : {}) }
      : { text: p.text }),
  });
  // The owner's words with a decision: a reason per rejected edit, a note on
  // the whole proposal.
  function told(p, reasons, note) {
    const out = {};
    if (Array.isArray(reasons)) {
      if (p.kind !== "edit" || reasons.length !== p.edits.length)
        throw Error(t("无效操作"));
      const clean = reasons.map((r) => words(r, 1000));
      if (clean.some(Boolean)) out.reasons = clean;
    }
    const ownerNote = words(note, 2000);
    if (ownerNote) out.ownerNote = ownerNote;
    return out;
  }
  // A whole proposal decided, or (with `edit`, its index) one of its edits:
  // `results` keeps each edit's decision, and the proposal is decided when
  // none waits any more (accepted when any edit was).
  async function decide(
    id,
    { status, saved, error, edit, results, reasons, note } = {},
  ) {
    // A review finished: every edit's decision at once (edits decided
    // earlier keep theirs); accepted when any edit was.
    if (Array.isArray(results)) {
      const next = await store.decide(id, (p) => {
        if (p.kind !== "edit" || results.length !== p.edits.length)
          throw Error(t("无效操作"));
        const final = results.map((r, i) => {
          if (p.results && p.results[i] !== "pending") return p.results[i];
          if (r !== "accepted" && r !== "rejected") throw Error(t("无效操作"));
          return r;
        });
        const accepted = final.includes("accepted");
        return {
          status: accepted ? "accepted" : "rejected",
          results: final,
          ...(accepted ? { saved: saved === true && p.saved !== false } : {}),
          ...told(p, reasons, note),
        };
      });
      return shown(next);
    }
    if (!["accepted", "rejected", "failed"].includes(status))
      throw Error(t("无效操作"));
    // Saved: every accepted edit is on disk.
    const savedAfter = (p) =>
      status === "accepted"
        ? { saved: saved === true && p.saved !== false }
        : p.saved === false
          ? { saved: false }
          : {};
    if (edit !== undefined) {
      if (status === "failed") throw Error(t("无效操作"));
      const next = await store.update(id, (p) => {
        if (
          p.kind !== "edit" ||
          !Number.isInteger(edit) ||
          edit < 0 ||
          edit >= p.edits.length
        )
          throw Error(t("无效操作"));
        const results = p.results || p.edits.map(() => "pending");
        if (results[edit] !== "pending") throw Error(t("无效操作"));
        return {
          results: results.map((r, i) => (i === edit ? status : r)),
          ...savedAfter(p),
        };
      });
      if (next.results.includes("pending")) return shown(next);
      const accepted = next.results.includes("accepted");
      return shown(
        await store.decide(id, () => ({
          status: accepted ? "accepted" : "rejected",
          ...(accepted ? { saved: next.saved !== false } : {}),
        })),
      );
    }
    return shown(
      await store.decide(id, (p) => {
        // The edits still waiting take this decision.
        const results = p.results?.map((r) =>
          r === "pending" && status !== "failed" ? status : r,
        );
        const final =
          status === "rejected" && results?.includes("accepted")
            ? "accepted"
            : status;
        return {
          status: final,
          ...(results ? { results } : {}),
          ...(final === "accepted"
            ? status === "accepted"
              ? savedAfter(p)
              : { saved: p.saved !== false }
            : {}),
          ...(status === "failed" && typeof error === "string"
            ? { error: error.slice(0, 500) }
            : {}),
          ...(status === "failed" ? {} : told(p, null, note)),
        };
      }),
    );
  }
  // The note must still be in a library open to AI; otherwise the proposal
  // fails, with the reason for the AI.
  async function check(p) {
    if (!p || p.status !== "pending" || isLapsed(p))
      throw Error(t("这条提议已处理或已过期"));
    try {
      return await locate(store, p.file, { exists: p.kind === "edit" });
    } catch (error) {
      await store
        .decide(p.id, () => ({ status: "failed", error: error.message }))
        .catch(() => {});
      throw Error(
        t("无法打开这条提议：{reason}", {
          reason:
            p.kind === "note"
              ? t("目标位置已有文件，或不在开放给 AI 的笔记库中")
              : t("笔记已不存在，或不在开放给 AI 的笔记库中"),
        }),
      );
    }
  }
  return {
    sync,
    start,
    close: () => {
      watchers.forEach((w) => w.close());
      runs.close();
    },
    handlers: {
      marks: marksState,
      changeMark,
      setContext,
      // The owner's open marks to a background AI; stopped, or its note
      // put away.
      async startRun() {
        await runs.start();
        return marksState();
      },
      async stopRun(id) {
        await runs.stop(string(id, 100));
        return marksState();
      },
      async dismissRun(id) {
        await runs.dismiss(string(id, 100));
        return marksState();
      },
      // The note a mark is on, opened as any note.
      openMarked: async (id) => openFile(await markFile(id)),
      proposals: async () => (await waiting()).map(shown),
      // An edit's note opens as any note; a new note has no file yet.
      async openProposal(id) {
        const p = await store.get(id);
        const found = await check(p);
        return {
          proposal: shown(p),
          document: p.kind === "edit" ? await openFile(found.file) : null,
        };
      },
      async decideProposal(id, decision) {
        const out = await decide(id, decision);
        await settleMarks(id);
        return out;
      },
      async createProposedNote(id) {
        const p = await store.get(id);
        if (p?.kind !== "note") throw Error(t("无效操作"));
        const found = await check(p);
        await fs.writeFile(found.file, p.text, {
          encoding: "utf8",
          flag: "wx",
        });
        await decide(id, { status: "accepted", saved: true });
        return openFile(found.file);
      },
      aiSetup: () => setup,
      aiConnections: () => Promise.all(connections.kinds.map(connection)),
      aiConnect: (kind) => changeConnection(kind, true),
      aiDisconnect: (kind) => changeConnection(kind, false),
    },
  };
}
