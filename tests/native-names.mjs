// One name per note in the real app, on a library shaped like a OneNote
// export (CJK names, spaces written %20, full-width punctuation, entry
// texts and headings that differ from the file names, child pages, a
// subfolder): a title edited in the index view renames the note (file,
// index entry, heading, front-matter title and every link, anchors too),
// also while the index tab has unsaved changes; F2 in the tree does the
// same; saving a new heading renames the note with no question; "unify
// names" makes a folder agree in one step; one undo puts files back.
import { launchApp } from "./launch-app.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "marklore-names-")),
);
const library = path.join(temp, "kb"),
  profile = path.join(temp, "profile");
const files = {
  "_目录.md":
    "# 课程笔记\r\n\r\n- [第一章：集合与映射](第一章_集合与映射.md)\r\n  - [1.1 集合 （定义）](1.1%20集合%20（定义）.md)\r\n  - [映射](1.2%20映射.md)\r\n- [第二章 极限](第二章%20极限.md)\r\n- [习题](习题/_目录.md)\r\n",
  "第一章_集合与映射.md":
    "# 第一章：集合与映射\n\n见 [映射](1.2%20映射.md#12-映射) 和 [定义](<1.1 集合 （定义）.md#集合>)\n",
  "1.1 集合 （定义）.md":
    "---\ntitle: 1.1 集合 （定义）\n---\n\n# 1.1 集合 （定义）\n\n回到 [第一章](第一章_集合与映射.md)\n",
  "1.2 映射.md":
    "---\ntitle: 1.2 映射\n---\n# 1.2 映射\n\n[本页顶部](#12-映射)\n\n## 定义\n",
  "第二章 极限.md":
    '# 第二章 极限\n\n[第一章](第一章_集合与映射.md#第一章集合与映射) [映射](1.2%20映射.md "映射")\n',
  "习题/_目录.md": "- [习题一](习题一.md)\n",
  "习题/习题一.md":
    "[映射](../1.2%20映射.md#12-映射) [定义](../1.2%20映射.md#定义) [ch2](../%E7%AC%AC%E4%BA%8C%E7%AB%A0%20%E6%9E%81%E9%99%90.md)\n",
};
for (const [name, text] of Object.entries(files)) {
  await fs.mkdir(path.dirname(path.join(library, name)), { recursive: true });
  await fs.writeFile(path.join(library, name), text);
}
await fs.mkdir(profile);
await fs.writeFile(
  path.join(profile, "session.json"),
  JSON.stringify({ roots: [library], settings: { sidebar: true } }),
);
const read = (name) =>
  fs.readFile(path.join(library, name), "utf8").catch(() => null);
