// Renaming and moving notes and folders with the links that lead to them:
// which notes would change (asked before), the move itself (FileStore), the
// links written again in every note concerned, each file backed up first,
// and one batch remembered so that "undo last rename/move" puts it all back.
// Notes open with unsaved changes are never written here: the page applies
// the same rewrite (desktop/link-rewrite.mjs) to their drafts.
import fs from "node:fs/promises";
import path from "node:path";
import { decode, markdownPath } from "./files.mjs";
import { rewriteLinks, isUnder } from "./link-rewrite.mjs";
import { movedPath } from "./moved-path.mjs";
import { t } from "./i18n.mjs";

export { movedPath };
const key = (p) => path.resolve(p).toLowerCase();

// files: the FileStore; linkIndex: the library's link index (backlinks and
// the notes it knows); undoFile: where the last batch is kept; synced(moves,
// written): after a move or its undo, for the rest of the app to follow.
export function createNoteMoves({
  files,
  linkIndex,
  undoFile,
  synced = async () => {},
}) {
  // The notes at or under these paths: those the link index knows, and the
  // paths themselves when they are notes.
  async function notesUnder(paths) {
    const known = (await linkIndex.notes()).map((note) => note.path);
    const out = new Map();
    for (const p of paths) {
      if (markdownPath(p)) out.set(key(p), p);
      for (const note of known) if (isUnder(note, p)) out.set(key(note), note);
    }
    return [...out.values()];
  }
  // The notes whose links may change: those that link to a note moved, and
  // the notes moved (their own relative links). Asked before the move,
  // while the index still has the old paths.
  async function candidates(moves) {
    const moved = await notesUnder(moves.map(([from]) => from));
    const out = new Map(moved.map((p) => [key(p), p]));
    for (const note of moved)
      for (const link of await linkIndex.backlinks(note).catch(() => []))
        out.set(key(link.source), link.source);
    return [...out.values()];
  }
  async function readText(file) {
    try {
      return decode(await files.readBytes(file)).text;
    } catch {
      return null;
    }
  }
  // Before a rename or move: the notes whose links would change, and how
  // many links in each. skip: index files the move updates anyway.
  async function plan(moves, { skip = [] } = {}) {
    const skipped = new Set(skip.map(key));
    const affected = [];
    for (const file of await candidates(moves)) {
      if (skipped.has(key(file))) continue;
      const text = await readText(file);
      if (text === null) continue;
      const { count } = rewriteLinks(text, {
        from: file,
        file: movedPath(file, moves),
        moves,
      });
      if (count)
        affected.push({ path: file, name: path.basename(file), links: count });
    }
    return affected.sort((a, b) =>
      a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
    );
  }

  let last; // the batch to undo, once read
  async function readLast() {
    if (last !== undefined) return last;
    try {
      last = JSON.parse(await fs.readFile(undoFile, "utf8"));
      if (!Array.isArray(last?.moves) || !Array.isArray(last?.writes))
        last = null;
    } catch {
      last = null;
    }
    return last;
  }
  async function remember(batch) {
    last = batch;
    await fs.mkdir(path.dirname(undoFile), { recursive: true });
    if (batch) await fs.writeFile(undoFile, JSON.stringify(batch), "utf8");
    else await fs.rm(undoFile, { force: true });
  }

  // A rename or move: moves, the [[old, new]] it is about to make;
  // perform() makes them (FileStore renameEntry or moveEntry: { path,
  // files, moves, indexes }); then, with links, every note concerned is
  // rewritten. drafts: paths of notes open with unsaved changes, left to
  // the page. Returns what perform() did, plus how many notes were
  // rewritten, the index edits left to drafts and what failed.
  async function run({ label, moves, links = true, drafts = [], perform }) {
    const draft = new Set(drafts.map(key));
    const list = links ? await candidates(moves) : [];
    const done = await perform();
    const writes = [];
    const failed = [];
    for (const index of done.indexes) {
      if (index.error) failed.push({ path: null, error: index.error });
      else if (!index.draft) writes.push(index);
    }
    let rewritten = 0;
    for (const file of list) {
      if (draft.has(key(file))) continue;
      const now = movedPath(file, done.moves);
      try {
        const write = await files.rewrite(
          now,
          (text) =>
            rewriteLinks(text, { from: file, file: now, moves: done.moves })
              .text,
        );
        if (write) {
          writes.push(write);
          rewritten++;
        }
      } catch (error) {
        failed.push({ path: now, error: error.message });
      }
    }
    if (done.moves.length)
      await remember({
        label,
        at: new Date().toISOString(),
        moves: done.moves,
        writes,
      });
    await synced(
      done.moves,
      writes.map((w) => w.path),
    );
    return {
      ...done,
      indexes: undefined,
      drafts: done.indexes.filter((index) => index.draft),
      rewritten,
      failed,
    };
  }

  // The last rename or move undone: each file rewritten put back (unless
  // changed since, or open with unsaved changes: skipped and named), then
  // the entries moved back. relocate(source, target) moves one entry
  // (FileStore.relocate, inside the caller's watcher handling).
  async function undo({ drafts = [], relocate }) {
    const batch = await readLast();
    if (!batch) throw Error(t("没有可撤销的改名或移动"));
    const draft = new Set(drafts.map(key));
    // Every entry still where the batch put it, its old place still free.
    for (const [from, to] of batch.moves) {
      const there = await fs.lstat(to).then(
        () => true,
        () => false,
      );
      const free =
        key(from) === key(to) ||
        (await fs.lstat(from).then(
          () => false,
          () => true,
        ));
      if (!there || !free)
        throw Error(
          t("无法撤销：“{name}”已被移动、改名或占用", {
            name: path.basename(there ? from : to),
          }),
        );
    }
    const restored = [];
    const skipped = [];
    for (const write of [...batch.writes].reverse()) {
      const ok =
        !draft.has(key(write.path)) &&
        (await files.restore(write.path, write).catch(() => false));
      (ok ? restored : skipped).push(write.path);
    }
    const back = [...batch.moves].reverse().map(([from, to]) => [to, from]);
    const moved = [];
    for (const [from, to] of back) moved.push(...(await relocate(from, to)));
    await remember(null);
    await synced(back, restored);
    return {
      label: batch.label,
      moves: back,
      files: moved,
      restored: [...new Set(restored)].map((p) => movedPath(p, back)),
      skipped: [...new Set(skipped)].map((p) => movedPath(p, back)),
    };
  }

  return {
    plan,
    run,
    undo,
    // What undo would take back: { label, at } or null.
    async last() {
      const batch = await readLast();
      return batch ? { label: batch.label, at: batch.at } : null;
    },
  };
}
