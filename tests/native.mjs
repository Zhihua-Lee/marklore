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
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-native-"));
const file = path.join(temp, "note.md"),
  other = path.join(temp, "other.md");
await fs.writeFile(other, "# Target\n\n## Destination\n\nHello link");
await fs.writeFile(
  path.join(temp, "picture.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="teal"/></svg>',
);
await fs.writeFile(
  file,
  "# Native test\n\n中文与 $x^2$.\n\n![Image](picture.svg)\n\n[Other](other.md#destination)\n\n[External](https://example.com)",
);
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [file] : [project, file],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await page.bringToFront();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const consoleErrors = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      consoleErrors.push(
        message.text().replace(/data:font[^']*/g, "data:[font omitted]"),
      );
  });
  await page.locator("#content h1").waitFor();
  assert.match(await page.locator("#content").innerText(), /Native test/);
  await page.locator('#tree .file[aria-current="page"]').waitFor();
  assert.equal(
    await page.locator('#tree .file[aria-current="page"]').innerText(),
    "note.md",
  );
  assert.equal(await page.evaluate(() => typeof require), "undefined");
  await page.waitForFunction(
    () => document.querySelector("#content img")?.naturalWidth === 100,
  );
  assert.equal(await page.locator(".katex").count(), 1);
  // Hover a settled glyph location: startup font/layout restoration can move
  // the link beneath a stationary pointer without representing a preview error.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  assert.equal(
    await page.evaluate(() => document.fonts.check("18px KaTeX_Main", "2")),
    true,
    "KaTeX main font must load under native CSP",
  );
  assert.equal(
    await page.evaluate(() =>
      document.fonts.check("italic 18px KaTeX_Math", "x"),
    ),
    true,
    "KaTeX math font must load under native CSP",
  );
  await page.evaluate(() => {
    window.__nativeHoverEvents = [];
    const record = (event) => {
      if (window.__nativeHoverEvents.length >= 100) return;
      window.__nativeHoverEvents.push({
        type: event.type,
        target: event.target?.tagName,
        text: event.target?.textContent?.slice(0, 80),
        related: event.relatedTarget?.tagName,
        x: event.clientX,
        y: event.clientY,
        trusted: event.isTrusted,
        elementAtPoint:
          typeof event.clientX === "number"
            ? document.elementFromPoint(event.clientX, event.clientY)?.tagName
            : undefined,
        link: document
          .querySelector('#content a[href="other.md#destination"]')
          ?.getBoundingClientRect()
          .toJSON(),
        time: performance.now(),
      });
    };
    for (const event of ["pointerover", "pointerout", "focusin", "focusout"])
      document.querySelector("#content").addEventListener(event, record);
    document.querySelector("#reader").addEventListener("scroll", record);
    document.addEventListener("pointermove", record);
    window.addEventListener("resize", record);
  });
  await page.getByRole("link", { name: "Other", exact: true }).hover();
  try {
    await page
      .locator("#link-preview #destination")
      .waitFor({ timeout: 10000 });
  } catch (error) {
    await fs.mkdir(path.join(project, "test-results"), { recursive: true });
    await page.screenshot({
      path: path.join(project, "test-results/native-hover-failure.png"),
    });
    console.error(
      "Native hover failure evidence:",
      JSON.stringify({
        errors,
        consoleErrors,
        page: await page.evaluate(() => ({
          events: window.__nativeHoverEvents,
          card: document.querySelector("#link-preview")?.outerHTML,
          api: typeof window.folio.preview,
          reader: document
            .querySelector("#reader")
            ?.getBoundingClientRect()
            .toJSON(),
          link: document
            .querySelector('#content a[href="other.md#destination"]')
            ?.getBoundingClientRect()
            .toJSON(),
        })),
      }),
    );
    throw error;
  }
  assert.match(
    await page.locator("#link-preview article").innerText(),
    /Hello link/,
  );
  assert.equal(await page.getByRole("tab").count(), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Other", exact: true }).click();
  await page.getByRole("tab", { name: "other.md", exact: true }).waitFor();
  assert.match(await page.locator("#content").innerText(), /Hello link/);
  await page.getByRole("tab", { name: "note.md", exact: true }).click();
  await fs.writeFile(file, "# Externally updated\n\nAI changed the note.");
  await page.waitForFunction(() =>
    document.querySelector("#content")?.textContent.includes("AI changed"),
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" LOCAL");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "已保存",
  );
  assert.match(await fs.readFile(file, "utf8"), /LOCAL/);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" UNSAVED RECOVERY");
  await page.waitForTimeout(1100);
  const session = JSON.parse(
    await fs.readFile(path.join(temp, "profile/session.json"), "utf8"),
  );
  assert.ok(session.tabs.some((t) => t.draft?.includes("UNSAVED RECOVERY")));
  await instance.evaluate(({ app }) => app.exit(0));
  instance = null;
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [] : [project],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const restored = await instance.firstWindow();
  await restored.locator("#content h1").waitFor();
  assert.match(
    await restored.locator(".cm-content").innerText(),
    /UNSAVED RECOVERY/,
  );
  // Notes opened from the command line and via a link are remembered across the
  // restart, newest first (restoring tabs does not reorder them); only listed
  // paths reopen.
  const recent = (
    await restored.evaluate(() => window.folio.recentFiles())
  ).map((item) => item.path.toLowerCase());
  assert.deepEqual(recent, [
    (await fs.realpath(other)).toLowerCase(),
    (await fs.realpath(file)).toLowerCase(),
  ]);
  const refused = await restored.evaluate(
    (p) =>
      window.folio.openRecent(p).then(
        () => "opened",
        (error) => error.message,
      ),
    path.join(temp, "picture.svg"),
  );
  assert.match(refused, /不在最近打开列表中/);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Native smoke passed: isolated renderer, math, local SVG, scoped hover preview, internal link, fs watcher, safe save, draft restart recovery, recent files.",
  );
} finally {
  if (instance)
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
  // The entire target is a newly-created, unique test directory, never user notes.
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
