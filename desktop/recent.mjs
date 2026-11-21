import fs from "node:fs/promises";
import path from "node:path";
import { movedPath, within } from "./moved-path.mjs";

// Recently opened notes for the start page and the Windows jump list. Only
// paths the main process itself opened are recorded, and the renderer can
// reopen an entry only by naming a path that is on this list.
export function createRecentFiles({ file, limit = 12, jumpList = null }) {
  let entries = null;
  let writing = Promise.resolve();

  async function load() {
    if (entries) return entries;
    try {
      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      entries = Array.isArray(saved)
        ? saved.filter((p) => typeof p === "string" && path.isAbsolute(p))
        : [];
    } catch {
      entries = [];
    }
    return entries.slice(0, limit);
  }
  function persist() {
    const snapshot = JSON.stringify(entries);
    writing = writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, snapshot, "utf8");
      });
    updateJumpList();
    return writing;
  }
  function updateJumpList() {
    if (!jumpList) return;
    try {
      jumpList(entries.slice(0, 8));
    } catch {
      /* Shell integration is best effort. */
    }
  }
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  return {
    async add(p) {
      await load();
      entries = [p, ...entries.filter((e) => !same(e, p))].slice(0, limit);
      return persist();
    },
    // Existing files only; vanished ones are dropped from the list for good.
    async list() {
      await load();
      const present = [];
      for (const p of entries) {
        try {
          if ((await fs.stat(p)).isFile()) present.push(p);
        } catch {
          /* Moved or deleted. */
        }
      }
      if (present.length !== entries.length) {
        entries = present;
        await persist();
      }
      return present.map((p) => ({
        path: p,
        name: path.basename(p),
        folder: path.dirname(p),
      }));
    },
    async has(p) {
      await load();
      return entries.some((e) => same(e, p));
    },
    // Notes renamed or moved in Marklore ([[old, new]] of notes or folders)
    // keep their place in the list, under the new path.
    async rename(moves) {
      await load();
      const next = [];
      for (const p of entries) {
        const moved = movedPath(p, moves);
        if (!next.some((e) => same(e, moved))) next.push(moved);
      }
      if (next.join("\n") === entries.join("\n")) return;
      entries = next;
      return persist();
    },
    // Notes (or folders of them) gone to the Recycle Bin.
    async remove(paths) {
      await load();
      const next = entries.filter(
        (p) => !paths.some((gone) => within(p, gone)),
      );
      if (next.length === entries.length) return;
      entries = next;
      return persist();
    },
    async clear() {
      await load();
      entries = [];
      return persist();
    },
    async refreshJumpList() {
      await load();
      updateJumpList();
    },
  };
}
