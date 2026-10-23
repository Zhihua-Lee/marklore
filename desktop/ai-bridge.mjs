// The app's side of AI proposals (the MCP server is desktop/mcp.mjs): keeps
// access.json in step with the libraries ticked in Settings → AI assistant,
// tells the page when proposals arrive, and carries out the owner's decision.
// An accepted edit is applied by the page to the open note (so it can be
// undone, and saves as any edit does); an accepted new note is written here.
// Comment threads are read and written here for the page, under the same
// lock as the server's (ai-store.mjs).
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

// notify(kind): "proposals" or "comments" changed on disk. pathOf: a note's
// path from the page's file id.
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
    for (const [kind, folder] of [
      ["proposals", store.proposals],
      ["comments", store.comments],
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
  // The page's actions on a note's threads; the owner's own words are "owner".
  async function changeComment(fileId, action, args = {}) {
    const file = pathOf(fileId),
      now = new Date().toISOString();
    return store.changeComments(file, (doc) => {
      if (action === "add") {
        if (doc.threads.length >= 500) throw Error(t("无效操作"));
        doc.threads.push({
          id: newId(),
          quote: string(args.quote, 1000),
          prefix: string(args.prefix ?? "", 100),
          suffix: string(args.suffix ?? "", 100),
          by: "owner",
          created: now,
          resolved: false,
          messages: [{ by: "owner", text: string(args.text, 5000), at: now }],
        });
        return doc.threads;
      }
      const thread = doc.threads.find((x) => x.id === args.id);
      if (!thread) throw Error(t("这条批注已不存在"));
      if (action === "reply") {
        if (thread.messages.length >= 200) throw Error(t("无效操作"));
        thread.messages.push({
          by: "owner",
          text: string(args.text, 5000),
          at: now,
        });
        // An answer reopens a settled thread.
        thread.resolved = false;
      } else if (action === "resolve") {
        thread.resolved = args.resolved !== false;
        thread.resolvedBy = "owner";
      } else if (action === "remove")
        doc.threads.splice(doc.threads.indexOf(thread), 1);
      else throw Error(t("无效操作"));
      return doc.threads;
    });
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
    ...(p.kind === "edit" ? { edits: p.edits } : { text: p.text }),
  });
  async function decide(id, { status, saved, error } = {}) {
    if (!["accepted", "rejected", "failed"].includes(status))
      throw Error(t("无效操作"));
    return shown(
      await store.decide(id, () => ({
        status,
        ...(status === "accepted" ? { saved: saved === true } : {}),
        ...(status === "failed" && typeof error === "string"
          ? { error: error.slice(0, 500) }
          : {}),
      })),
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
      comments: async (fileId) =>
        (await store.commentsOf(pathOf(fileId))).threads,
      changeComment,
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
