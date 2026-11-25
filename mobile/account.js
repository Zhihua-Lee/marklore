// `account` from README.md: sign-in state, folder choice and sync.
import { applyDelta, planSync } from "./delta.js";

const CONCURRENCY = 4;

export function createAccount({ auth, graph, internal, onError = () => {} }) {
  const listeners = { status: new Set(), progress: new Set() };
  const emit = (kind, value) => listeners[kind].forEach((fn) => fn(value));
  const on = (kind) => (fn) => (
    listeners[kind].add(fn),
    () => listeners[kind].delete(fn)
  );
  let folder = null;
  let syncing = null;

  const account = {
    status: () => ({
      configured: auth.configured(),
      signedIn: auth.signedIn(),
      user: auth.user(),
      folder,
      syncing: Boolean(syncing),
    }),
    onStatus: on("status"),
    onProgress: on("progress"),
    setClientId(id) {
      auth.setClientId(id);
      emit("status", account.status());
    },
    signIn: () => auth.signIn(),
    signOut() {
      auth.signOut();
      emit("status", account.status());
    },
    folders: (parentId) => graph.folders(parentId ?? null),
    async chooseFolder(next) {
      if (folder?.id !== next.id) await internal.clear();
      folder = { id: next.id, name: next.name, path: next.path };
      await internal.setMeta("folder", folder);
      internal.changed();
      emit("status", account.status());
      return account.sync();
    },
    sync() {
      if (!syncing)
        syncing = run().finally(() => {
          syncing = null;
          emit("status", account.status());
        });
      emit("status", account.status());
      return syncing;
    },
  };

  async function run() {
    if (!folder) throw new Error("还没有选择文件夹");
    const progress = (phase, done = 0, total = 0, message = "") =>
      emit("progress", { phase, done, total, message });
    try {
      progress("listing");
      const items = new Map(
        Object.entries((await internal.getMeta("items", {})) || {}),
      );
      let link = await internal.getMeta("delta", null);
      // A listing from the start reports only what exists now: rebuild the map,
      // so files deleted meanwhile drop out (planSync removes them).
      if (!link) items.clear();
      let page;
      try {
        ({ items: page, deltaLink: link } = await graph.delta(folder.id, link));
      } catch (e) {
        if (e.status === 410) {
          // The delta link expired: start over from a full listing.
          items.clear();
          ({ items: page, deltaLink: link } = await graph.delta(
            folder.id,
            null,
          ));
        } else if (
          [400, 403, 404, 501].includes(e.status) &&
          e.code !== "itemNotFound"
        ) {
          // Delta below the root is not offered (work or school accounts).
          items.clear();
          page = await graph.walk(folder.id);
          link = null;
        } else throw e;
      }
      applyDelta(items, page, folder.id);
      const plan = planSync(items, folder.id, await internal.stored());
      for (const { id, to } of plan.move) await internal.move(id, to);
      for (const { id } of plan.remove) await internal.remove(id);
      let done = 0;
      const total = plan.download.length;
      progress("downloading", 0, total);
      const queue = [...plan.download];
      const failures = [];
      await Promise.all(
        Array.from(
          { length: Math.min(CONCURRENCY, queue.length) },
          async () => {
            while (queue.length) {
              const file = queue.shift();
              try {
                const blob = await graph.download(file.id);
                const content =
                  file.kind === "note"
                    ? (await blob.text()).replace(/^﻿/, "")
                    : blob;
                await internal.put(file, content);
              } catch (e) {
                if (e.code === "signin_required") throw e;
                // Not stored, so the next sync (a full listing) downloads it again.
                failures.push(file.path);
              }
              progress("downloading", ++done, total, file.path);
            }
          },
        ),
      );
      await internal.setMeta("items", Object.fromEntries(items));
      // Keep the delta link only when everything arrived; else list again next time.
      await internal.setMeta("delta", failures.length ? null : link);
      await internal.setMeta("meta", {
        folderName: folder.name,
        lastSync: Date.now(),
      });
      if (navigator.storage?.persist)
        navigator.storage.persist().catch(() => {});
      internal.changed();
      const added = plan.download.length;
      progress(
        "done",
        total,
        total,
        failures.length
          ? `${failures.length} 个文件没下载成功，下次同步会重试`
          : "",
      );
      return {
        added,
        changed: plan.move.length,
        removed: plan.remove.length,
        failed: failures,
      };
    } catch (e) {
      progress("error", 0, 0, e.message);
      onError(e);
      emit("status", account.status());
      throw e;
    }
  }

  account.ready = (async () => {
    folder = await internal.getMeta("folder", null);
  })();
  return account;
}
