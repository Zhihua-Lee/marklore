import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-navigation-"));
const profile = path.join(temp, "profile"),
  a = path.join(temp, "Alpha.md"),
  b = path.join(temp, "Beta.md");
const note = (name, next) =>
  `# ${name}\n\n` +
  Array.from(
    { length: 25 },
    (_, i) =>
      `## Section ${i}\n\n${"Reading position 中文阅读位置. ".repeat(20)}\n\n[Next](${next}#section-15)\n\n`,
  ).join("");
const sourceA = note("Alpha", "Beta.md"),
  sourceB =
    note("Beta", "Alpha.md") +
    "\n| ID | Explanation | Notes |\n| --- | --- | --- |\n" +
    Array.from(
      { length: 10 },
      (_, i) =>
        `| ${i} | Repeated explanations deserve sufficient width for comfortable reading. | ${i ? "OK" : "One long exception should not crowd every other row. ".repeat(8)} |`,
    ).join("\n");
await fs.writeFile(a, sourceA);
await fs.writeFile(b, sourceB);
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [a, b] : [root, a, b],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  page.setDefaultTimeout(15000);
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].hide(),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab", { name: "Alpha.md", exact: true }).click();
  await expect(page.locator(".history-controls")).toBeHidden();
  await page
    .locator("#outline")
    .getByRole("button", { name: "Section 8", exact: true })
    .click();
  const scroll = () => page.locator("#reader").evaluate((el) => el.scrollTop);
  await expect.poll(scroll).toBeGreaterThan(100);
  const departure = await scroll();
  await page
    .locator("#section-8")
    .locator("..")
    .getByRole("link", { name: "Next", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Beta.md");
  const table = page.locator("#content .table-scroll > table");
  // Column measurement is deferred until the table approaches the viewport.
  await table.scrollIntoViewIfNeeded();
  await expect(table).toBeInViewport();
  await expect(table).toHaveClass(/\breading-columns\b/);
  const url = page.url();
  const appCommand = (command) =>
    instance.evaluate(
      ({ BrowserWindow }, cmd) =>
        BrowserWindow.getAllWindows()[0].emit("app-command", {}, cmd),
      command,
    );
  await appCommand("browser-backward");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Alpha.md",
  );
  await expect
    .poll(async () => Math.abs((await scroll()) - departure))
    .toBeLessThan(5);
  await appCommand("browser-forward");
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Beta.md");
  assert.equal(page.url(), url);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Alpha.md",
  );
  await page
    .getByRole("tab", { name: "Alpha.md", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建分组…" }).click();
  await page.getByRole("textbox", { name: "分组名称" }).fill("Course 笔记");
  await appCommand("browser-forward");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Alpha.md",
  );
  await page
    .getByRole("dialog", { name: "新建分组" })
    .getByRole("button", { name: "确定" })
    .click();
  await page
    .getByRole("tab", { name: "Beta.md", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "移入分组 · Course 笔记" }).click();
  const group = page.getByRole("button", {
    name: "分组 Course 笔记",
    exact: true,
  });
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect
    .poll(async () => {
      try {
        return JSON.parse(
          await fs.readFile(path.join(profile, "session.json"), "utf8"),
        ).settings.tabGroups[0].collapsed;
      } catch {
        return null;
      }
    })
    .toBe(true);
  await page.reload();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await group.click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "外观与布局", exact: true }).click();
  await page
    .getByRole("combobox", { name: "前进 / 后退按钮" })
    .selectOption("visible");
  await page.getByRole("button", { name: "关闭外观设置" }).click();
  await expect(page.locator(".history-controls")).toBeVisible();
  await fs.mkdir(path.join(root, ".local"), { recursive: true });
  await page.screenshot({
    path: path.join(root, ".local/native-navigation-v019.png"),
  });
  assert.equal(await fs.readFile(a, "utf8"), sourceA);
  assert.equal(await fs.readFile(b, "utf8"), sourceB);
  console.log(
    "Native navigation passed: OS app-command route, keyboard, exact reading return, modal protection, group/session persistence, optional controls; original notes unchanged. Physical mouse hardware not exercised.",
  );
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