async function until(check, what, timeout = 10000) {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeout) throw Error("Timed out: " + what);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const exe = process.env.FOLIO_TEST_EXE;
let instance;
try {
  instance = await launchApp({
    ...(exe ? { executablePath: exe } : {}),
    args: exe ? [] : [project],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  const tree = page.locator("#tree");
  const file = (name) => tree.locator(`button.file[data-name="${name}"]`);
  await file("第一章_集合与映射.md").waitFor();
  // The tree shows notes by their heading; the file name only where it is
  // named otherwise.
  assert.equal(
    await file("第一章_集合与映射.md").innerText(),
    "第一章：集合与映射第一章_集合与映射.md",
  );
  assert.equal(await file("1.2 映射.md").innerText(), "1.2 映射");
  // The link index has read the library.
  await page.waitForFunction(async () => {
    const found = await window.folio.searchText("ch2");
    return found.results.some((r) => r.name === "习题一.md");
  });

  // ── The index view: a title edited there renames the note. ──
  await file("_目录.md").click();
  const view = page.locator("#content");
  await view.locator(".ix-list").first().waitFor();
  const entry = (title) =>
    view
      .locator(".ix-item")
      .filter({
        has: page.locator(":scope > .ix-row > .ix-title", { hasText: title }),
      })
      .first();
  // The view shows the note's name (its heading), not the entry's text.
  await entry("1.2 映射").waitFor();
  await page.keyboard.press("Control+2");
  // An unsaved change in the index first: the tab is dirty.
  await entry("第二章 极限").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await entry("1.2 映射").focus();
  await page.keyboard.press("F2");
  const input = view.locator("input.ix-title-input");
  await input.fill("1.2 映射：函数");
  await input.press("Enter");
  const ask = page.getByRole("dialog", {
    name: "把“映射”改名为“1.2 映射：函数”",
  });
  await ask.waitFor();
  assert.deepEqual(
    (await ask.locator(".tree-dialog-name").allTextContents()).sort(),
    [
      "1.2 映射.md",
      "习题一.md",
      "第一章_集合与映射.md",
      "第二章 极限.md",
    ].sort(),
  );
  await ask.getByRole("button", { name: /^更新 4 篇笔记的链接$/ }).click();
  await until(
    async () => (await read("1.2 映射：函数.md")) !== null,
    "renamed",
  );
  await until(
    async () =>
      (await read("习题/习题一.md"))?.includes("映射：函数.md#12-映射函数"),
    "links rewritten",
  );
  assert.equal(await read("1.2 映射.md"), null);
  assert.equal(
    await read("1.2 映射：函数.md"),
    "---\ntitle: 1.2 映射：函数\n---\n# 1.2 映射：函数\n\n[本页顶部](#12-映射函数)\n\n## 定义\n",
  );
  assert.equal(
    await read("第一章_集合与映射.md"),
    "# 第一章：集合与映射\n\n见 [映射](1.2%20映射：函数.md#12-映射函数) 和 [定义](<1.1 集合 （定义）.md#集合>)\n",
  );
  assert.equal(
    await read("习题/习题一.md"),
    "[映射](../1.2%20映射：函数.md#12-映射函数) [定义](../1.2%20映射：函数.md#定义) [ch2](../%E7%AC%AC%E4%BA%8C%E7%AB%A0%20%E6%9E%81%E9%99%90.md)\n",
  );
  // The index, open with unsaved changes, was not written: its draft has
  // the new entry; saving writes both changes.
  assert.equal(await read("_目录.md"), files["_目录.md"]);
  await entry("1.2 映射：函数").waitFor();
  await page.keyboard.press("Control+s");
  await until(
    async () => (await read("_目录.md")) !== files["_目录.md"],
    "index saved",
  );
  assert.equal(
    await read("_目录.md"),
    "# 课程笔记\r\n\r\n- [第二章 极限](第二章%20极限.md)\r\n- [第一章：集合与映射](第一章_集合与映射.md)\r\n  - [1.1 集合 （定义）](1.1%20集合%20（定义）.md)\r\n  - [1.2 映射：函数](1.2%20映射：函数.md)\r\n- [习题](习题/_目录.md)\r\n",
  );

  // ── F2 in the tree: the heading is edited; Windows-unsafe names map. ──
  await file("第二章 极限.md").focus();
  await page.keyboard.press("F2");
  const name = tree.getByRole("textbox", { name: "新名称" });
  assert.equal(await name.inputValue(), "第二章 极限");
  await name.fill("第二章: 极限?");
  await name.press("Enter");
  const ask2 = page.getByRole("dialog", {
    name: "把“第二章 极限”改名为“第二章: 极限?”",
  });
  await ask2.getByRole("button", { name: /^更新 \d+ 篇笔记的链接$/ }).click();
  await until(
    async () => (await read("第二章： 极限？.md")) !== null,
    "F2 rename",
  );
  assert.match(await read("第二章： 极限？.md"), /^# 第二章: 极限\?\n/);
  await until(
    async () =>
      (await read("_目录.md"))?.includes(
        "[第二章: 极限?](第二章：%20极限？.md)",
      ),
    "index entry after F2",
  );
  await until(
    async () =>
      (await read("习题/习题一.md"))?.includes(
        "%E7%AC%AC%E4%BA%8C%E7%AB%A0%EF%BC%9A%20%E6%9E%81%E9%99%90%EF%BC%9F.md",
      ),
    "fully encoded link after F2",
  );
  await file("第二章： 极限？.md").waitFor();

  // ── Saving a new heading renames the note, with no question. ──
  await file("第一章_集合与映射.md").click();
  await page
    .locator(".tab.active", { hasText: "第一章_集合与映射.md" })
    .waitFor();
  await page.keyboard.press("Control+3");
  const editor = page.locator("#editor .cm-content");
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  for (let i = 0; i < "：集合与映射".length; i++)
    await page.keyboard.press("Backspace");
  await page.keyboard.type(" 集合");
  // Typed, not saved: nothing renamed.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.notEqual(await read("第一章_集合与映射.md"), null);
  await page.keyboard.press("Control+s");
  await until(
    async () => (await read("第一章 集合.md")) !== null,
    "save rename",
  );
  assert.equal(await read("第一章_集合与映射.md"), null);
  await page.locator("#toast", { hasText: /已更新 \d+ 篇笔记/ }).waitFor();
  await page.locator(".tab.active", { hasText: "第一章 集合.md" }).waitFor();
  await until(
    async () =>
      (await read("1.1 集合 （定义）.md"))?.includes(
        "[第一章](第一章%20集合.md)",
      ),
    "links after the save rename",
  );
  await until(
    async () =>
      (await read("_目录.md"))?.includes("- [第一章 集合](第一章%20集合.md)"),
    "index after the save rename",
  );
  // The anchor of the old heading followed the new one.
  assert.match(
    await read("第二章： 极限？.md"),
    /\[第一章\]\(第一章%20集合\.md#第一章-集合\)/,
  );
  // Undo from the toast: the note's old file name, its links and its entry
  // (the heading saved stays as typed).
  await page.locator("#toast").getByRole("button", { name: "撤销" }).click();
  await until(
    async () => (await read("第一章_集合与映射.md")) !== null,
    "undo",
  );
  await until(
    async () =>
      (await read("_目录.md"))?.includes(
        "- [第一章：集合与映射](第一章_集合与映射.md)",
      ),
    "index after undo",
  );
  assert.match(
    await read("第二章： 极限？.md"),
    /\[第一章\]\(第一章_集合与映射\.md#第一章集合与映射\)/,
  );
  assert.match(await read("第一章_集合与映射.md"), /^# 第一章 集合\n/);

  // ── Unify names: the folder made to agree in one step. ──
  await fs.writeFile(path.join(library, "无标题.md"), "只有正文\n");
  await file("无标题.md").waitFor();
  await tree
    .locator("details.folder > summary", { hasText: "kb" })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /统一名字/ }).click();
  const unify = page.getByRole("dialog", { name: "统一“kb”中的名字" });
  await unify.locator(".unify-item").first().waitFor();
  await unify.getByText("包括子文件夹").click();
  await unify.locator(".unify-item", { hasText: "习题一" }).waitFor();
  assert.deepEqual(await unify.locator(".unify-item").allInnerTexts(), [
    "第一章 集合\n文件名 第一章_集合与映射.md → 第一章 集合.md；目录条目“第一章：集合与映射”",
    "无标题\n加上标题",
    "习题一\n加上标题",
  ]);
  await unify.getByRole("button", { name: "统一名字" }).click();
  await until(async () => (await read("第一章 集合.md")) !== null, "unified");
  await page.locator("#toast", { hasText: /已统一 3 篇笔记的名字/ }).waitFor();
  assert.equal(await read("无标题.md"), "# 无标题\n\n只有正文\n");
  assert.match(await read("习题/习题一.md"), /^# 习题一\n\n/);
  assert.match(
    await read("第二章： 极限？.md"),
    /\[第一章\]\(第一章%20集合\.md#第一章集合与映射\)/,
  );
  assert.match(
    await read("_目录.md"),
    /- \[第一章 集合\]\(第一章%20集合\.md\)/,
  );
  // Each file rewritten was backed up first.
  assert.ok((await fs.readdir(path.join(profile, "backups"))).length >= 10);
  console.log(
    "Native names passed: a title edited in the index view renames the note (file, index entry, heading, front-matter title, links and anchors), also with the index tab unsaved; F2 in the tree edits the heading and maps names Windows refuses; saving a new heading renames the note without a question and is undone in one step; unify names makes a folder agree in one batch.",
  );
} finally {
  if (instance) {
    await instance
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await instance.close().catch(() => {});
  }
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
