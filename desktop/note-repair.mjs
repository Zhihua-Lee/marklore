// Repair after changes made outside Marklore (git, an AI tool, a OneNote
// re-export, Explorer): a link or index entry left pointing at a note that
// is gone. Nothing is guessed and rewritten by itself: the reader asks for
// a repair and chooses where the link should lead (a note found by name,
// or one seen renamed), to take the link away, or to create the missing
// note. Each repair is backed up and undone like a rename or move.
// The same calls serve a broken link in a note and a missing entry in a
// folder's index (the tree, and the index's own view).
import fs from "node:fs/promises";
import path from "node:path";
import { markdownPath, within, realPath, hash, decode } from "./files.mjs";
import { rewriteLinks, unlinkTarget, linkTarget } from "./link-rewrite.mjs";
import {
  isIndexName,
  parseIndex,
  childName,
  renameInIndex,
  removeEntriesTo,
} from "./folder-index.mjs";
import { skippedName, isEnvironment } from "./scan-rules.mjs";
import { t } from "./i18n.mjs";

const key = (p) => path.resolve(p).toLowerCase();
const samePath = (a, b) => key(a) === key(b);
const exists = (p) =>
  fs.lstat(p).then(
    () => true,
    () => false,
  );
// A link from a note's folder to a path, as the reader would write it.
const relHref = (note, p) =>
  path.relative(path.dirname(note), p).split(path.sep).join("/");

