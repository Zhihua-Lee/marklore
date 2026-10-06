import fs from "node:fs/promises";
import { realpath as walkRealpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { t } from "./i18n.mjs";

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
  constructor({ backups } = {}) {
    this.backups = backups;
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
    if (!markdownPath(real)) throw Error(t("仅支持 Markdown 或文本文件"));
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
      if (!item.isDirectory() && !markdownPath(item.name)) continue;
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
    return result.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
    );
  }
  async openChild(id, name) {
    const folder = this.directories.get(id);
    if (!folder || path.basename(name) !== name) throw Error(t("未授权的文件"));
    await unchangedPath(folder);
    const real = await realPath(path.join(folder, name));
    if (!within(folder, real)) throw Error(t("文件位于所选文件夹之外"));
    return this.open(real);
  }
  async search(ids, query, limit = 200) {
    const q = String(query).trim().toLocaleLowerCase();
    if (!q) return { items: [], truncated: false };
    const queue = [...new Set(ids)],
      seen = new Set(),
      items = [];
    let visited = 0;
    while (queue.length && visited < 10000) {
      const id = queue.shift(),
        folder = this.directories.get(id);
      if (!folder || seen.has(folder)) continue;
      seen.add(folder);
      visited++;
      let children;
      try {
        children = await this.list(id);
      } catch {
        continue;
      }
      for (const child of children) {
        if (child.directory) queue.push(child.id);
        else if (child.name.toLocaleLowerCase().includes(q)) {
          items.push({ ...child, parent: id });
          if (items.length >= limit) return { items, truncated: true };
        }
      }
    }
    return { items, truncated: queue.length > 0 };
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
