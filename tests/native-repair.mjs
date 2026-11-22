// Repair after a change made by another program, in the real app: a note
// renamed outside Marklore leaves a broken link and a missing index entry;
// the watcher's rename is offered as where they should lead, the repair is
// backed up and undone in one step, and nothing is rewritten unasked. A
// folder holding an open note moves (its watchers let go and bound again)
// and the note still follows edits made after the move.
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
  await fs.mkdtemp(path.join(os.tmpdir(), "marklore-repair-")),
);
const library = path.join(temp, "kb"),
  profile = path.join(temp, "profile");
const files = {
  "_目录.md": "- [Plan](Plan.md)\n- [Other](Other.md)\n",
  "Plan.md": "# Plan\n\n## Goals\n",
  "Other.md": "# Other\n\nSee [the plan](Plan.md#goals).\n",
  "Topic/Inner.md": "# Inner\n\nFirst.\n",
};
for (const [name, text] of Object.entries(files)) {
  await fs.mkdir(path.dirname(path.join(library, name)), { recursive: true });
  await fs.writeFile(path.join(library, name), text);
}
await fs.mkdir(path.join(library, "Box"));
await fs.mkdir(profile);
await fs.writeFile(
  path.join(profile, "session.json"),
  JSON.stringify({ roots: [library], settings: { sidebar: true } }),
);
const read = (name) =>
  fs.readFile(path.join(library, name), "utf8").catch(() => null);
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
  await row("Other.md").click();
  await page.locator("#content h1", { hasText: "Other" }).waitFor();

  // Another program renames Plan.md: nothing is rewritten by itself.
  await fs.rename(
    path.join(library, "Plan.md"),
    path.join(library, "Roadmap.md"),
  );
  await row("Roadmap.md").waitFor({ timeout: 5000 });
  const broken = page.locator(
    '#content a.link-broken[data-broken="missing-file"]',
  );
  for (let i = 0; i < 30 && !(await broken.count()); i++) {
    await row("Other.md").click();
    await page.waitForTimeout(200);
  }
  await broken.waitFor();
  assert.equal(await read("Other.md"), files["Other.md"]);
  assert.equal(await read("_目录.md"), files["_目录.md"]);

  // Repaired on the reader's word, to where the watcher saw it go.
  await broken.click({ button: "right" });
  await page.getByRole("menuitem", { name: "修复链接…" }).click();
  const dialog = page.getByRole("dialog", { name: "“Plan.md”不存在" });
  await dialog
    .getByRole("option", { name: /Roadmap\.md.*刚被改名或移动到这里/ })
    .waitFor();
  await dialog.getByRole("button", { name: "改为指向所选" }).click();
  await until(
    async () => (await read("Other.md"))?.includes("Roadmap.md#goals"),
    "link relocated",
  );
  assert.equal(
    await read("Other.md"),
    "# Other\n\nSee [the plan](Roadmap.md#goals).\n",
  );
  assert.ok((await fs.readdir(path.join(profile, "backups"))).length >= 1);
  // One undo puts it back.
  await page.locator("#toast").getByRole("button", { name: "撤销" }).click();
  await until(
    async () => (await read("Other.md")) === files["Other.md"],
    "repair undone",
  );

  // The folder's index: its row says an entry is missing; repaired there.
  const index = tree.locator(".file", { hasText: "_目录.md" });
  await until(
    async () => (await index.getAttribute("data-missing")) === "1 项不存在",
    "index marked",
  );
  await index.click({ button: "right" });
  await page.getByRole("menuitem", { name: "修复不存在的条目…" }).click();
  const entry = page.getByRole("dialog", { name: "“Plan.md”不存在" });
  await entry
    .getByRole("option", { name: /Roadmap\.md.*刚被改名或移动到这里/ })
    .click();
  await entry.getByRole("button", { name: "改为指向所选" }).click();
  await until(
    async () => (await read("_目录.md"))?.includes("[Roadmap](Roadmap.md)"),
    "index entry relocated",
  );
  assert.equal(
    await read("_目录.md"),
    "- [Roadmap](Roadmap.md)\n- [Other](Other.md)\n",
  );
  await until(
    async () => (await index.getAttribute("data-missing")) === null,
    "index no longer marked",
  );

  // A folder holding an open note moves; the note follows edits after it.
  await tree.getByText("Topic", { exact: true }).click();
  await row("Inner.md").click();
  await page.locator("#content h1", { hasText: "Inner" }).waitFor();
  await tree
    .locator("details.folder > summary", { hasText: "Topic" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动到…" }).click();
  const picker = page.getByRole("dialog", { name: "把“Topic”移动到…" });
  await picker.getByRole("searchbox").fill("box");
  await picker.locator(".folder-option.active", { hasText: "Box" }).waitFor();
  await page.keyboard.press("Enter");
  const ask = page.getByRole("dialog", { name: "把“Topic”移到“Box”" });
  if (await ask.isVisible().catch(() => false))
    await ask.getByRole("button", { name: /^更新|^移动$/ }).click();
  const moved = path.join(library, "Box", "Topic", "Inner.md");
  await until(
    () =>
      fs.stat(moved).then(
        () => true,
        () => false,
      ),
    "folder moved",
  );
  await fs.appendFile(moved, "\n## After the move\n");
  await page
    .locator("#content h2", { hasText: "After the move" })
    .waitFor({ timeout: 8000 });
  console.log(
    "Native repair passed: a note renamed by another program leaves its links and index entry as they were until the reader repairs them; the rename the watcher saw is offered, the repair is backed up and undone in one step; a folder holding an open note moves and the note still follows edits after the move.",
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
