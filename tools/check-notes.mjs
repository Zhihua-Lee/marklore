// Read-only acceptance probe. Never copies personal note text into the repository.
import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inputs = process.argv.slice(2).map((p) => path.resolve(p));
if (!inputs.length)
  throw Error("Usage: node tools/check-notes.mjs note.md [...]");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-acceptance-"));
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? inputs : [project, ...inputs],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: temp,
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });
  const page = await instance.firstWindow();
  await page.locator("#content h1").waitFor();
  for (const input of inputs) {
    await page
      .getByRole("tab", { name: path.basename(input), exact: true })
      .click();
    const result = await page.locator("#content").evaluate((el) => {
      const plain = el.cloneNode(true);
      // KaTeX's visual font deliberately uses private-use glyph code points.
      // Inspect the underlying MathML/TeX and non-math text, not those font glyphs.
      for (const glyphs of plain.querySelectorAll(".katex-html"))
        glyphs.remove();
      return {
        headings: el.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
        formulas: el.querySelectorAll(".katex").length,
        mathErrors: [...el.querySelectorAll(".math-error")].map((e) =>
          e.title.slice(0, 160),
        ),
        leakedPlaceholder: /%%BLOCKMATH\d+%%|[\uE000-\uF8FF]/.test(
          plain.textContent,
        ),
        details: el.querySelectorAll("details").length,
      };
    });
    console.log(JSON.stringify({ file: path.basename(input), ...result }));
  }
} finally {
  if (instance)
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
