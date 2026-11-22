// Renames and moves in the real app, on a library on disk: the notes that
// link to a renamed note are listed and rewritten (each backed up), the
// folder's index follows, one undo puts every file back byte for byte; a
// move to another folder carries the note's child page and rewrites its
// own relative links; a note open with unsaved changes is patched in its
// draft and never written.
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
  await fs.mkdtemp(path.join(os.tmpdir(), "marklore-moves-")),
);
const library = path.join(temp, "kb"),
  profile = path.join(temp, "profile");
const files = {
  "_目录.md":
    "# kb\r\n\r\n- [Plan](Plan.md)\r\n  - [Child](Child.md)\r\n- [Other](Other.md)\r\n- [Topics](Topics/)\r\n",
  "Plan.md": "# Plan\n\n![img](assets/a.png) See [other](Other.md).\n",
  "Child.md": "# Child\n\nUp: [plan](Plan.md#plan).\n",
  "Other.md": "# Other\n\nThe [plan](Plan.md#plan) and [child](<Child.md>).\n",
  "Topics/T.md": "# T\n\n[plan](../Plan.md 'The plan')\n",
  "assets/a.png": "not really a png",
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
const snapshot = async () => {
  const out = {};
  for (const name of [...Object.keys(files), "Topics/Plan.md"])
    out[name] = await read(name);
  return out;
};
async function until(check, what, timeout = 8000) {
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
  const row = (name) => tree.locator(`button.file[data-name="${name}"]`);
  await row("Plan.md").waitFor();
  const before = await snapshot();
  // The link index has read the library (Other.md links to Plan.md).
  await page.waitForFunction(async () => {
    const found = await window.folio.searchText("plan");
    return found.results.some((r) => r.name === "Other.md");
  });

  // Rename by F2: the notes linking to it are asked about first.
  await row("Plan.md").focus();
  await page.keyboard.press("F2");
  const name = tree.getByRole("textbox", { name: "新名称" });
  await name.fill("Road map");
  await name.press("Enter");
  const ask = page.getByRole("dialog", {
    name: "把“Plan”改名为“Road map”",
  });
  await ask.waitFor();
  assert.deepEqual(await ask.locator(".tree-dialog-name").allTextContents(), [
    "Child.md",
    "Other.md",
    "T.md",
  ]);
  // The anchor of its heading follows the new heading.
  await ask.getByRole("button", { name: "更新 3 篇笔记的链接" }).click();
  await until(
    async () => (await read("Other.md"))?.includes("Road%20map.md#road-map"),
    "links rewritten",
  );
  assert.equal(
    await read("Other.md"),
    "# Other\n\nThe [plan](Road%20map.md#road-map) and [child](<Child.md>).\n",
  );
  assert.equal(
    await read("Child.md"),
    "# Child\n\nUp: [plan](Road%20map.md#road-map).\n",
  );
  assert.equal(
    await read("Topics/T.md"),
    "# T\n\n[plan](../Road%20map.md 'The plan')\n",
  );
  assert.equal(
    await read("_目录.md"),
    files["_目录.md"].replace(
      "- [Plan](Plan.md)",
      "- [Road map](Road%20map.md)",
    ),
  );
  // Its heading is its name: renamed with it.
  assert.equal(
    await read("Road map.md"),
    files["Plan.md"].replace("# Plan", "# Road map"),
  );
  // Each file was backed up before it was rewritten.
  assert.equal((await fs.readdir(path.join(profile, "backups"))).length, 5);
  await row("Road map.md").waitFor();

  // One undo, from the toast: every name and text as before.
  await page.locator("#toast").getByRole("button", { name: "撤销" }).click();
  await until(async () => (await read("Plan.md")) !== null, "undo");
  await until(
    async () => JSON.stringify(await snapshot()) === JSON.stringify(before),
    "undo restored every file",
  );
  await row("Plan.md").waitFor();

  // Move to another folder, with its child page: chosen from the list.
  await row("Plan.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动到…" }).click();
  const picker = page.getByRole("dialog", { name: "把“Plan.md”移动到…" });
  await picker.getByRole("searchbox").fill("topics");
  await picker
    .locator(".folder-option.active", { hasText: "Topics" })
    .waitFor();
  await page.keyboard.press("Enter");
  const move = page.getByRole("dialog", { name: "把“Plan.md”移到“Topics”" });
  await move.getByRole("checkbox", { name: "同时移动 1 个子页" }).waitFor();
  await move.getByRole("button", { name: /^更新 \d+ 篇笔记的链接$/ }).click();
  await until(async () => (await read("Topics/Plan.md")) !== null, "moved");
  await until(
    async () => (await read("Other.md"))?.includes("Topics/Plan.md"),
    "links after the move",
  );
  assert.equal(
    await read("Topics/Plan.md"),
    "# Plan\n\n![img](../assets/a.png) See [other](../Other.md).\n",
  );
  assert.equal(await read("Topics/Child.md"), files["Child.md"]);
  assert.equal(
    await read("Other.md"),
    "# Other\n\nThe [plan](Topics/Plan.md#plan) and [child](<Topics/Child.md>).\n",
  );
  assert.equal(
    await read("Topics/T.md"),
    "# T\n\n[plan](Plan.md 'The plan')\n",
  );
  assert.equal(
    await read("_目录.md"),
    "# kb\r\n\r\n- [Other](Other.md)\r\n- [Topics](Topics/)\r\n",
  );

  // Undo from the tree's menu.
  await tree
    .locator("details.folder > summary", { hasText: "kb" })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /撤销上次改名\/移动/ }).click();
  await until(
    async () => JSON.stringify(await snapshot()) === JSON.stringify(before),
    "undo of the move",
  );

  // A note open with unsaved changes: its draft follows, its file stays.
  await row("Other.md").click();
  await page.locator(".tab.active", { hasText: "Other.md" }).waitFor();
  await page.keyboard.press("Control+3");
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Draft.");
  await row("Plan.md").focus();
  await page.keyboard.press("F2");
  await name.fill("Goals");
  await name.press("Enter");
  const ask2 = page.getByRole("dialog", {
    name: "把“Plan”改名为“Goals”",
  });
  await ask2.getByRole("button", { name: "更新 3 篇笔记的链接" }).click();
  await until(async () => (await read("Goals.md")) !== null, "renamed again");
  await page
    .locator("#editor .cm-content", { hasText: "[plan](Goals.md#goals)" })
    .waitFor();
  assert.match(
    await page.locator("#editor .cm-content").textContent(),
    /Draft\.$/,
  );
  assert.equal(await read("Other.md"), files["Other.md"]);
  assert.equal(await page.locator("#conflict").isVisible(), false);
  assert.equal(
    await read("Child.md"),
    "# Child\n\nUp: [plan](Goals.md#goals).\n",
  );
  console.log(
    "Native moves passed: a rename lists the notes linking to it, rewrites them and the folder's index (each backed up), and one undo restores every file byte for byte; a move to another folder carries the child page, rewrites incoming links and the note's own relative links, and is undone from the menu; a note open with unsaved changes is patched in its draft and not written.",
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
