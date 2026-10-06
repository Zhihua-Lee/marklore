// File names of notes in folders outside the library (the open note's
// folder, say a home folder on an SSHFS drive), for the search box. Walking
// such a folder over a network takes minutes, so it is walked once in the
// background, breadth first and by the library's rules, and each search
// filters the names found so far. A walk is redone after five minutes or
// when the excluded folders change.
import fs from "node:fs/promises";
import path from "node:path";
import { NOTE, skippedName, isEnvironment } from "./scan-rules.mjs";
import { parseQuery } from "./note-search.mjs";

const bare = (name) => name.replace(NOTE, "").toLowerCase();

export function createNameWalks({
  readdir = fs.readdir,
  onProgress = null,
  maxFolders = 10000,
  maxAge = 5 * 60 * 1000,
  budget = 250,
} = {}) {
  const walks = new Map(); // root (lower case) -> walk
  function start(root, excluded, excludedKey) {
    const walk = {
      root,
      excludedKey,
      started: Date.now(),
      notes: [],
      done: false,
      cancelled: false,
    };
    walk.promise = (async () => {
      const queue = [{ folder: root, top: true }];
      let visited = 0,
        last = Date.now();
      while (queue.length && visited < maxFolders && !walk.cancelled) {
        const { folder, top } = queue.shift();
        visited++;
        let entries;
        try {
          entries = await readdir(folder, { withFileTypes: true });
        } catch {
          continue;
        }
        if (!top && isEnvironment(entries.map((entry) => entry.name))) continue;
        for (const entry of entries) {
          if (entry.isSymbolicLink() || skippedName(entry.name)) continue;
          const full = path.join(folder, entry.name);
          if (excluded(full)) continue;
          if (entry.isDirectory()) queue.push({ folder: full, top: false });
          else if (NOTE.test(entry.name))
            walk.notes.push({ name: entry.name, path: full, folder });
        }
        if (Date.now() - last > 1000) {
          last = Date.now();
          onProgress?.();
        }
      }
      walk.done = true;
      if (!walk.cancelled) onProgress?.();
    })();
    walks.set(root.toLowerCase(), walk);
    return walk;
  }
  return {
    // Notes whose names hold every word of the query. Waits a moment so a
    // small folder answers in full; a large one answers with what it has.
    async search(
      roots,
      query,
      { excluded = () => false, excludedKey = "", limit = 200 } = {},
    ) {
      const terms = parseQuery(query);
      let started = false;
      const active = roots.map((root) => {
        let walk = walks.get(root.toLowerCase());
        const stale =
          walk &&
          (walk.excludedKey !== excludedKey ||
            (walk.done && Date.now() - walk.started > maxAge));
        if (stale) walk.cancelled = true;
        if (!walk || stale) {
          walk = start(root, excluded, excludedKey);
          started = true;
        }
        return walk;
      });
      // Only a walk just begun is waited for; later searches answer at once.
      if (started)
        await Promise.race([
          Promise.all(active.map((walk) => walk.promise)),
          new Promise((resolve) => setTimeout(resolve, budget)),
        ]);
      const items = [];
      const scanning = active.some((walk) => !walk.done);
      if (terms.length)
        for (const walk of active)
          for (const note of walk.notes) {
            if (excluded(note.path)) continue;
            const name = bare(note.name);
            if (!terms.every((term) => name.includes(term))) continue;
            items.push(note);
            if (items.length >= limit)
              return { items, truncated: true, scanning };
          }
      return { items, truncated: false, scanning };
    },
  };
}