// files: the FileStore; renames: the rename memory; linkIndex: notes known
// by name; noteMoves: where a repair is remembered for undo; roots(): the
// library's folders.
export function createNoteRepair({
  files,
  renames,
  linkIndex,
  noteMoves,
  roots = () => [],
}) {
  const inLibrary = (p) => roots().some((root) => within(root, p));
  // A note a repair may change: open, or in the library; never through a
  // link to somewhere else.
  async function noteOf(file) {
    if (
      typeof file !== "string" ||
      !path.isAbsolute(file) ||
      !markdownPath(file)
    )
      throw Error(t("未授权的文件"));
    const real = await realPath(file);
    if (!samePath(real, file))
      throw Error(t("文件或文件夹路径已改变，请重新打开"));
    const open = [...files.files.values()].some((f) => samePath(f.path, real));
    if (!open && !inLibrary(real)) throw Error(t("未授权的文件"));
    return real;
  }
  function targetOf(note, href) {
    if (typeof href !== "string" || !href || href.length > 8192)
      throw Error(t("无效链接"));
    const to = linkTarget(href, note);
    if (!to) throw Error(t("无效链接"));
    return path.resolve(to);
  }
  // Files with this name in the library's folders (any case), walked by
  // the library's rules; notes come from the link index.
  async function sameName(name, limit = 20) {
    const lower = name.toLowerCase();
    if (markdownPath(name))
      return (await linkIndex.notes())
        .map((note) => note.path)
        .filter((p) => path.basename(p).toLowerCase() === lower)
        .slice(0, limit);
    const out = [];
    const queue = roots().map((folder) => ({ folder, top: true }));
    let visited = 0;
    while (queue.length && out.length < limit && visited++ < 20000) {
      const { folder, top } = queue.shift();
      let entries;
      try {
        entries = await fs.readdir(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      if (!top && isEnvironment(entries.map((e) => e.name))) continue;
      for (const entry of entries) {
        if (skippedName(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) queue.push({ folder: full, top: false });
        else if (entry.name.toLowerCase() === lower) out.push(full);
      }
    }
    return out;
  }
  // Where a missing target may be now: seen renamed (watcher or Marklore),
  // the same name elsewhere in the library, and for an index entry the
  // notes of its folder the index does not list. Each { path, name, rel,
  // reason: "renamed" | "same-name" | "unlisted" }.
  async function candidates(note, target, text = null) {
    const out = [];
    const add = (p, reason) => {
      if (samePath(p, target) || out.some((c) => samePath(c.path, p))) return;
      out.push({
        path: p,
        name: path.basename(p),
        rel: relHref(note, p),
        reason,
      });
    };
    const renamed = renames.lookup(target);
    if (renamed && (await exists(renamed))) add(renamed, "renamed");
    for (const p of await sameName(path.basename(target))) add(p, "same-name");
    if (text !== null && isIndexName(path.basename(note))) {
      const listed = new Set(
        parseIndex(text)
          .entries.map((e) => childName(e.href)?.toLowerCase())
          .filter(Boolean),
      );
      const folder = path.dirname(note);
      for (const name of (await fs.readdir(folder).catch(() => [])).sort())
        if (
          markdownPath(name) &&
          !isIndexName(name) &&
          !name.startsWith(".") &&
          !listed.has(name.toLowerCase())
        )
          add(path.join(folder, name), "unlisted");
    }
    return out.slice(0, 30);
  }
  async function readText(file) {
    return decode(await files.readBytes(file)).text;
  }

  return {
    candidates,
    // What can be done about a link (href, as written in the note file):
    // { target, name, missing, candidates, creatable }.
    async options(file, href) {
      const note = await noteOf(file);
      const target = targetOf(note, href);
      const missing = !(await exists(target));
      return {
        target,
        name: path.basename(target),
        missing,
        candidates: missing
          ? await candidates(
              note,
              target,
              await readText(note).catch(() => null),
            )
          : [],
        creatable:
          missing &&
          markdownPath(target) &&
          inLibrary(target) &&
          (await fs.stat(path.dirname(target)).then(
            (s) => s.isDirectory(),
            () => false,
          )),
      };
    },
    // One repair of the links in `file` that lead to href's target:
    // - { kind: "relocate", to }: they lead to `to` instead (an index entry
    //   in the same folder takes the new name, and its title when it was the
    //   old one);
    // - { kind: "remove" }: taken away (an index's entries go, their
    //   sub-items moving up; a link keeps its text, an image goes);
    // - { kind: "create" }: the missing note is created, the links stay.
    // A note open with unsaved changes is not written: { draft } tells the
    // page what to apply. Otherwise the rewrite is backed up and remembered
    // for undo. Returns { written | created | draft | unchanged }.
    async apply(file, href, action = {}, { drafts = [] } = {}) {
      const note = await noteOf(file);
      const target = targetOf(note, href);
      const label = {
        kind: "repair",
        name: path.basename(note),
        to: path.basename(target),
      };
      if (action.kind === "create") {
        if (!markdownPath(target) || !inLibrary(target))
          throw Error(t("只能在笔记库中新建笔记"));
        if (await exists(target)) throw Error(t("已有同名的文件或文件夹"));
        const body = `# ${path.basename(target).replace(/\.[^.]+$/, "")}\n`;
        try {
          await fs.writeFile(target, body, { flag: "wx" });
        } catch (error) {
          if (error.code === "ENOENT") throw Error(t("所在的文件夹不存在"));
          throw error;
        }
        await noteMoves.record({
          label,
          creates: [{ path: target, after: hash(Buffer.from(body)) }],
        });
        return { created: target };
      }
      const index = isIndexName(path.basename(note));
      let edit, change;
      if (action.kind === "relocate") {
        if (typeof action.to !== "string" || !path.isAbsolute(action.to))
          throw Error(t("无效操作"));
        const to = path.resolve(action.to);
        if (!(await exists(to)) || !inLibrary(to))
          throw Error(t("目标不在笔记库中，或已不存在"));
        const inFolder =
          index && samePath(path.dirname(to), path.dirname(target));
        edit = inFolder
          ? {
              kind: "rename",
              from: path.basename(target),
              to: path.basename(to),
            }
          : { kind: "relocate", moves: [[target, to]] };
        change = inFolder
          ? (text) => renameInIndex(text, edit.from, edit.to) ?? text
          : (text) =>
              rewriteLinks(text, { file: note, moves: edit.moves }).text;
      } else if (action.kind === "remove") {
        edit = { kind: "remove", target, index };
        change = index
          ? (text) => removeEntriesTo(text, note, target) ?? text
          : (text) => unlinkTarget(text, { file: note, target }).text;
      } else throw Error(t("无效操作"));
      if (drafts.some((p) => typeof p === "string" && samePath(p, note)))
        return { draft: { path: note, ...edit } };
      const write = await files.rewrite(note, change);
      if (!write) return { unchanged: true };
      await noteMoves.record({ label, writes: [write] });
      return { written: note };
    },
  };
}
