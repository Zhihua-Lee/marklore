// The app's side of AI proposals and marks (the MCP server is desktop/mcp.mjs):
// keeps access.json in step with the libraries ticked in Settings → AI
// assistant, tells the page when proposals or marks change, and carries out
// the owner's decisions. An accepted edit is applied by the page to the open
// note (so it can be undone, and saves as any edit does); an accepted new
// note is written here. The owner's marks are written here for the page and
// sent, in batches, to an assistant session the server keeps listed.
import fs from "node:fs/promises";
import { watch, mkdirSync } from "node:fs";
import path from "node:path";
import { normalizeExcluded } from "./excluded.mjs";
import { isLapsed, newId } from "./ai-store.mjs";
import { locate } from "./mcp-tools.mjs";
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
}) {
  let accessText = null;
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
    for (const [kind, folder] of [
      ["proposals", store.proposals],
      ["marks", store.marks],
      ["marks", store.batches],
      ["marks", store.sessions],
    ])
      try {
        mkdirSync(folder, { recursive: true });
        const watcher = watch(folder, (_type, name) => {
          // Lock folders and temporary files come and go with each write.
          if (name && !/^[\w-]+\.json$/.test(String(name))) return;
          clearTimeout(timers[kind]);
          timers[kind] = setTimeout(() => notify(kind), 150);
        });
        watcher.on("error", () => watcher.close());
        watchers.push(watcher);
      } catch {
        /* The page also asks again when the window gets the focus. */
      }
  }

  // Marks: every note's, the batches not finished, and the sessions they
  // can be sent to.
  async function marksState() {
    const notes = await store.allMarks();
    const batches = (await store.listBatches()).filter((b) => !b.done);
    const sessions = await store.liveSessions(Date.now(), running);
    return {
      marks: notes.flatMap((n) =>
        n.marks.map((m) => ({
          ...m,
          file: n.file,
          name: path.basename(n.file),
        })),
      ),
      batches: batches.map((b) => ({
        id: b.id,
        created: b.created,
        target: b.target,
        status: b.status,
        readBy: b.readBy || null,
        marks: b.marks.map((m) => ({
          id: m.id,
          file: m.file,
          name: path.basename(m.file),
          quote: m.quote,
          text: m.text,
        })),
        replies: b.replies,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        client: s.client,
        cwd: s.cwd,
        folder: s.folder,
        push: s.push === true,
        active: s.active,
      })),
    };
  }
  // A mark not sent yet, wherever it is: its note's file.
  async function draftFile(id) {
    for (const note of await store.allMarks()) {
      const mark = note.marks.find((m) => m.id === id);
      if (mark) {
        if (mark.batch) throw Error(t("这条标记已发送，不能再改"));
        return note.file;
      }
    }
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
          batch: null,
        });
      });
    } else if (action === "edit" || action === "remove") {
      const file = await draftFile(args.id);
      await store.changeMarks(file, (doc) => {
        const at = doc.marks.findIndex((m) => m.id === args.id);
        if (at < 0) throw Error(t("这条标记已不存在"));
        if (action === "remove") doc.marks.splice(at, 1);
        else doc.marks[at].text = words(args.text, 5000) ?? "";
      });
    } else throw Error(t("无效操作"));
    return marksState();
  }
  // Every mark not sent yet goes, as one batch, to an assistant session:
  // target { client, cwd, session } (the session may be gone by the time;
  // the next one of that assistant in that folder takes it).
  async function sendMarks(target) {
    const chosen = {
      client: string(target?.client, 100),
      cwd: string(target?.cwd, 2000),
      session: target?.session == null ? null : string(target.session, 100),
    };
    // In the order they were made: the AI numbers them so.
    const drafts = (await store.allMarks())
      .flatMap((n) =>
        n.marks.filter((m) => !m.batch).map((m) => ({ ...m, file: n.file })),
      )
      .sort((a, b) => String(a.created).localeCompare(String(b.created)));
    if (!drafts.length) throw Error(t("没有要发送的标记"));
    const batch = await store.createBatch({
      target: chosen,
      marks: drafts.map(({ id, file, quote, prefix, suffix, text }) => ({
        id,
        file,
        quote,
        prefix,
        suffix,
        text,
      })),
    });
    const ids = new Set(drafts.map((m) => m.id));
    for (const file of new Set(drafts.map((m) => m.file)))
      await store.changeMarks(file, (doc) => {
        for (const m of doc.marks) if (ids.has(m.id)) m.batch = batch.id;
      });
    return marksState();
  }
  // The owner is done with a batch: its marks leave the notes.
  async function finishBatch(id) {
    const batch = await store.changeBatch(string(id, 100), (b) => {
      b.done = new Date().toISOString();
      return b;
    });
    for (const file of new Set(batch.marks.map((m) => m.file)))
      await store
        .changeMarks(file, (doc) => {
          doc.marks = doc.marks.filter((m) => m.batch !== batch.id);
        })
        .catch(() => {});
    return marksState();
  }

  const waiting = async () =>
    (await store.list()).filter((p) => p.status === "pending" && !isLapsed(p));
  // What the page shows of a proposal.
  const shown = (p) => ({
    id: p.id,
    kind: p.kind,
    summary: p.summary,
    client: p.client,
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
    close: () => watchers.forEach((w) => w.close()),
    handlers: {
      marks: marksState,
      changeMark,
      sendMarks,
      finishBatch,
      // The note a mark is on, opened as any note.
      async openMarked(id) {
        for (const note of await store.allMarks())
          if (note.marks.some((m) => m.id === id)) return openFile(note.file);
        for (const batch of await store.listBatches()) {
          const mark = batch.marks.find((m) => m.id === id);
          if (mark) return openFile(mark.file);
        }
        throw Error(t("这条标记已不存在"));
      },
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
      decideProposal: decide,
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
      aiSetup: () => ({
        command: executable,
        args: [script],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      }),
    },
  };
}
