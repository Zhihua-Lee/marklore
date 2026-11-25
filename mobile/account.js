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
  // Off: images are downloaded when a note shows them. On: every sync keeps
  // all of them on the phone for reading offline.
  let allImages = false;

  const account = {
    status: () => ({
      configured: auth.configured(),
      signedIn: auth.signedIn(),
      user: auth.user(),
      folder,
      syncing: Boolean(syncing),
      offlineImages: allImages,
    }),
    async setOfflineImages(on) {
      allImages = Boolean(on);
      await internal.setMeta("allImages", allImages);
      emit("status", account.status());
      if (allImages && folder && auth.signedIn())
        await account.sync().catch(() => {});
    },
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
      // Found so far, so a long listing shows it is moving.
      const listed = (n) => progress("listing", n);
      const items = new Map(
        Object.entries((await internal.getMeta("items", {})) || {}),
      );
      let link = await internal.getMeta("delta", null);
      // A listing from the start reports only what exists now: rebuild the map,
      // so files deleted meanwhile drop out (planSync removes them).
      if (!link) items.clear();
      let page;
      try {
        ({ items: page, deltaLink: link } = await graph.delta(
          folder.id,
          link,
          listed,
        ));
      } catch (e) {
        if (e.status === 410) {
          // The delta link expired: start over from a full listing.
          items.clear();
          ({ items: page, deltaLink: link } = await graph.delta(
            folder.id,
            null,
            listed,
          ));
        } else if (
          [400, 403, 404, 501].includes(e.status) &&
          e.code !== "itemNotFound"
        ) {
          // Delta below the root is not offered (work or school accounts).
          items.clear();
          page = await graph.walk(folder.id, listed);
          link = null;
        } else throw e;
      }
      applyDelta(items, page, folder.id);
      const stored = await internal.stored();
      const plan = planSync(items, folder.id, stored);
      for (const { id, to } of plan.move) await internal.move(id, to);
      for (const { id } of plan.remove) await internal.remove(id);
      // Notes always come down. A new or changed image is only listed, unless
      // it was on the phone already or all images are kept offline; with that
      // on, images listed earlier come down too.
      const toFetch = [];
      const listOnly = [];
      for (const file of plan.download)
        (file.kind === "image" && !allImages && !stored.get(file.id)?.local
          ? listOnly
          : toFetch
        ).push(file);
      if (allImages) {
        const planned = new Set(plan.download.map((f) => f.id));
        const removed = new Set(plan.remove.map((f) => f.id));
        const movedTo = new Map(plan.move.map((m) => [m.id, m.to]));
        for (const [id, before] of stored)
          if (
            before.kind === "image" &&
            !before.local &&
            !planned.has(id) &&
            !removed.has(id) &&
            items.has(id)
          )
            toFetch.push({
              id,
              path: movedTo.get(id) || before.path,
              ...items.get(id),
            });
      }
      for (const file of listOnly) await internal.put(file, null);
      let done = 0;
      const total = toFetch.length;
      progress("downloading", 0, total);
      const queue = [...toFetch];
      const failures = [];
      let notesFailed = false;
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
                failures.push(file.path);
                // A note not stored is listed again next time (no delta
                // link); an image stays listed and is fetched when shown or
                // by the next sync that keeps all images.
                if (file.kind === "image") await internal.put(file, null);
                else notesFailed = true;
              }
              progress("downloading", ++done, total, file.path);
            }
          },
        ),
      );
      await internal.setMeta("items", Object.fromEntries(items));
      // Keep the delta link only when everything arrived; else list again next time.
      await internal.setMeta("delta", notesFailed ? null : link);
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
    allImages = Boolean(await internal.getMeta("allImages", false));
  })();
  return account;
}
