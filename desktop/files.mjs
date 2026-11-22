import fs from "node:fs/promises";
import { realpath as walkRealpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { t } from "./i18n.mjs";
import { createNameWalks } from "./name-walk.mjs";
import { skippedName } from "./scan-rules.mjs";
import {
  INDEX_NAMES,
  findIndexName,
  isIndexName,
  indexOrder,
  applyIndexOp,
  newIndexText,
  subtreeOf,
  checkableEntries,
  titleFor,
  parseIndex,
  childName,
} from "./folder-index.mjs";
import {
  leadingHeading,
  plainTitle,
  safeBase,
  numberedName,
  setNoteName,
  headingAnchor,
  baseName,
  NOTE_EXTENSION,
  frontTitle,
} from "./note-names.mjs";

const walk = promisify(walkRealpath);
// The canonical path (links resolved). Drives that cannot report a final
// path, such as WinFsp mounts (SSHFS-Win, rclone), fail the native call with
// UNKNOWN; resolving the path one step at a time still works there. A
// missing file stays an error.
export async function realPath(p, native = fs.realpath) {
  try {
    return await native(p);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw error;
    return walk(p);
  }
}

export const MAX_BYTES = 32 * 1024 * 1024;
export const markdownPath = (p) => /\.(md|markdown|mdown|mkd|txt)$/i.test(p);
// Other formats, opened only when the reader turns them on (Settings → System):
// unified diffs, shown read-only and kept out of the library's index.
export const otherPath = (p) => /\.(diff|patch)$/i.test(p);
export const hash = (data) => createHash("sha256").update(data).digest("hex");
export function within(root, file) {
  const rel = path.relative(root, file);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();
// A rename that waits out a short lock (an antivirus scanner, a sync client
// or the search indexer holding the file on Windows): retried a few times
// with a growing pause before the error is given.
const BUSY = new Set(["EBUSY", "EPERM", "EACCES"]);
export async function renameRetry(
  from,
  to,
  { rename = fs.rename, tries = 5, wait = 50 } = {},
) {
  for (let attempt = 0; ; attempt++)
    try {
      return await (rename || fs.rename)(from, to);
    } catch (error) {
      if (attempt + 1 >= tries || !BUSY.has(error.code)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, (wait ?? 50) * 2 ** attempt),
      );
    }
}
// Paths of open notes with unsaved changes, as the page gives them.
const draftList = (drafts) =>
  Array.isArray(drafts)
    ? drafts.filter((p) => typeof p === "string").slice(0, 500)
    : [];
const exists = (p) =>
  fs.lstat(p).then(
    () => true,
    () => false,
  );
// A child's name as an operation gives it: one segment, not "." or "..".
function plainName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    path.basename(name) !== name
  )
    throw Error(t("未授权的文件"));
  return name;
}
async function unchangedPath(file) {
  if ((await realPath(file)) !== file)
    throw Error(t("文件或文件夹路径已改变，请重新打开"));
  return file;
}
export function decode(bytes) {
  if (bytes.includes(0) && !(bytes[0] === 255 && bytes[1] === 254))
    throw Error(t("不支持二进制文件或 UTF-16BE，请转换为 UTF-8"));
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
  const utf16 = bytes[0] === 255 && bytes[1] === 254;
  const encoding = utf16 ? "utf-16le" : "utf-8";
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  return {
    text: text.replace(/\r\n?/g, "\n"),
    encoding,
    bom,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}
export function encode(text, info) {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n/g, info.eol);
  const body = Buffer.from(
    normalized,
    info.encoding === "utf-16le" ? "utf16le" : "utf8",
  );
  return info.encoding === "utf-16le"
    ? Buffer.concat([Buffer.from([255, 254]), body])
    : info.bom
      ? Buffer.concat([Buffer.from([239, 187, 191]), body])
      : body;
}
// Authorization records keep only what saving needs; the renderer owns the text.
// Holding decoded documents here retained up to 32 MB per file for the session.
const record = (real, { encoding, bom, eol }) => ({
  path: real,
  encoding,
  bom,
  eol,
});
export class FileStore {
  files = new Map();
  directories = new Map();
  imageDirectories = new Set();
  imageFiles = new Set();
  locks = new Set();
  // Index files read for the tree's order: path → { key, text }.
  indexes = new Map();
  // Notes' leading headings for the tree: path → { key, head }.
  headings = new Map();
  // How entries are renamed and moved (tests stand in a failing one), and
  // the first pause before a busy rename is tried again.
  renameFile = (from, to) => fs.rename(from, to);
  retryWait = 50;
  // The library's folders, where entries may be moved to (main sets them).
  roots = [];
  // onNames: a background walk of a folder outside the library found more.
  constructor({ backups, onNames = null } = {}) {
    this.backups = backups;
    this.otherFormats = false;
    this.names = createNameWalks({ onProgress: onNames });
  }
  // Whether a file opens in a tab: a note, or an other format when on.
  openable(p) {
    return markdownPath(p) || (this.otherFormats && otherPath(p));
  }
  file(id) {
    const entry = this.files.get(id);
    if (!entry) throw Error(t("未授权的文件"));
    return entry;
  }
  async readBytes(file) {
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES)
        throw Error(t("文件过大（上限 32 MB）或不是普通文件"));
      const bytes = await handle.readFile();
      if (bytes.length > MAX_BYTES) throw Error(t("文件过大"));
      return bytes;
    } finally {
      await handle.close();
    }
  }
  async open(file) {
    const real = await realPath(file);
    if (!this.openable(real)) throw Error(t("仅支持 Markdown 或文本文件"));
    const existing = [...this.files].find(([, f]) => f.path === real);
    const id = existing?.[0] ?? randomUUID();
    const bytes = await this.readBytes(real),
      info = decode(bytes);
    this.files.set(id, record(real, info));
    return {
      id,
      path: real,
      name: path.basename(real),
      text: info.text,
      version: hash(bytes),
    };
  }
  async read(id, version) {
    const file = this.file(id),
      bytes = await this.readBytes(await unchangedPath(file.path)),
      digest = hash(bytes);
    if (digest === version) return { unchanged: true, version: digest };
    const info = decode(bytes);
    Object.assign(file, record(file.path, info));
    return { text: info.text, version: digest };
  }
  async save(id, text, version) {
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES)
      throw Error(t("无效或过大的文档"));
    const file = this.file(id);
    if (this.locks.has(file.path)) throw Error(t("正在保存，请稍候"));
    this.locks.add(file.path);
    const temp = path.join(
      path.dirname(file.path),
      `.folio-${randomUUID()}.tmp`,
    );
    try {
      // Re-resolve to reject a path replaced by a symlink after it was authorized.
      await unchangedPath(file.path);
      const current = await this.readBytes(file.path);
      if (hash(current) !== version) return { conflict: true };
      const info = decode(current),
        bytes = encode(text, info);
      if (bytes.length > MAX_BYTES)
        throw Error(t("编码后的文件过大（上限 32 MB），未保存"));
      const stat = await fs.stat(file.path);
      const handle = await fs.open(temp, "wx", stat.mode);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.backup(file.path, current);
      if (hash(await this.readBytes(file.path)) !== version)
        return { conflict: true };
      await fs.rename(temp, file.path);
      Object.assign(file, record(file.path, info));
      return { version: hash(bytes) };
    } finally {
      this.locks.delete(file.path);
      // Cleanup must not replace the save result or the original error
      // (e.g. an antivirus scanner briefly holding the temporary file).
      await fs.unlink(temp).catch((e) => {
        if (e.code !== "ENOENT")
          console.warn("Folio: temporary file not removed", temp, e.code);
      });
    }
  }
  // A copy of a file's bytes before Marklore replaces them (a save, an index
  // entry, links after a move), one per distinct version: a recovery copy is
  // never overwritten. Returns its path (null without a backup folder).
  async backup(file, bytes) {
    if (!this.backups) return null;
    await fs.mkdir(this.backups, { recursive: true });
    const copy = path.join(
      this.backups,
      hash(file) + "-" + hash(bytes) + ".bak",
    );
    await fs.writeFile(copy, bytes, { flag: "wx" }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    return copy;
  }
  // Bytes written over a file as a save is: a temporary file renamed over
  // it, after a backup and a last check that it still holds `before`.
  async replace(file, before, bytes) {
    if (this.locks.has(file)) throw Error(t("正在保存，请稍候"));
    // Never through a link to somewhere else (as saves check).
    await unchangedPath(file);
    this.locks.add(file);
    const temp = path.join(path.dirname(file), `.folio-${randomUUID()}.tmp`);
    try {
      const stat = await fs.stat(file);
      await fs.writeFile(temp, bytes, { flag: "wx", mode: stat.mode });
      const backup = await this.backup(file, before);
      if (hash(await this.readBytes(file)) !== hash(before))
        throw Error(
          t("{name} 刚被其他程序修改，请重试", { name: path.basename(file) }),
        );
      await renameRetry(temp, file, { wait: this.retryWait });
      this.indexes.delete(file);
      return { path: file, before: hash(before), after: hash(bytes), backup };
    } finally {
      this.locks.delete(file);
      await fs.unlink(temp).catch(() => {});
    }
  }
  // A note rewritten by Marklore itself (an index entry, links that follow
  // a move): change(text) gives the new text, or null to leave it. Encoding,
  // byte order mark and line endings stay. Returns { path, before, after,
  // backup } (hashes of the bytes, the backup's path), or null.
  async rewrite(file, change) {
    const bytes = await this.readBytes(file);
    const info = decode(bytes);
    const text = change(info.text);
    if (text == null || text === info.text) return null;
    const out = encode(text, info);
    if (out.length > MAX_BYTES)
      throw Error(t("编码后的文件过大（上限 32 MB），未保存"));
    return this.replace(file, bytes, out);
  }
  // A rewrite undone: the backup put back, unless the file changed since
  // (its hash is no longer `after`). Returns whether it was put back.
  async restore(file, { after, before, backup }) {
    if (!backup) return false;
    let current, saved;
    try {
      current = await this.readBytes(file);
      saved = await fs.readFile(backup);
    } catch {
      return false;
    }
    if (hash(current) !== after || hash(saved) !== before) return false;
    await this.replace(file, current, saved);
    return true;
  }
  async currentFolder(id) {
    const file = this.file(id);
    await unchangedPath(file.path);
    return this.directory(path.dirname(file.path));
  }
  async directory(folder) {
    const real = await realPath(folder);
    const existing = [...this.directories].find(([, p]) => p === real);
    const id = existing?.[0] ?? randomUUID();
    this.directories.set(id, real);
    // A drive's root has no last segment: show it as "Z:\".
    return { id, name: path.basename(real) || real, path: real };
  }
  async list(id) {
    const folder = this.directories.get(id);
    if (!folder) throw Error(t("未授权的文件夹"));
    await unchangedPath(folder);
    const result = [];
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      if (
        item.name.startsWith(".") ||
        item.name === "node_modules" ||
        item.isSymbolicLink()
      )
        continue;
      if (!item.isDirectory() && !this.openable(item.name)) continue;
      const p = path.join(folder, item.name);
      // A child may have changed since readdir; do not authorize a replaced link.
      let real;
      try {
        real = await realPath(p);
      } catch {
        continue;
      }
      if (real !== p || !within(folder, real)) continue;
      if (item.isDirectory())
        result.push({ ...(await this.directory(p)), directory: true });
      else {
        // A note's name: its leading heading (note-names.mjs), when it has
        // one; the tree and the index view show it.
        const head = /\.(md|markdown|mdown|mkd)$/i.test(item.name)
          ? await this.headingOf(p)
          : null;
        result.push({
          name: item.name,
          path: p,
          parent: id,
          directory: false,
          ...(head ? { title: head.title, heading: head.raw } : {}),
        });
      }
    }
    result.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
    );
    return this.inIndexOrder(folder, result);
  }
  // A folder with an index file (folder-index.mjs): the index first, then
  // the children it lists, in its order and nesting (depth), then the rest.
  async inIndexOrder(folder, items) {
    const name = findIndexName(
      items.filter((item) => !item.directory).map((item) => item.name),
    );
    if (!name) return items;
    let text;
    try {
      text = await this.indexText(path.join(folder, name));
    } catch {
      return items;
    }
    const byName = new Map(
      items.map((item) => [item.name.toLowerCase(), item]),
    );
    const index = byName.get(name.toLowerCase());
    const order = indexOrder(text, (child) => {
      const item = byName.get(child.toLowerCase());
      return item && item !== index ? item.name : null;
    });
    const taken = new Set([index]);
    const listed = order.map(({ name: child, depth }) => {
      const item = byName.get(child.toLowerCase());
      taken.add(item);
      return { ...item, depth, listed: true };
    });
    // Entries whose note or folder is not there (renamed or deleted by
    // another program): counted, for the index's row to say so.
    // The same entries the index's own view shows missing.
    const missing = (
      await this.missingEntries(folder, path.join(folder, name), text)
    ).length;
    return [
      { ...index, index: true, ...(missing ? { missing } : {}) },
      ...listed,
      ...items.filter((item) => !taken.has(item)),
    ];
  }
  // The index's entries whose note or folder is not there, as the index
  // view shows them missing (checkableEntries): [{ line, title, href,
  // name, target }].
  async missingEntries(folder, file, text) {
    const out = [];
    for (const { entry, name, target } of checkableEntries(text, file)) {
      const where = name ? path.join(folder, name) : path.resolve(target);
      if (await exists(where)) continue;
      out.push({
        line: entry.line,
        title: entry.text.replace(/\\(.)/g, (m, c) => c),
        href: entry.href,
        name: name || path.basename(where),
        target: where,
      });
    }
    return out;
  }
  async indexIssues(id) {
    const folder = this.folderPath(id);
    await unchangedPath(folder);
    const file = await this.indexFile(folder);
    if (!file) return { index: null, missing: [] };
    const text = decode(await this.readBytes(file)).text;
    return {
      index: file,
      missing: await this.missingEntries(folder, file, text),
    };
  }
  // A note's leading heading ({ raw, title }, or null), read from its first
  // 16 KB and kept while its size and time are unchanged.
  async headingOf(file) {
    try {
      const stat = await fs.stat(file);
      const key = stat.size + ":" + stat.mtimeMs;
      const cached = this.headings.get(file);
      if (cached?.key === key) return cached.head;
      const handle = await fs.open(file, "r");
      let head = null;
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, 16 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        let bytes = buffer.subarray(0, bytesRead);
        // A cut through a character: up to its start.
        if (bytesRead < stat.size)
          while (bytes.length && (bytes[bytes.length - 1] & 0xc0) === 0x80)
            bytes = bytes.subarray(0, bytes.length - 1);
        if (
          bytesRead < stat.size &&
          bytes.length &&
          bytes[bytes.length - 1] >= 0xc0
        )
          bytes = bytes.subarray(0, bytes.length - 1);
        const found = leadingHeading(decode(bytes).text);
        head = found ? { raw: found.raw, title: found.title } : null;
      } catch {
        head = null;
      } finally {
        await handle.close();
      }
      this.headings.set(file, { key, head });
      if (this.headings.size > 20000)
        this.headings.delete(this.headings.keys().next().value);
      return head;
    } catch {
      return null;
    }
  }
  // An index file's text, kept while its size and time are unchanged (the
  // tree is listed again on every change on disk).
  async indexText(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw Error(t("目录文件过大"));
    const key = stat.size + ":" + stat.mtimeMs;
    const cached = this.indexes.get(file);
    if (cached?.key === key) return cached.text;
    const text = decode(await this.readBytes(file)).text;
    this.indexes.set(file, { key, text });
    if (this.indexes.size > 200)
      this.indexes.delete(this.indexes.keys().next().value);
    return text;
  }
  // Dragging in the tree: a child moved before, after or into (as a sub-item
  // of) another child in the folder's index file, which is rewritten (a
  // child not listed yet gets an entry). Returns the index's path, or null
  // when nothing changed.
  async reorderIndex(id, { name, target, place } = {}) {
    const done = await this.editIndex(id, {
      kind: "move",
      ref: name,
      target,
      place,
    });
    return done?.path ?? null;
  }
  // The folder's index file (folder-index.mjs), or null.
  async indexFile(folder) {
    const name = findIndexName(await fs.readdir(folder));
    if (!name) return null;
    const file = path.join(folder, name);
    if ((await realPath(file)) !== file) throw Error(t("未授权的文件"));
    return file;
  }
  // Operations on a folder's index (applyIndexOp), one after another, in
  // one rewrite with a backup. An index open with unsaved changes (drafts:
  // paths) is not written: { path, ops, draft: true } tells the page to
  // apply them to its draft. Otherwise the rewrite (see rewrite), or null
  // when there is no index or nothing changes.
  async changeIndex(folder, ops, { drafts = [] } = {}) {
    const file = await this.indexFile(folder);
    if (!file || !ops.length) return null;
    if (drafts.some((p) => samePath(p, file)))
      return { path: file, ops, draft: true };
    return this.rewrite(file, (text) =>
      ops.reduce((current, op) => applyIndexOp(current, op) ?? current, text),
    );
  }
  // A rename, move or trash changes the folder's index: not while that
  // index is open with unsaved changes (its edits could not be undone).
  async checkIndexSaved(folder, drafts = []) {
    const file = await this.indexFile(folder).catch(() => null);
    if (file && draftList(drafts).some((p) => samePath(p, file)))
      throw Error(
        t("{name} 有未保存的修改，请先保存，再改名或移动", {
          name: path.basename(file),
        }),
      );
  }
  // One operation on an authorized folder's index from the tree (or the
  // index's own view): children are named as entries of the folder.
  async editIndex(id, op = {}) {
    const folder = this.folderPath(id);
    await unchangedPath(folder);
    if (!op || typeof op !== "object") throw Error(t("无效操作"));
    for (const key of ["ref", "target", "name", "from", "to", "under", "after"])
      if (
        op[key] != null &&
        !(typeof op[key] === "object" && Number.isInteger(op[key].line))
      )
        plainName(op[key]);
    const file = await this.indexFile(folder);
    if (!file) throw Error(t("这个文件夹没有目录文件"));
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const isFolder = (name) =>
      folders.some((f) => f.toLowerCase() === String(name).toLowerCase());
    const full = { ...op, folders };
    // A child added must be there; whether it is a folder comes from disk.
    if (op.kind === "insert" || op.kind === "move") {
      const name = op.kind === "insert" ? op.name : op.ref;
      if (typeof name === "string") {
        await fs.stat(path.join(folder, name));
        full.folder = isFolder(name);
      }
    }
    return this.rewrite(file, (text) => applyIndexOp(text, full));
  }
  // An index for a folder that has none: _目录.md listing its folders and
  // notes in the order the tree shows them (by name). Never replaces a file.
  async createIndex(id) {
    const folder = this.folderPath(id);
    await unchangedPath(folder);
    if (await this.indexFile(folder)) throw Error(t("这个文件夹已有目录文件"));
    const children = [];
    for (const item of await this.list(id)) {
      let index = null;
      if (item.directory)
        index = findIndexName(await fs.readdir(item.path).catch(() => []));
      children.push({ name: item.name, folder: item.directory, index });
    }
    const file = path.join(folder, INDEX_NAMES[0]);
    const title = path.basename(folder) || folder;
    try {
      await fs.writeFile(file, newIndexText(title, children), { flag: "wx" });
    } catch (e) {
      if (e.code === "EEXIST") throw Error(t("已有同名的文件或文件夹"));
      throw e;
    }
    this.indexes.delete(file);
    return { path: file };
  }
  // A name the tree may give a new or renamed entry: one plain segment that
  // Windows accepts and the tree shows (no leading dot).
  static checkName(name) {
    if (
      typeof name !== "string" ||
      !name ||
      name.length > 200 ||
      name !== name.trim() ||
      name.startsWith(".") ||
      /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
    )
      throw Error(
        t('名称无效：不能为空，不能以点开头，也不能含有 \\ / : * ? " < > |'),
      );
    return name;
  }
  // An entry of an authorized folder, by its name there.
  async childPath(id, name) {
    const folder = this.directories.get(id);
    // A name of an entry: not the folder itself ("" or "."), nor one above.
    if (
      !folder ||
      typeof name !== "string" ||
      !name ||
      name === "." ||
      name === ".." ||
      path.basename(name) !== name
    )
      throw Error(t("未授权的文件"));
    await unchangedPath(folder);
    const child = path.join(folder, name);
    if ((await realPath(child)) !== child || !within(folder, child))
      throw Error(t("文件位于所选文件夹之外"));
    return child;
  }
  folderPath(id) {
    const folder = this.directories.get(id);
    if (!folder) throw Error(t("未授权的文件夹"));
    return folder;
  }
  // A new note or folder in an authorized folder; never replaces one. A
  // note is empty, or starts with `text` (its default properties). In a
  // folder with an index file it is listed there: under `place.under` (a
  // new child page; that note listed first if it was not), otherwise at
  // the end. place.drafts: open notes with unsaved changes (changeIndex).
  async createEntry(id, name, kind, text = "", place = null) {
    const folder = this.folderPath(id);
    await unchangedPath(folder);
    FileStore.checkName(name);
    if (kind !== "folder" && !markdownPath(name))
      throw Error(t("笔记名称须以 .md 结尾"));
    const under =
      place && typeof place === "object" && place.under != null
        ? plainName(place.under)
        : null;
    const body =
      typeof text === "string" && text.length <= 64 * 1024 ? text : "";
    const target = path.join(folder, name);
    try {
      if (kind === "folder") await fs.mkdir(target);
      else await fs.writeFile(target, body, { flag: "wx" });
    } catch (e) {
      if (e.code === "EEXIST") throw Error(t("已有同名的文件或文件夹"));
      throw e;
    }
    const entry = { kind: "insert", name, folder: kind === "folder" };
    const ops = under
      ? [
          { kind: "insert", name: under },
          { ...entry, under },
        ]
      : [entry];
    // The entry exists either way; a failed index write is reported. A
    // caller that lists it itself (the index's own view) says list: false.
    const index =
      place?.list === false
        ? null
        : await this.changeIndex(folder, ops, {
            drafts: draftList(place?.drafts),
          }).catch((e) => ({ error: e.message }));
    return kind === "folder"
      ? { ...(await this.directory(target)), directory: true, index }
      : { path: target, index };
  }
  // An entry renamed or moved on disk: open notes and listed folders inside
  // it keep their handles, now at the new path. Returns those notes.
  async relocate(source, target) {
    const stat = await fs.stat(source);
    try {
      await renameRetry(source, target, {
        rename: this.renameFile,
        wait: this.retryWait,
      });
    } catch (error) {
      if (error.code === "EXDEV")
        throw Error(t("不能移动到另一个磁盘上的文件夹"));
      throw error;
    }
    const moved = (p) =>
      samePath(p, source)
        ? target
        : stat.isDirectory() && within(source, p)
          ? path.join(target, path.relative(source, p))
          : null;
    const files = [];
    for (const [fileId, file] of this.files) {
      const next = moved(file.path);
      if (!next) continue;
      file.path = next;
      files.push({ id: fileId, path: next, name: path.basename(next) });
    }
    for (const [folderId, folder] of this.directories) {
      const next = moved(folder);
      if (next) this.directories.set(folderId, next);
    }
    this.indexes.clear();
    return files;
  }
  // Not while a note at or under it is being saved.
  checkUnlocked(source) {
    if ([...this.locks].some((p) => samePath(p, source) || within(source, p)))
      throw Error(t("正在保存，请稍候"));
  }
  // Where a rename would put an entry: checked, nothing changed yet. With
  // `title` (the entry's new name as typed: a note's heading in Markdown,
  // a folder's name) the name on disk is made from it (note-names.mjs): a
  // name Windows accepts, " (2)" when it is taken, and newName is unused.
  async renameTarget(id, name, newName, { title = null } = {}) {
    const source = await this.childPath(id, name);
    const stat = await fs.stat(source);
    const directory = stat.isDirectory();
    if (typeof title === "string") {
      const plain = directory ? title.trim() : plainTitle(title);
      const folder = path.dirname(source);
      const ext = directory ? "" : (NOTE_EXTENSION.exec(name) || [".md"])[0];
      // The whole path stays within what Windows takes.
      const max = Math.max(
        20,
        Math.min(120, 250 - folder.length - ext.length - 6),
      );
      const base = safeBase(plain, max);
      if (!base) throw Error(t("名称不能为空"));
      newName = await this.freeName(folder, base + ext, source);
    }
    FileStore.checkName(newName);
    if (!directory && !this.openable(newName))
      throw Error(t("笔记名称须以 .md 结尾"));
    const target = path.join(path.dirname(source), newName);
    // A change of case only is the same entry on Windows.
    if (target !== source && !samePath(target, source)) {
      const taken = await fs.lstat(target).then(
        () => true,
        (e) => e.code !== "ENOENT",
      );
      if (taken) throw Error(t("已有同名的文件或文件夹"));
    }
    return { source, target, directory, newName };
  }
  // A name in a folder not taken by another entry: the name itself, else
  // "Name (2).md", "Name (3).md"... (`source`, the entry renamed, may keep
  // its own).
  async freeName(folder, wanted, source = null) {
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? wanted : numberedName(wanted, n);
      const p = path.join(folder, candidate);
      if ((source && samePath(p, source)) || !(await exists(p)))
        return candidate;
    }
    throw Error(t("已有同名的文件或文件夹"));
  }
  // What renaming an entry does besides its name on disk (renameTarget):
  // the text its index entry gets (entryTitle: the note's name), the
  // note's new leading heading (heading, when it has one) and the anchor
  // of that heading changing ([{ file, source, from, to }]). previous: the
  // heading as it was before a save that changed it (the note on disk has
  // the new one already).
  async renameDetails(
    id,
    name,
    newName,
    { title = null, previous = null } = {},
  ) {
    const plan = await this.renameTarget(id, name, newName, { title });
    let heading = null;
    let entryTitle = null;
    let anchors = [];
    if (typeof title === "string" && plan.directory) entryTitle = plan.newName;
    else if (typeof title === "string") {
      const text = await this.readBytes(plan.source)
        .then((bytes) => decode(bytes).text)
        .catch(() => null);
      const found = text === null ? null : leadingHeading(text);
      if (found) {
        heading = title.trim().replace(/\s+/g, " ");
        entryTitle = plainTitle(heading);
        const old = typeof previous === "string" ? previous : found.raw;
        const from = headingAnchor(old);
        const to = headingAnchor(heading);
        if (from !== to)
          anchors = [{ file: plan.target, source: plan.source, from, to }];
      } else entryTitle = baseName(plan.newName);
    }
    return { ...plan, heading, entryTitle, anchors };
  }
  // Rename an entry in its folder; the folder's index follows (its links
  // to the entry, and its text: the entry's name with `title`, otherwise a
  // text that was the old name), and with `title` a note's own leading
  // heading and front-matter title. An index or a note open with unsaved
  // changes (drafts) is not written: { path, ops, draft: true } tells the
  // page what to apply to it. Returns { path, files, moves: [[old, new]],
  // indexes: [rewrites, drafts], anchors }.
  async renameEntry(
    id,
    name,
    newName,
    { drafts = [], title = null, previous = null } = {},
  ) {
    const plan = await this.renameDetails(id, name, newName, {
      title,
      previous,
    });
    const { source, target } = plan;
    const moved = target !== source;
    if (!moved && plan.entryTitle === null)
      return { path: source, files: [], moves: [], indexes: [], anchors: [] };
    this.checkUnlocked(source);
    // The folder's own index renamed is no entry of itself; any other note
    // (even one named SUMMARY.md beside a _目录.md) keeps its entry.
    const own = await this.indexFile(path.dirname(source)).catch(() => null);
    const isOwnIndex = Boolean(own && samePath(own, source));
    const files = moved ? await this.relocate(source, target) : [];
    const indexes = [];
    if (!isOwnIndex) {
      const index = await this.changeIndex(
        path.dirname(source),
        [
          {
            kind: "rename",
            from: name,
            to: plan.newName,
            ...(plan.entryTitle !== null ? { title: plan.entryTitle } : {}),
          },
        ],
        { drafts: draftList(drafts) },
      ).catch((e) => ({ error: e.message }));
      if (index) indexes.push(index);
    }
    // The note's own name: its heading, and a front-matter title saying the
    // same (never added).
    if (plan.heading !== null) {
      const op = {
        kind: "note-name",
        heading: plan.heading,
        title: plan.entryTitle,
      };
      if (draftList(drafts).some((p) => samePath(p, source)))
        indexes.push({ path: source, ops: [op], draft: true });
      else {
        const write = await this.rewrite(target, (text) =>
          setNoteName(text, op),
        ).catch((e) => ({ error: e.message }));
        if (write) indexes.push(write);
        this.headings.delete(target);
      }
    }
    return {
      path: target,
      files,
      moves: moved ? [[source, target]] : [],
      indexes,
      anchors: plan.anchors,
    };
  }
  // The folder's index file, for the tree's "open index" button: { path,
  // name }, or null.
  async folderIndex(id) {
    const folder = this.folderPath(id);
    await unchangedPath(folder);
    const file = await this.indexFile(folder);
    return file ? { path: file, name: path.basename(file) } : null;
  }
  // "Unify names" for a folder (and its subfolders with deep): for each
  // note, what makes its file name, its index entry, its heading and its
  // front-matter title one name (note-names.mjs): the leading heading, or
  // for a note without one, its index entry's text or its file name (then
  // written as its heading). Nothing changes here. Notes open with unsaved
  // changes (drafts) are left out, and named. Returns { folder, notes:
  // [{ path, folder, name, title, to, heading, entry, front }], skipped }.
  async unifyPlan(id, { deep = false, drafts = [] } = {}) {
    const root = this.folderPath(id);
    await unchangedPath(root);
    const unsaved = draftList(drafts);
    const folders = [root];
    for (let i = 0; deep && i < folders.length && folders.length < 2000; i++)
      for (const item of await fs
        .readdir(folders[i], { withFileTypes: true })
        .catch(() => []))
        if (
          item.isDirectory() &&
          !item.isSymbolicLink() &&
          !item.name.startsWith(".") &&
          !skippedName(item.name)
        )
          folders.push(path.join(folders[i], item.name));
    const notes = [];
    const skipped = [];
    for (const folder of folders) {
      const items = (
        await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
      ).sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
      );
      const names = items.map((item) => item.name);
      const taken = new Set(names.map((n) => n.toLowerCase()));
      const indexName = findIndexName(names);
      let parsed = null;
      if (indexName)
        try {
          parsed = parseIndex(
            decode(await this.readBytes(path.join(folder, indexName))).text,
          );
        } catch {
          parsed = null;
        }
      for (const item of items) {
        if (
          !item.isFile() ||
          item.name.startsWith(".") ||
          !/\.(md|markdown|mdown|mkd)$/i.test(item.name) ||
          isIndexName(item.name)
        )
          continue;
        const file = path.join(folder, item.name);
        if (unsaved.some((p) => samePath(p, file))) {
          skipped.push({ path: file, name: item.name });
          continue;
        }
        let text;
        try {
          text = decode(await this.readBytes(file)).text;
        } catch {
          continue;
        }
        const head = leadingHeading(text);
        const entry = parsed
          ? parsed.entries.find(
              (e) =>
                childName(e.href)?.toLowerCase() === item.name.toLowerCase(),
            )
          : null;
        const entryText = entry
          ? entry.text.replace(/\\(.)/g, (m, c) => c).trim()
          : null;
        const title = head
          ? head.title
          : plainTitle(entryText || "") || baseName(item.name);
        const ext = (NOTE_EXTENSION.exec(item.name) || [".md"])[0];
        const max = Math.max(
          20,
          Math.min(120, 250 - folder.length - ext.length - 6),
        );
        const base = safeBase(title, max) || baseName(item.name);
        let to = null;
        const own = item.name.toLowerCase();
        const fits = (candidate) => candidate.toLowerCase() === own;
        // A name already made from the title (or its numbered form, when
        // another note took the plain one) stays.
        const numbered = new RegExp(
          "^" +
            base.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c) +
            " \\(\\d+\\)" +
            ext.replace(/\./g, "\\.") +
            "$",
          "i",
        );
        if (!fits(base + ext) && !numbered.test(item.name)) {
          for (let n = 1; n < 1000; n++) {
            const candidate =
              n === 1 ? base + ext : numberedName(base + ext, n);
            if (!taken.has(candidate.toLowerCase())) {
              to = candidate;
              break;
            }
          }
          if (to) {
            taken.delete(own);
            taken.add(to.toLowerCase());
          }
        }
        const front = frontTitle(text);
        const change = {
          path: file,
          folder,
          name: item.name,
          title,
          to,
          heading: head ? null : title,
          entry:
            entry && entryText !== title
              ? { from: entryText, to: title }
              : null,
          front:
            front && front.value !== title
              ? { from: front.value, to: title }
              : null,
        };
        if (change.to || change.heading || change.entry || change.front)
          notes.push(change);
      }
    }
    return { folder: root, notes, skipped };
  }
  // The changes of unifyPlan made: files renamed (all, or none when one
  // fails), headings and front-matter titles written, each folder's index
  // rewritten once; each file backed up. Returns { path, files, moves,
  // indexes } as renameEntry does.
  async unifyNames(plan, { drafts = [] } = {}) {
    const moves = [];
    const files = [];
    try {
      for (const change of plan.notes) {
        if (!change.to) continue;
        const target = path.join(change.folder, change.to);
        if (!samePath(target, change.path) && (await exists(target)))
          throw Error(t("已有同名的文件或文件夹"));
        this.checkUnlocked(change.path);
        files.push(...(await this.relocate(change.path, target)));
        moves.push([change.path, target]);
      }
    } catch (error) {
      for (const [from, to] of moves.reverse())
        await this.relocate(to, from).catch(() => {});
      throw error;
    }
    const indexes = [];
    for (const change of plan.notes) {
      if (!change.heading && !change.front) continue;
      const target = change.to
        ? path.join(change.folder, change.to)
        : change.path;
      const write = await this.rewrite(target, (text) =>
        setNoteName(text, {
          heading: change.heading,
          insert: Boolean(change.heading),
          title: change.title,
        }),
      ).catch((e) => ({ error: e.message }));
      if (write) indexes.push(write);
      this.headings.delete(target);
    }
    const byFolder = new Map();
    for (const change of plan.notes) {
      const op = change.to
        ? {
            kind: "rename",
            from: change.name,
            to: change.to,
            title: change.title,
          }
        : change.entry
          ? { kind: "retitle", ref: change.name, title: change.title }
          : null;
      if (!op) continue;
      if (!byFolder.has(change.folder)) byFolder.set(change.folder, []);
      byFolder.get(change.folder).push(op);
    }
    for (const [folder, ops] of byFolder) {
      const index = await this.changeIndex(folder, ops, {
        drafts: draftList(drafts),
      }).catch((e) => ({ error: e.message }));
      if (index) indexes.push(index);
    }
    return { path: plan.folder, files, moves, indexes, anchors: [] };
  }
  // A folder an entry may move to: an existing folder inside one the tree
  // lists (the library's folders).
  async destination(dest) {
    if (typeof dest !== "string" || !path.isAbsolute(dest))
      throw Error(t("未授权的文件夹"));
    const real = await realPath(dest);
    if (!(await fs.stat(real)).isDirectory()) throw Error(t("未授权的文件夹"));
    // Inside a folder of the library as it is now (one removed from it no
    // longer counts), and not in a hidden or software folder of it.
    const root = this.roots.find((r) => within(r, real));
    if (
      !root ||
      path
        .relative(root, real)
        .split(path.sep)
        .some((part) => part && skippedName(part))
    )
      throw Error(t("未授权的文件夹"));
    return real;
  }
  // What moving an entry to another folder takes: the entries moved (with
  // its child pages, from the folder's index, when children is set) and
  // where each goes. Checked, nothing changed yet.
  async movePlan(id, name, dest, { children = false } = {}) {
    const source = await this.childPath(id, name);
    const from = path.dirname(source);
    const to = await this.destination(dest);
    if (samePath(from, to)) throw Error(t("已在这个文件夹中"));
    const stat = await fs.stat(source);
    if (stat.isDirectory() && within(source, to))
      throw Error(t("不能把文件夹移到它自己里面"));
    const index = await this.indexFile(from);
    const tree = index
      ? subtreeOf(decode(await this.readBytes(index)).text, name)
      : [];
    // Child pages: the notes listed under it that are there.
    const pages = [];
    for (const item of tree.slice(1)) {
      const p = path.join(from, item.name);
      const isNote = await fs.lstat(p).then(
        (s) => s.isFile() && this.openable(p),
        () => false,
      );
      // An index listed in itself is not a child page.
      if (isNote && !isIndexName(item.name)) pages.push(item);
    }
    const moving = [
      { name, title: tree[0]?.title ?? null, parent: null },
      ...(children ? pages : []),
    ];
    for (const item of moving) {
      const taken = await fs.lstat(path.join(to, item.name)).then(
        () => true,
        (e) => e.code !== "ENOENT",
      );
      if (taken)
        throw Error(t("目标文件夹中已有“{name}”", { name: item.name }));
    }
    return {
      source,
      from,
      to,
      directory: stat.isDirectory(),
      children: pages.map((item) => item.name),
      moving,
      moves: moving.map((item) => [
        path.join(from, item.name),
        path.join(to, item.name),
      ]),
    };
  }
  // Move an entry (and, with children, its child pages) to another folder.
  // The source folder's index loses its entries (child pages left behind
  // move up a level); the destination's index, if it has one, lists them
  // at its end, nested and titled as they were. Returns { path, files,
  // moves, indexes }.
  async moveEntry(id, name, dest, { children = false, drafts = [] } = {}) {
    const plan = await this.movePlan(id, name, dest, { children });
    for (const [source] of plan.moves) this.checkUnlocked(source);
    await this.checkIndexSaved(plan.from, drafts);
    await this.checkIndexSaved(plan.to, drafts);
    const files = [];
    const moves = [];
    try {
      for (const [source, target] of plan.moves) {
        files.push(...(await this.relocate(source, target)));
        moves.push([source, target]);
      }
    } catch (error) {
      // Not left halfway: what moved goes back before the error is told.
      for (const [source, target] of moves.reverse())
        await this.relocate(target, source).catch(() => {});
      throw error;
    }
    const options = { drafts: draftList(drafts) };
    const moved = new Set(plan.moving.map((item) => item.name.toLowerCase()));
    const indexes = [
      await this.changeIndex(
        plan.from,
        // Only the entries that moved, the deepest first: anything else
        // listed under them (a folder, a missing note) moves up a level.
        [...plan.moving].reverse().map((item) => ({
          kind: "remove",
          ref: item.name,
        })),
        options,
      ).catch((e) => ({ error: e.message })),
      await this.changeIndex(
        plan.to,
        plan.moving.map((item) => ({
          kind: "insert",
          name: item.name,
          folder: item === plan.moving[0] && plan.directory,
          title:
            item.title && item.title !== titleFor(item.name)
              ? item.title
              : undefined,
          under:
            item.parent && moved.has(item.parent.toLowerCase())
              ? item.parent
              : null,
        })),
        options,
      ).catch((e) => ({ error: e.message })),
    ].filter(Boolean);
    return { path: path.join(plan.to, name), files, moves, indexes };
  }
  // An entry gone to the Recycle Bin: its folder's index no longer lists
  // it (its child pages move up a level).
  unlistEntry(folder, name, { drafts = [] } = {}) {
    return this.changeIndex(folder, [{ kind: "remove", ref: name }], {
      drafts: draftList(drafts),
    });
  }
  async openChild(id, name) {
    const folder = this.directories.get(id);
    if (!folder || path.basename(name) !== name) throw Error(t("未授权的文件"));
    await unchangedPath(folder);
    const real = await realPath(path.join(folder, name));
    if (!within(folder, real)) throw Error(t("文件位于所选文件夹之外"));
    return this.open(real);
  }
  // Notes whose names hold every word of the query, in these folders and
  // below (desktop/name-walk.mjs: walked once in the background, by the
  // library's rules). Only the folders of the notes returned are resolved
  // and authorized; opening one checks its path again (openChild).
  // scanning: a large folder is still being walked; more may come.
  async search(ids, query, { limit = 200, excluded, excludedKey } = {}) {
    const roots = [...new Set(ids)]
      .map((id) => this.directories.get(id))
      .filter(Boolean);
    if (!roots.length) return { items: [], truncated: false, scanning: false };
    const found = await this.names.search(roots, query, {
      limit,
      excluded,
      excludedKey,
    });
    const items = [];
    for (const note of found.items) {
      try {
        note.parent ??= (await this.directory(note.folder)).id;
      } catch {
        continue;
      }
      items.push({
        name: note.name,
        path: note.path,
        parent: note.parent,
        directory: false,
      });
    }
    return { items, truncated: found.truncated, scanning: found.scanning };
  }
  resolve(id, href) {
    const base = this.file(id).path;
    let decoded = decodeURIComponent(href).replace(/^<|>$/g, "");
    if (/^file:/i.test(decoded))
      decoded = decoded.replace(/^file:\/+(?=[a-z]:)/i, "");
    if (/^[\\/]{2}/.test(decoded))
      throw Error(t("暂不支持网络共享路径，请使用本机磁盘文件"));
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded))
      throw Error(t("不支持此链接协议"));
    return path.resolve(path.dirname(base), decoded);
  }
  async linkTarget(id, href) {
    if (typeof href !== "string" || href.length > 8192)
      throw Error(t("无效链接"));
    const base = this.file(id),
      target = this.resolve(id, href);
    await unchangedPath(base.path);
    const real = await realPath(target);
    const existing = [...this.files].find(([, file]) => file.path === real);
    const roots = [path.dirname(base.path), ...this.directories.values()];
    return {
      path: real,
      existingId: existing?.[0],
      authorized: Boolean(existing) || roots.some((root) => within(root, real)),
    };
  }
  async preview(id, href) {
    const {
      path: real,
      existingId,
      authorized,
    } = await this.linkTarget(id, href);
    if (!authorized)
      throw Error(
        t("目标位于授权文件夹之外；请点击链接确认打开，或先添加笔记文件夹。"),
      );
    if (!markdownPath(real)) throw Error(t("仅预览 Markdown 或文本文件"));
    // A known handle lets the renderer prefer an open, unsaved document without
    // transferring or changing its disk baseline. Preview does not start a watcher.
    if (existingId)
      return { id: existingId, path: real, name: path.basename(real) };
    return this.open(real);
  }
  async imageInfo(id, href) {
    if (typeof href !== "string" || href.length > 8192)
      throw Error(t("无效图片路径"));
    const file = this.file(id),
      real = await realPath(this.resolve(id, href));
    await unchangedPath(file.path);
    if (!/\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(real))
      throw Error(t("不支持的图片类型"));
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
      throw Error(t("图片不是普通文件或超过 64 MB"));
    const roots = [
      path.dirname(file.path),
      ...this.directories.values(),
      ...this.imageDirectories,
    ];
    return {
      path: real,
      authorized:
        this.imageFiles.has(real) || roots.some((root) => within(root, real)),
    };
  }
  async asset(id, href) {
    const { path: real, authorized } = await this.imageInfo(id, href);
    if (!authorized) throw Error(t("图片位于授权文件夹之外"));
    return real;
  }
  async importImage(id, source) {
    const file = this.file(id);
    await unchangedPath(file.path);
    const real = await realPath(source);
    const extension = path.extname(real).toLowerCase();
    if (!/^\.(png|jpe?g|gif|webp|bmp|avif|svg)$/.test(extension))
      throw Error(t("请选择 PNG、JPEG、GIF、WebP、BMP、AVIF 或 SVG 图片"));
    const bytes = await this.readBytes(real);
    return this.importImageBytes(
      id,
      bytes,
      extension,
      path.basename(real, extension),
    );
  }
  async importImageBytes(id, bytes, extension, label = t("图片")) {
    const file = this.file(id);
    await unchangedPath(file.path);
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > MAX_BYTES ||
      !/^\.(png|jpe?g|gif|webp|bmp|avif|svg)$/.test(extension)
    )
      throw Error(t("图片类型不支持或超过 32 MB"));
    const parent = path.dirname(file.path);
    const folder = path.join(parent, "assets");
    await fs.mkdir(folder, { recursive: true });
    const resolved = await realPath(folder);
    if (!within(parent, resolved)) throw Error(t("图片目录位于笔记文件夹之外"));
    const name = `image-${randomUUID()}${extension}`;
    // Exclusive creation never overwrites an existing attachment or source image.
    await fs.writeFile(path.join(resolved, name), bytes, { flag: "wx" });
    return { url: `assets/${name}`, label };
  }
}
