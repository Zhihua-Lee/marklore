// Renaming and moving notes and folders with the links that lead to them:
// which notes would change (asked before), the move itself (FileStore), the
// links written again in every note concerned, each file backed up first,
// and one batch remembered so that "undo last rename/move" puts it all back.
// Notes open with unsaved changes are never written here: the page applies
// the same rewrite (desktop/link-rewrite.mjs) to their drafts.
import fs from "node:fs/promises";
import path from "node:path";
import { decode, markdownPath, hash } from "./files.mjs";
import { rewriteLinks } from "./link-rewrite.mjs";
import { skippedName } from "./scan-rules.mjs";
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
  // The notes at or under these paths: a note itself, and every note in a
  // folder (.txt too, and those the link index has not read), walked on
  // disk by the library's rules, at most 5000.
  async function notesUnder(paths) {
    const out = new Map();
    const queue = [];
    for (const p of paths) {
      if (markdownPath(p)) out.set(key(p), p);
      else queue.push(p);
    }
    let visited = 0;
    while (queue.length && out.size < 5000 && visited++ < 20000) {
      const folder = queue.shift();
      let entries;
      try {
        entries = await fs.readdir(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (skippedName(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) queue.push(full);
        else if (markdownPath(entry.name)) out.set(key(full), full);
      }
    }
    return [...out.values()];
  }
  // The words a link to these entries holds: their names, as written plain
  // or percent-encoded.
  // Spaces alone may be encoded (as OneNote exports and index files write
  // links: "My%20page.md"), with other characters as they are.
  const wordsFor = (moves) =>
    moves.flatMap(([from]) => {
      const name = path.basename(from);
      return [
        ...new Set([
          name,
          encodeURIComponent(name),
          encodeURI(name),
          name.replace(/ /g, "%20"),
        ]),
      ];
    });
  // The notes whose links may change: the notes moved (their own relative
  // links), those the link index has linking to one of them, and any other
  // note whose text names an entry moved (a reference definition, HTML, an
  // image, an attachment, a folder: links the index does not record).
  // Asked before the move, while the index still has the old paths; the
  // rewrite itself decides which links really change.
  // anchors: headings renamed ([{ source, ... }]): the note and the notes
  // linking to it.
  async function candidates(moves, anchors = []) {
    const moved = await notesUnder(moves.map(([from]) => from));
    const out = new Map(moved.map((p) => [key(p), p]));
    for (const anchor of anchors)
      if (anchor.source) out.set(key(anchor.source), anchor.source);
    for (const note of [...moved, ...anchors.map((a) => a.source)])
      for (const link of await linkIndex.backlinks(note).catch(() => []))
        out.set(key(link.source), link.source);
    if (moves.length)
      for (const file of await linkIndex.containing(wordsFor(moves)))
        out.set(key(file), file);
    return [...out.values()];
  }
  // Anchors as the rewrite takes them: where the note is after the moves.
  const anchorsAfter = (anchors, moves) =>
    anchors.map((a) => ({ ...a, file: movedPath(a.source || a.file, moves) }));
  async function readText(file) {
    try {
      return decode(await files.readBytes(file)).text;
    } catch {
      return null;
    }
  }
  // Before a rename or move: the notes whose links would change, and how
  // many links in each. skip: index files the move updates anyway.
  async function plan(moves, { skip = [], anchors = [] } = {}) {
    const skipped = new Set(skip.map(key));
    const affected = [];
    const after = anchorsAfter(anchors, moves);
    for (const file of await candidates(moves, anchors)) {
      if (skipped.has(key(file))) continue;
      const text = await readText(file);
      if (text === null) continue;
      const { count } = rewriteLinks(text, {
        from: file,
        file: movedPath(file, moves),
        moves,
        anchors: after,
      });
      if (count)
        affected.push({ path: file, name: path.basename(file), links: count });
    }
    affected.sort((a, b) =>
      a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
    );
    // Some notes may not be read yet: the question says so.
    affected.indexing = Boolean(linkIndex.indexing);
    return affected;
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
  // anchors: headings renamed ([{ source, from, to }]), their links too.
  async function run({
    label,
    moves,
    links = true,
    drafts = [],
    anchors = [],
    perform,
  }) {
    const draft = new Set(drafts.map(key));
    const list = links ? await candidates(moves, anchors) : [];
    const done = await perform();
    const after = anchorsAfter(done.anchors || anchors, done.moves);
    const writes = [];
    const failed = [];
    for (const index of done.indexes) {
      if (index.error) failed.push({ path: null, error: index.error });
      else if (!index.draft) writes.push(index);
    }
    let rewritten = 0;
    // Drafts the page patches: remembered, so that undo can put back one
    // saved in the meantime.
    const patched = [];
    for (const file of list) {
      const now = movedPath(file, done.moves);
      if (draft.has(key(file))) {
        patched.push({ path: now, from: file });
        continue;
      }
      try {
        const write = await files.rewrite(
          now,
          (text) =>
            rewriteLinks(text, {
              from: file,
              file: now,
              moves: done.moves,
              anchors: after,
            }).text,
        );
        if (write) {
          writes.push(write);
          rewritten++;
        }
      } catch (error) {
        failed.push({ path: now, error: error.message });
      }
    }
    if (done.moves.length || writes.length)
      await remember({
        label,
        at: new Date().toISOString(),
        moves: done.moves,
        writes,
        links: Boolean(links),
        patched,
      });
    await synced(
      done.moves,
      writes.map((w) => w.path),
    );
    return {
      ...done,
      anchors: after,
      // Index files and the note's own name written (not counted above).
      updated: done.indexes.filter((w) => !w.draft && !w.error).length,
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
    // Nothing being saved under the entries or the files to put back.
    for (const [, to] of batch.moves) files.checkUnlocked(to);
    for (const write of batch.writes) files.checkUnlocked(write.path);
    // The entries first, all or none: a failure halfway moves back what
    // had moved, and the batch stays to be tried again.
    const back = [...batch.moves].reverse().map(([from, to]) => [to, from]);
    const moved = [];
    const done = [];
    try {
      for (const [from, to] of back) {
        moved.push(...(await relocate(from, to)));
        done.push([from, to]);
      }
    } catch (error) {
      for (const [from, to] of done.reverse())
        await relocate(to, from).catch(() => {});
      throw error;
    }
    // Then each file rewritten, where it is now.
    const restored = [];
    const skipped = [];
    for (const write of [...batch.writes].reverse()) {
      const now = movedPath(write.path, back);
      const ok =
        !draft.has(key(write.path)) &&
        !draft.has(key(now)) &&
        (await files.restore(now, write).catch(() => false));
      (ok ? restored : skipped).push(now);
    }
    // Notes the batch created (a repair): taken away again while they are
    // as it left them; one written to since stays, and is named.
    for (const made of batch.creates || []) {
      const bytes = await files.readBytes(made.path).catch(() => null);
      if (bytes && hash(bytes) === made.after) {
        files.checkUnlocked(made.path);
        await fs.rm(made.path, { force: true });
        restored.push(made.path);
      } else if (bytes) skipped.push(made.path);
    }
    // Drafts patched by the page and saved since: their links written back
    // (one still unsaved is the page's to patch back).
    for (const note of batch.patched || []) {
      const now = movedPath(note.path, back);
      if (draft.has(key(note.path)) || draft.has(key(now))) continue;
      const write = await files
        .rewrite(
          now,
          (text) =>
            rewriteLinks(text, { from: note.path, file: now, moves: back })
              .text,
        )
        .catch(() => null);
      if (write) restored.push(now);
    }
    await remember(null);
    await synced(back, restored);
    return {
      label: batch.label,
      links: batch.links !== false,
      moves: back,
      files: moved,
      restored: [...new Set(restored)],
      skipped: [...new Set(skipped)],
    };
  }

  return {
    plan,
    run,
    undo,
    // A change made elsewhere (a repair: links rewritten, a note created)
    // remembered as the batch undo takes back; synced like a move.
    async record({ label, writes = [], creates = [] }) {
      if (!writes.length && !creates.length) return;
      await remember({
        label,
        at: new Date().toISOString(),
        moves: [],
        writes,
        creates,
        links: true,
        patched: [],
      });
      await synced(
        [],
        [...writes, ...creates].map((w) => w.path),
      );
    },
    // What undo would take back: { label, at } or null.
    async last() {
      const batch = await readLast();
      return batch ? { label: batch.label, at: batch.at } : null;
    },
  };
}
