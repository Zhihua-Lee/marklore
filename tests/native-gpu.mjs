// Without a usable GPU the page is drawn in software. The packaged app leaves
// out Chromium's WebGPU compiler and its Vulkan/SwiftShader files
// (build/after-pack.cjs): with the GPU off, a note with formulas, a table and
// a diagram must still render, and so must the window.
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
const exe = process.env.FOLIO_TEST_EXE;
if (exe)
  for (const name of ["dxcompiler.dll", "vk_swiftshader.dll", "vulkan-1.dll"])
    assert.equal(
      await fs.access(path.join(path.dirname(exe), name)).then(
        () => true,
        () => false,
      ),
      false,
      `${name} should not be packaged`,
    );
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "folio-gpu-")),
);
const note = path.join(temp, "note.md");
await fs.writeFile(
  note,
  [
    "# Software drawing",
    "",
    "Inline $e^{i\\pi} + 1 = 0$ and a display formula:",
    "",
    "$$",
    "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
    "$$",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "```mermaid",
    "flowchart LR",
    "  A[Start] --> B[End]",
    "```",
    "",
  ].join("\n"),
);
let instance;
try {
  instance = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: [...(exe ? [] : [project]), "--disable-gpu", note],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await page.locator("#content h1").waitFor();
  const status = await instance.evaluate(({ app }) =>
    app.getGPUFeatureStatus(),
  );
  assert.match(status.gpu_compositing, /disabled|software/i);
  await page.locator("#content .katex").first().waitFor();
  await page.locator("#content table").waitFor();
  await page.locator("#content pre .diagram svg").waitFor({ timeout: 30000 });
  const sizes = await page.evaluate(() =>
    ["#content .katex-display", "#content table", "#content .diagram svg"].map(
      (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return box.width > 10 && box.height > 10;
      },
    ),
  );
  assert.deepEqual(sizes, [true, true, true]);
  // The window is drawn: a screenshot is not one flat colour.
  const shot = await page.screenshot();
  assert.ok(shot.length > 20000, "screenshot looks blank");
  console.log(
    `Native GPU passed: with the GPU off (compositing ${status.gpu_compositing}), formulas, a table and a diagram render.`,
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
