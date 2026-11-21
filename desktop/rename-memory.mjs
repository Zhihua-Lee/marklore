// Renames and moves seen recently, so that a link or index entry left
// pointing at a missing note can be offered the place it went. Two sources:
// Marklore's own renames and moves (certain), and the library watcher,
// which reports a rename only as an entry gone and an entry come. Those are
// paired only when it is unambiguous: one entry gone and one come within a
// short time, in the same folder (a rename) or with the same name (a move),
// and no other entry they could pair with. Nothing is ever rewritten from
// here: it only suggests.
import path from "node:path";
import fs from "node:fs/promises";
import { movedTo } from "./moved-path.mjs";

const key = (p) => path.resolve(p).toLowerCase();
const ext = (p) => path.extname(p).toLowerCase();

// exists(path): whether the entry is there now (the watcher does not say).
export function createRenameMemory({
  now = Date.now,
  window = 2000,
  keep = 60 * 60e3,
  limit = 300,
  exists = (p) =>
    fs.lstat(p).then(
      () => true,
      () => false,
    ),
} = {}) {
  let gone = [], // { path, at }
    come = [];
  // Known renames, oldest first: [{ from, to, at, own }].
  let renames = [];
  const fresh = (list, t) => list.filter((e) => t - e.at <= window);
  const pairs = (a, b) =>
    key(a.path) !== key(b.path) &&
    ext(a.path) === ext(b.path) &&
    (key(path.dirname(a.path)) === key(path.dirname(b.path)) ||
      path.basename(a.path).toLowerCase() ===
        path.basename(b.path).toLowerCase());
  function remember(from, to, own) {
    renames = renames.filter(
      (r) => now() - r.at <= keep && key(r.from) !== key(from),
    );
    renames.push({ from, to, at: now(), own });
    if (renames.length > limit) renames.splice(0, renames.length - limit);
  }
  // Pairs what can be paired without doubt; the rest waits for its window.
  function settle() {
    const t = now();
    gone = fresh(gone, t);
    come = fresh(come, t);
    for (const g of [...gone]) {
      const matches = come.filter((c) => pairs(g, c));
      if (matches.length !== 1) continue;
      const c = matches[0];
      if (gone.filter((other) => pairs(other, c)).length !== 1) continue;
      remember(g.path, c.path, false);
      gone = gone.filter((e) => e !== g);
      come = come.filter((e) => e !== c);
    }
  }
  return {
    // The watcher saw an entry renamed (gone or come: looked up now).
    async observe(file) {
      const at = now();
      const there = await exists(file);
      const list = there ? come : gone;
      if (!list.some((e) => key(e.path) === key(file)))
        list.push({ path: file, at });
      settle();
    },
    // Marklore renamed or moved these ([[old, new]]).
    record(moves) {
      for (const [from, to] of moves) remember(from, to, true);
    },
    // Where a missing path may be now: followed through later renames
    // (a folder renamed carries what was in it); null when unknown.
    lookup(missing) {
      const t = now();
      let at = missing;
      const seen = new Set();
      for (;;) {
        let next = null;
        for (const r of [...renames].reverse()) {
          if (t - r.at > keep) continue;
          const moved = movedTo(at, [[r.from, r.to]]);
          if (moved) {
            next = moved;
            break;
          }
        }
        if (!next || seen.has(key(next))) break;
        seen.add(key(next));
        at = next;
      }
      return key(at) === key(missing) ? null : at;
    },
  };
}
