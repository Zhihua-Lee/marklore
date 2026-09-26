import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

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
  if ((await fs.realpath(file)) !== file)
    throw Error("文件或文件夹路径已改变，请重新打开");
  return file;
}
export function decode(bytes) {
  if (bytes.includes(0) && !(bytes[0] === 255 && bytes[1] === 254))
    throw Error("不支持二进制文件或 UTF-16BE，请转换为 UTF-8");
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
export class FileStore {
  files = new Map();
  directories = new Map();
  locks = new Set();
  constructor({ backups } = {}) {
    this.backups = backups;
  }
  file(id) {
    const entry = this.files.get(id);
    if (!entry) throw Error("未授权的文件");
    return entry;
  }
  async readBytes(file) {
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES)
        throw Error("文件过大（上限 32 MB）或不是普通文件");
      const bytes = await handle.readFile();
      if (bytes.length > MAX_BYTES) throw Error("文件过大");
      return bytes;
    } finally {
      await handle.close();
    }
  }
  async open(file) {
    const real = await fs.realpath(file);
    if (!markdownPath(real)) throw Error("仅支持 Markdown 或文本文件");
    const existing = [...this.files].find(([, f]) => f.path === real);
    const id = existing?.[0] ?? randomUUID();
    const bytes = await this.readBytes(real),
      info = decode(bytes);
    this.files.set(id, { path: real, ...info });
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
    Object.assign(file, info);
    return { text: info.text, version: digest };
  }
  async save(id, text, version) {
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES)
      throw Error("无效或过大的文档");
    const file = this.file(id);
    if (this.locks.has(file.path)) throw Error("正在保存，请稍候");
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
        throw Error("编码后的文件过大（上限 32 MB），未保存");
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
      Object.assign(file, info, { text });
      return { version: hash(bytes) };
    } finally {
      this.locks.delete(file.path);
      await fs.unlink(temp).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  }
  async directory(folder) {
    const real = await fs.realpath(folder);
    const existing = [...this.directories].find(([, p]) => p === real);
    const id = existing?.[0] ?? randomUUID();
    this.directories.set(id, real);
    return { id, name: path.basename(real), path: real };
  }
  async list(id) {
    const folder = this.directories.get(id);
    if (!folder) throw Error("未授权的文件夹");
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
        real = await fs.realpath(p);
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
    if (!folder || path.basename(name) !== name) throw Error("未授权的文件");
    await unchangedPath(folder);
    const real = await fs.realpath(path.join(folder, name));
    if (!within(folder, real)) throw Error("文件位于所选文件夹之外");
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
      throw Error("暂不支持网络共享路径，请使用本机磁盘文件");
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded))
      throw Error("不支持此链接协议");
    return path.resolve(path.dirname(base), decoded);
  }
  async linkTarget(id, href) {
    if (typeof href !== "string" || href.length > 8192) throw Error("无效链接");
    const base = this.file(id),
      target = this.resolve(id, href);
    await unchangedPath(base.path);
    const real = await fs.realpath(target);
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
        "目标位于授权文件夹之外；请点击链接确认打开，或先添加笔记文件夹。",
      );
    if (!markdownPath(real)) throw Error("仅预览 Markdown 或文本文件");
    // A known handle lets the renderer prefer an open, unsaved document without
    // transferring or changing its disk baseline. Preview does not start a watcher.
    if (existingId)
      return { id: existingId, path: real, name: path.basename(real) };
    return this.open(real);
  }
  async asset(id, href) {
    const file = this.file(id),
      real = await fs.realpath(this.resolve(id, href));
    const roots = [path.dirname(file.path), ...this.directories.values()];
    if (!roots.some((root) => within(root, real)))
      throw Error("图片位于授权文件夹之外");
    if (!/\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(real))
      throw Error("不支持的图片类型");
    return real;
  }
}
