// The library follows the disk in the real app: a note that another program
// (an AI agent) writes into a library folder shows up in the tree, a renamed
// one follows, and an open note re-renders when that program edits it.
import { _electron as electron } from "@playwright/test";
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
  await fs.mkdtemp(path.join(os.tmpdir(), "marklore-library-")),
);
const library = path.join(temp, "kb"),
  profile = path.join(temp, "profile");
await fs.mkdir(path.join(library, "Topic"), { recursive: true });
await fs.mkdir(profile);
await fs.writeFile(path.join(library, "Index.md"), "# Index\n");
await fs.writeFile(
  path.join(profile, "session.json"),
  JSON.stringify({ roots: [library], settings: { sidebar: true } }),
);
const exe = process.env.FOLIO_TEST_EXE;
let instance;
try {
  instance = await electron.launch({
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
  await tree.getByText("Index.md", { exact: true }).waitFor();
  await tree.getByText("Topic", { exact: true }).click();

  // An agent writes a new note into an open folder, then renames it.
  const note = path.join(library, "Topic", "Agent note.md");
  await fs.writeFile(note, "# Agent note\n\nFirst draft.\n");
  await tree.getByText("Agent note.md", { exact: true }).waitFor({
    timeout: 5000,
  });
  const renamed = path.join(library, "Topic", "Laplace.md");
  await fs.rename(note, renamed);
  await tree.getByText("Laplace.md", { exact: true }).waitFor({
    timeout: 5000,
  });
  assert.equal(
    await tree.getByText("Agent note.md", { exact: true }).count(),
    0,
  );
  // The folder the reader opened is still open.
  assert.equal(
    await tree.evaluate(
      (el, folder) =>
        [...el.querySelectorAll("details.folder")].find(
          (d) => d.dataset.path === folder,
        )?.open,
      path.join(library, "Topic"),
    ),
    true,
  );

  // Open it, then the agent keeps writing: the page follows.
  await tree.getByText("Laplace.md", { exact: true }).click();
  await page.locator("#content h1", { hasText: "Agent note" }).waitFor();
  await fs.appendFile(
    renamed,
    "\n## Definition\n\n$$\nF(s)=\\int_0^\\infty f(t)e^{-st}dt\n$$\n",
  );
  await page.locator("#content h2", { hasText: "Definition" }).waitFor({
    timeout: 5000,
  });
  await page.locator("#content .katex-display").waitFor();
  console.log(
    "Native library passed: notes written and renamed by another program appear in the tree with folders kept open; an open note re-renders as it is extended.",
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
