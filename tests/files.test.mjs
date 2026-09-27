import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  FileStore,
  MAX_BYTES,
  decode,
  encode,
  within,
} from "../desktop/files.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    store: new FileStore({ backups: path.join(root, "backups") }),
  };
}
test("UTF-8 BOM and CRLF roundtrip", () => {
  const b = Buffer.from("\uFEFF# 中文\r\n测试\r\n");
  const info = decode(b);
  assert.equal(info.text, "# 中文\n测试\n");
  assert.deepEqual(encode(info.text, info), b);
});

test("image insertion copies a selected image without overwriting source or note", async (t) => {
  const { root, store } = await fixture(t);
  const file = path.join(root, "note.md"),
    source = path.join(root, "图 1.png");
  await fs.writeFile(file, "# Unchanged");
  await fs.writeFile(source, Buffer.from([137, 80, 78, 71]));
  const doc = await store.open(file);
  const a = await store.importImage(doc.id, source),
    b = await store.importImage(doc.id, source);
  assert.notEqual(a.url, b.url);
  assert.equal(a.label, "图 1");
  assert.deepEqual(
    await fs.readFile(await store.asset(doc.id, a.url)),
    await fs.readFile(source),
  );
  assert.equal(await fs.readFile(file, "utf8"), "# Unchanged");
  await assert.rejects(store.importImage("fake", source), /未授权/);
  await assert.rejects(store.importImage(doc.id, file), /图片/);
});
test("current folder derives only from an opened file handle", async (t) => {
  const { root, store } = await fixture(t);
  const folder = path.join(root, "notes");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "current.md"), "# Current");
  await fs.writeFile(path.join(folder, "sibling.md"), "# Sibling");
  const doc = await store.open(path.join(folder, "current.md"));
  const current = await store.currentFolder(doc.id);
  assert.equal(current.path, await fs.realpath(folder));
  assert.deepEqual(
    (await store.list(current.id)).map((x) => x.name),
    ["current.md", "sibling.md"],
  );
  await assert.rejects(store.currentFolder(folder), /未授权/);
  assert.equal((await store.currentFolder(doc.id)).id, current.id);
});
test("UTF-16LE roundtrip", () => {
  const b = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from("中文\r\n", "utf16le"),
  ]);
  const info = decode(b);
  assert.deepEqual(encode(info.text, info), b);
});
test("path boundary prevents sibling prefix escape", () => {
  assert.equal(within("C:/notes", "C:/notes-other/test.md"), false);
  assert.equal(within("C:/notes", "C:/notes/sub/test.md"), true);
});
test("save refuses stale disk baseline and retains external edits", async (t) => {
  const { root, store } = await fixture(t),
    p = path.join(root, "note.md");
  await fs.writeFile(p, "old");
  const doc = await store.open(p);
  await fs.writeFile(p, "external");
  assert.deepEqual(await store.save(doc.id, "mine", doc.version), {
    conflict: true,
  });
  assert.equal(await fs.readFile(p, "utf8"), "external");
});
test("save writes exact text and preserves recovery version", async (t) => {
  const { root, store } = await fixture(t),
    p = path.join(root, "note.md");
  await fs.writeFile(p, "old\r\n");
  const doc = await store.open(p),
    saved = await store.save(doc.id, "new\n", doc.version);
  assert.ok(saved.version);
  assert.equal(await fs.readFile(p, "utf8"), "new\r\n");
  const backups = await fs.readdir(path.join(root, "backups"));
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(root, "backups", backups[0]), "utf8"),
    "old\r\n",
  );
});
test("open deduplicates real paths; unchanged reads do not transfer text", async (t) => {
  const { root, store } = await fixture(t),
    p = path.join(root, "note.md");
  await fs.writeFile(p, "hello");
  const a = await store.open(p),
    b = await store.open(p);
  assert.equal(a.id, b.id);
  assert.equal((await store.read(a.id, a.version)).unchanged, true);
});
test("opaque handles reject forged access", async () => {
  const s = new FileStore();
  await assert.rejects(s.read("forged"), /未授权/);
  await assert.rejects(s.list("forged"), /未授权/);
});
test("lazy folder listing ignores hidden and non-note files", async (t) => {
  const { root, store } = await fixture(t);
  await Promise.all(
    ["a.md", "b.txt", ".secret.md", "image.png"].map((n) =>
      fs.writeFile(path.join(root, n), ""),
    ),
  );
  const d = await store.directory(root),
    list = await store.list(d.id);
  assert.deepEqual(
    list.map((x) => x.name),
    ["a.md", "b.txt"],
  );
  await assert.rejects(store.openChild(d.id, "../bad.md"), /未授权/);
});
test("assets cannot escape authorized folder", async (t) => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, "notes"));
  const p = path.join(root, "notes/a.md");
  await fs.writeFile(p, "");
  await fs.writeFile(path.join(root, "secret.png"), "test");
  const d = await store.open(p);
  await assert.rejects(store.asset(d.id, "../secret.png"), /之外/);
});
test("non-note files are not opened through links", async (t) => {
  const { root, store } = await fixture(t);
  const p = path.join(root, "bad.exe");
  await fs.writeFile(p, "data");
  await assert.rejects(store.open(p), /仅支持/);
});
test("notebook search includes collapsed descendants and remains root-scoped", async (t) => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, "deep"));
  await fs.writeFile(path.join(root, "deep", "概率论.md"), "# note");
  const folder = await store.directory(root),
    result = await store.search([folder.id], "概率");
  assert.equal(result.items.length, 1);
  const doc = await store.openChild(
    result.items[0].parent,
    result.items[0].name,
  );
  assert.equal(doc.text, "# note");
  assert.deepEqual((await store.search(["forged"], "概率")).items, []);
});
test("UTF-16 encoded size cannot exceed the readable limit or replace the original", async (t) => {
  const { root, store } = await fixture(t),
    p = path.join(root, "utf16.md"),
    original = Buffer.concat([
      Buffer.from([255, 254]),
      Buffer.from("old", "utf16le"),
    ]);
  await fs.writeFile(p, original);
  const doc = await store.open(p);
  await assert.rejects(
    store.save(doc.id, "a".repeat(MAX_BYTES / 2), doc.version),
    /编码后的文件过大/,
  );
  assert.deepEqual(await fs.readFile(p), original);
  assert.deepEqual(await fs.readdir(root), ["utf16.md"]);
});
test("hover preview resolves encoded local paths and returns known handles without changing baseline", async (t) => {
  const { root, store } = await fixture(t),
    source = path.join(root, "source.md"),
    target = path.join(root, "中文 空格.md");
  await fs.writeFile(source, "# Source");
  await fs.writeFile(target, "# Original");
  const doc = await store.open(source),
    first = await store.preview(
      doc.id,
      encodeURIComponent(path.basename(target)),
    );
  assert.equal(first.text, "# Original");
  assert.equal(first.path, await fs.realpath(target));
  await fs.writeFile(target, "# Changed");
  const next = await store.preview(doc.id, target);
  assert.equal(next.id, first.id);
  assert.equal(next.text, undefined);
  // The main process keeps an authorization record, never the decoded document.
  assert.equal(store.file(first.id).text, undefined);
  assert.deepEqual(Object.keys(store.file(first.id)).sort(), [
    "bom",
    "encoding",
    "eol",
    "path",
  ]);
  assert.equal((await store.read(next.id, first.version)).text, "# Changed");
});
test("hover preview permits selected notebook roots and explicitly opened target files", async (t) => {
  const { root, store } = await fixture(t),
    notes = path.join(root, "notes"),
    notebook = path.join(root, "notebook"),
    outside = path.join(root, "outside.md");
  await fs.mkdir(notes);
  await fs.mkdir(notebook);
  await fs.writeFile(path.join(notes, "source.md"), "source");
  await fs.writeFile(path.join(notebook, "target.md"), "target");
  await fs.writeFile(outside, "outside");
  const source = await store.open(path.join(notes, "source.md"));
  await assert.rejects(
    store.preview(source.id, "../notebook/target.md"),
    /授权文件夹之外/,
  );
  assert.equal(store.files.size, 1);
  await store.directory(notebook);
  assert.equal(
    (await store.preview(source.id, "../notebook/target.md")).text,
    "target",
  );
  await assert.rejects(
    store.preview(source.id, "../outside.md"),
    /授权文件夹之外/,
  );
  const opened = await store.open(outside),
    preview = await store.preview(source.id, "../outside.md");
  assert.equal(preview.id, opened.id);
  assert.equal(preview.text, undefined);
});
test("hover preview rejects external protocols, malformed links and non-note files", async (t) => {
  const { root, store } = await fixture(t),
    p = path.join(root, "note.md");
  await fs.writeFile(p, "source");
  await fs.writeFile(path.join(root, "image.png"), "image");
  const doc = await store.open(p);
  await assert.rejects(
    store.preview(doc.id, "https://example.com/note.md"),
    /协议/,
  );
  await assert.rejects(store.preview(doc.id, "%XX"), URIError);
  await assert.rejects(store.preview(doc.id, "image.png"), /仅预览/);
  await assert.rejects(store.preview(doc.id, null), /无效链接/);
  await assert.rejects(store.preview("forged", "note.md"), /未授权/);
});
test("network share links are rejected synchronously before any filesystem lookup", () => {
  const store = new FileStore();
  store.files.set("local", { path: path.resolve("source.md") });
  for (const href of [
    "\\\\server.invalid\\share\\note.md",
    "//server.invalid/share/note.md",
    "%5C%5Cserver.invalid%5Cshare%5Cnote.md",
    "%2F%2Fserver.invalid/share/note.md",
    "<//server.invalid/share/note.md>",
  ]) {
    assert.throws(() => store.resolve("local", href), /暂不支持网络共享路径/);
  }
  assert.throws(
    () => store.resolve("local", "file://server.invalid/share/note.md"),
    /不支持此链接协议/,
  );
});
test("a junction to outside the source folder requires authorization and cannot be hovered", async (t) => {
  const { root, store } = await fixture(t),
    notes = path.join(root, "notes"),
    outside = path.join(root, "outside");
  await fs.mkdir(notes);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(notes, "source.md"), "source");
  await fs.writeFile(path.join(outside, "secret.md"), "secret");
  await fs.symlink(outside, path.join(notes, "jump"), "junction");
  const doc = await store.open(path.join(notes, "source.md")),
    target = await store.linkTarget(doc.id, "jump/secret.md");
  assert.equal(target.path, await fs.realpath(path.join(outside, "secret.md")));
  assert.equal(target.authorized, false);
  await assert.rejects(
    store.preview(doc.id, "jump/secret.md"),
    /授权文件夹之外/,
  );
  assert.equal(store.files.size, 1);
  const folder = await store.directory(notes);
  assert.deepEqual(
    (await store.list(folder.id)).map((item) => item.name),
    ["source.md"],
  );
});
test("replaced authorized directories cannot leak through read, list, child or preview handles", async (t) => {
  const { root, store } = await fixture(t),
    notes = path.join(root, "notes"),
    outside = path.join(root, "outside");
  await fs.mkdir(notes);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(notes, "source.md"), "original");
  await fs.writeFile(path.join(outside, "source.md"), "outside secret");
  const doc = await store.open(path.join(notes, "source.md")),
    folder = await store.directory(notes);
  await fs.rename(notes, path.join(root, "original-notes"));
  await fs.symlink(outside, notes, "junction");
  await assert.rejects(store.read(doc.id, doc.version), /路径已改变/);
  await assert.rejects(store.list(folder.id), /路径已改变/);
  await assert.rejects(store.openChild(folder.id, "source.md"), /路径已改变/);
  await assert.rejects(store.preview(doc.id, "source.md"), /路径已改变/);
  await assert.rejects(
    store.save(doc.id, "overwrite", doc.version),
    /路径已改变/,
  );
  assert.equal(
    await fs.readFile(path.join(outside, "source.md"), "utf8"),
    "outside secret",
  );
});
