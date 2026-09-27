import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileStore } from "../desktop/files.mjs";
import { createLinkOpener } from "../desktop/links.mjs";
test("Markdown links stay internal; supported attachments open directly, never run scripts", async (t) => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-links-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of [
    "source.md",
    "other.md",
    "报告 one.pdf",
    "plot.png",
    "data.xlsx",
    "run.exe",
    "run.ps1",
    "site.url",
  ])
    await fs.writeFile(path.join(root, name), "fixture");
  const files = new FileStore(),
    doc = await files.open(path.join(root, "source.md"));
  const opened = [],
    internal = [],
    questions = [];
  let response = 0,
    shellError = "";
  const open = createLinkOpener({
    files,
    owner: () => null,
    dialog: {
      showMessageBox: async (_win, options) => {
        questions.push(options);
        return { response };
      },
    },
    shell: {
      openPath: async (target) => {
        opened.push(target);
        return shellError;
      },
      openExternal: async (target) => opened.push(target),
    },
    openFile: async (target) => {
      internal.push(target);
      return { path: target };
    },
  });
  await open(doc.id, "other.md");
  assert.equal(internal.length, 1);
  assert.equal(questions.length, 0);
  for (const href of ["报告%20one.pdf", "plot.png", "data.xlsx"])
    await open(doc.id, href);
  assert.equal(opened.length, 3);
  assert.equal(questions.length, 0);
  assert.equal(internal.length, 1);
  assert.equal(opened[0], path.join(root, "报告 one.pdf"));
  for (const name of ["run.exe", "run.ps1", "site.url"])
    await assert.rejects(open(doc.id, name), /不从笔记启动/);
  shellError = "No association";
  await assert.rejects(open(doc.id, "plot.png"), /无法打开/);
  await assert.rejects(open(doc.id, "."), /普通文件/);
  await assert.rejects(open(doc.id, "javascript:alert(1)"), /协议/);
  await open(doc.id, "https://example.com");
  assert.equal(questions.length, 1);
  assert.equal(opened.includes("https://example.com/"), false);
  response = 1;
  await open(doc.id, "https://example.com");
  assert.equal(opened.at(-1), "https://example.com/");
});
