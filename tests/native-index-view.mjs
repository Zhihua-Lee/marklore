// A folder's index file in the real app: its list shows as the folder's
// pages with what main knows of the folder (first sentences, a missing page,
// files not listed), an edit in Edit mode saves only the lines it moved
// (the file's BOM and CRLF line endings kept), a new sub-page is created in
// the folder, and the library tree follows the saved order.
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
  await fs.mkdtemp(path.join(os.tmpdir(), "marklore-index-view-")),
);
const library = path.join(temp, "kb"),
  profile = path.join(temp, "profile");
await fs.mkdir(library, { recursive: true });
await fs.mkdir(profile);
const lines = [
  "# Course",
  "",
  "Intro text.",
  "",
  "- [Chapter 1](Chapter%201.md)",
  "  - [Section 1.1](Section%201.1.md)",
  "- [Chapter 2](Chapter%202.md)",
  "- [Gone](Gone.md)",
  "",
];
const indexFile = path.join(library, "_目录.md");
const original = "﻿" + lines.join("\r\n");
await fs.writeFile(indexFile, original);
for (const [name, text] of [
  ["Chapter 1.md", "# Chapter 1\n\nReal numbers and completeness.\n"],
  ["Section 1.1.md", "# Section 1.1\n\nDensity of the rationals. More.\n"],
  ["Chapter 2.md", "# Chapter 2\n\nLimits of sequences.\n"],
  ["Extra.md", "# Extra\n\nNot listed.\n"],
])
  await fs.writeFile(path.join(library, name), text);
await fs.writeFile(
  path.join(profile, "session.json"),
  JSON.stringify({
    roots: [library],
    settings: { sidebar: true, richEdit: true, editSplit: false },
  }),
);
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
  await tree.getByText("_目录.md", { exact: true }).click();
  const content = page.locator("#content");
  const item = (title) =>
    content
      .locator(".ix-item")
      .filter({
        has: page.locator(":scope > .ix-row > .ix-title", { hasText: title }),
      })
      .first();
  await item("Chapter 1").waitFor();
  await item("Section 1.1")
    .locator(".ix-excerpt", { hasText: "Density of the rationals." })
    .waitFor({ timeout: 10000 });
  await item("Gone").locator(".ix-missing").waitFor();
  assert.equal(
    await content.locator(".ix-unlisted-toggle").textContent(),
    "未列入目录（1）",
  );

  // Edit mode: Chapter 2 under Chapter 1, saved.
  await page.keyboard.press("Control+2");
  await content.locator(".ix-tools").first().waitFor({ state: "attached" });
  await item("Chapter 2").focus();
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#content .ix-item")]
        .find(
          (el) =>
            el.querySelector(":scope > .ix-row > .ix-title")?.textContent ===
            "Chapter 2",
        )
        ?.getAttribute("aria-level") === "2",
  );
  await page.keyboard.press("Control+s");
  const expected =
    "﻿" +
    lines
      .join("\r\n")
      .replace(
        "- [Chapter 2](Chapter%202.md)",
        "  - [Chapter 2](Chapter%202.md)",
      );
  for (let i = 0; i < 50; i++) {
    if ((await fs.readFile(indexFile, "utf8")) === expected) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await fs.readFile(indexFile, "utf8"), expected);
  // The tree follows the saved index: Chapter 2 a sub-page of Chapter 1.
  await tree
    .locator(".page .pages .file", { hasText: "Chapter 2.md" })
    .waitFor({ timeout: 5000 });

  // A new sub-page: created in the folder, listed under its parent.
  await item("Section 1.1").hover();
  await item("Section 1.1")
    .locator(":scope > .ix-row")
    .getByRole("button", { name: "新建子页" })
    .click();
  const name = content.locator(".ix-new-row input");
  await name.fill("Example");
  await name.press("Enter");
  await item("Example").waitFor();
  assert.equal(await fs.readFile(path.join(library, "Example.md"), "utf8"), "");
  await page.keyboard.press("Control+s");
  for (let i = 0; i < 50; i++) {
    if ((await fs.readFile(indexFile, "utf8")).includes("Example")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    await fs.readFile(indexFile, "utf8"),
    expected.replace(
      "  - [Section 1.1](Section%201.1.md)\r\n",
      "  - [Section 1.1](Section%201.1.md)\r\n    - [Example](Example.md)\r\n",
    ),
  );
  // Source mode: the Markdown as written.
  await page.keyboard.press("Control+3");
  await page
    .locator("#editor .cm-content", { hasText: "- [Example](Example.md)" })
    .waitFor();
  console.log(
    "Native index view passed: an index file shows the folder's pages with first sentences, a missing page and the unlisted files; Tab in Edit mode saves one changed line with the BOM and CRLF kept; the tree follows; a new sub-page is created in the folder and listed under its parent.",
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
