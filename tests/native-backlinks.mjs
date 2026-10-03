// Backlinks in the real app: the link index reads the library, counts sit
// beside what is linked, a note another program writes adds to them, the
// card opens the source at the link, and broken links are marked.
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
  await fs.mkdtemp(path.join(os.tmpdir(), "marklore-backlinks-")),
);
const library = path.join(temp, "kb"),
  profile = path.join(temp, "profile");
await fs.mkdir(path.join(library, "week2"), { recursive: true });
await fs.mkdir(profile);
const write = (name, text) => fs.writeFile(path.join(library, name), text);
await write(
  "Lemma.md",
  [
    "# Lemma",
    "",
    "See also [a missing note](Missing.md).",
    "",
    "## Statement",
    "",
    '<a id="bound"></a>',
    "",
    "**Lemma（Bound）。** For every $x$, the bound holds.",
    "",
  ].join("\n"),
);
await write(
  "week2/Use.md",
  "# Use\n\nBy [the bound](../Lemma.md#bound), we are done.\n",
);
await fs.writeFile(
  path.join(profile, "session.json"),
  JSON.stringify({ roots: [library], settings: { sidebar: true } }),
);
const exe = process.env.FOLIO_TEST_EXE;
let instance;
try {
  instance = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: [...(exe ? [] : [project]), path.join(library, "Lemma.md")],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await page.locator("#content h1").waitFor();
  const lemma = page.locator("#content p", { hasText: "Lemma（Bound）" });
  const count = lemma.locator(".backlink-badge");
  await count.waitFor({ timeout: 10000 });
  assert.equal(await count.getAttribute("data-count"), "1");
  await page
    .locator("#content a.link-broken", { hasText: "a missing note" })
    .waitFor({ timeout: 10000 });

  // Another program (an agent) writes a note that links to the lemma.
  await write(
    "Apply.md",
    "# Apply\n\nWith [the lemma's bound](Lemma.md#bound) twice: [again](./Lemma.md#bound).\n",
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector("#content p .backlink-badge")
        ?.getAttribute("data-count") === "3",
    null,
    { timeout: 10000 },
  );

  // The card lists the sources; an entry opens one at the link.
  await count.click();
  const card = page.locator("#backlinks-card");
  await card.waitFor();
  const sources = await card.locator(".backlink-source").allTextContents();
  assert.deepEqual([...sources].sort(), ["Apply", "Apply", "Use"]);
  await card.locator(".backlink-entry", { hasText: "Use" }).click();
  await page
    .getByRole("tab", { name: "Use.md", exact: true })
    .waitFor({ timeout: 10000 });
  await page.locator("#content h1", { hasText: "Use" }).waitFor();
  console.log(
    "Native backlinks passed: counts from the library index, a note written by another program adds to them, the card opens the source, broken links marked.",
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
