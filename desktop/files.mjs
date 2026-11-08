import fs from "node:fs/promises";
import { realpath as walkRealpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { t } from "./i18n.mjs";
import { createNameWalks } from "./name-walk.mjs";
import { findIndexName, indexOrder, moveInIndex } from "./folder-index.mjs";

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
      if (this.backups) {
        await fs.mkdir(this.backups, { recursive: true });
        // Preserve each distinct disk version; never silently overwrite a recovery copy.
        await fs
          .writeFile(
            path.join(
              this.backups,
              hash(file.path) + "-" + hash(current) + ".bak",
            ),
            current,
            { flag: "wx" },
          )
          .catch((e) => {
            if (e.code !== "EEXIST") throw e;
          });
      }
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
      else
        result.push({ name: item.name, path: p, parent: id, directory: false });
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
    return [
      { ...index, index: true },
      ...listed,
      ...items.filter((item) => !taken.has(item)),
    ];
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
    const folder = this.directories.get(id);
    if (!folder) throw Error(t("未授权的文件夹"));
    await unchangedPath(folder);
    for (const child of [name, target])
      if (
        typeof child !== "string" ||
        !child ||
        child === "." ||
        child === ".." ||
        path.basename(child) !== child
      )
        throw Error(t("未授权的文件"));
    const indexName = findIndexName(await fs.readdir(folder));
    if (!indexName) throw Error(t("这个文件夹没有目录文件"));
    const file = path.join(folder, indexName);
    if ((await realPath(file)) !== file) throw Error(t("未授权的文件"));
    const moved = await fs.stat(path.join(folder, name));
    const bytes = await this.readBytes(file);
    const info = decode(bytes);
    const text = moveInIndex(info.text, name, target, place, {
      folder: moved.isDirectory(),
    });
    if (text === null) return null;
    const temp = path.join(folder, `.folio-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, encode(text, info), { flag: "wx" });
      if (hash(await this.readBytes(file)) !== hash(bytes))
        throw Error(t("目录文件刚被其他程序修改，请重试"));
      await fs.rename(temp, file);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    this.indexes.delete(file);
    return file;
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
    if (!folder || typeof name !== "string" || path.basename(name) !== name)
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
  // A new empty note or folder in an authorized folder; never replaces one.
  async createEntry(id, name, kind) {
    const folder = this.folderPath(id);
    await unchangedPath(folder);
    FileStore.checkName(name);
    if (kind !== "folder" && !markdownPath(name))
      throw Error(t("笔记名称须以 .md 结尾"));
    const target = path.join(folder, name);
    try {
      if (kind === "folder") await fs.mkdir(target);
      else await fs.writeFile(target, "", { flag: "wx" });
    } catch (e) {
      if (e.code === "EEXIST") throw Error(t("已有同名的文件或文件夹"));
      throw e;
    }
    return kind === "folder"
      ? { ...(await this.directory(target)), directory: true }
      : { path: target };
  }
  // Rename an entry in its folder. Open notes and listed folders inside it
  // keep their handles, now at the new path. Returns the notes moved.
  async renameEntry(id, name, newName) {
    const source = await this.childPath(id, name);
    FileStore.checkName(newName);
    const stat = await fs.stat(source);
    if (!stat.isDirectory() && !this.openable(newName))
      throw Error(t("笔记名称须以 .md 结尾"));
    const target = path.join(path.dirname(source), newName);
    if (target === source) return { path: source, files: [] };
    // A change of case only is the same entry on Windows.
    if (target.toLowerCase() !== source.toLowerCase()) {
      const taken = await fs.lstat(target).then(
        () => true,
        (e) => e.code !== "ENOENT",
      );
      if (taken) throw Error(t("已有同名的文件或文件夹"));
    }
    if ([...this.locks].some((p) => p === source || within(source, p)))
      throw Error(t("正在保存，请稍候"));
    await fs.rename(source, target);
    const moved = (p) =>
      p === source
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
    return { path: target, files };
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
