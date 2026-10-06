import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Folders without notes (experiment output, data) can be left out of search
// and backlinks: right-click them in the library; Settings lists them.
test("a folder is left out of search by right-click, shown dimmed, restored in Settings", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(() => {
    const folder = (id, name, parent) => ({
      id,
      name,
      path: `${parent}/${name}`,
      directory: true,
    });
    const entries = {
      root: [
        folder("notes", "Notes", "Z:/home"),
        folder("runs", "Runs", "Z:/home"),
      ],
      runs: [folder("seed0", "seed0", "Z:/home/Runs")],
      notes: [],
      seed0: [],
    };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [],
        restored: [],
        roots: [{ id: "root", name: "Z:\\", path: "Z:/home" }],
        settings: { sidebar: true },
      }),
      list: async (id) => entries[id] || [],
    });
  });
  await page.goto("/");
  const tree = page.locator("#tree");
  const runs = tree.locator('details.folder[data-path="Z:/home/Runs"]');
  await expect(runs).toBeVisible();

  // The library folder itself offers no such entry.
  await tree
    .locator("details.folder > summary")
    .first()
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "不参与搜索和反向链接" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await runs.locator(":scope > summary").click({ button: "right" });
  await page.getByRole("menuitem", { name: "不参与搜索和反向链接" }).click();
  await expect(runs).toHaveClass(/excluded/);
  await expect(runs.locator(":scope > summary")).toHaveAttribute(
    "data-excluded",
    "不参与搜索",
  );
  // Kept with the settings, for the main process to follow.
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.settings?.searchExclude),
    )
    .toEqual(["Z:/home/Runs"]);

  // A folder inside it says so instead of offering a second exclusion.
  await runs.locator(":scope > summary").click();
  const seed = runs.locator('details.folder[data-path="Z:/home/Runs/seed0"]');
  await expect(seed).toHaveClass(/excluded/);
  await seed.locator(":scope > summary").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "上级文件夹已不参与搜索" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  // Settings lists it; restoring brings it back.
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const list = page.locator("#excluded-folders");
  await expect(list.locator("li[data-path]")).toHaveText(["Z:/home/Runs恢复"]);
  await list
    .getByRole("button", { name: "恢复 Z:/home/Runs 参与搜索" })
    .click();
  await expect(list.locator("li.empty")).toHaveText("没有排除的文件夹");
  await expect(runs).not.toHaveClass(/excluded/);
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.settings?.searchExclude),
    )
    .toEqual([]);
});
