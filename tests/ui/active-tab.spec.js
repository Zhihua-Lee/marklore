import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// The selected tab must never share a hue with a group: grouped or not, it is
// the same neutral bright card, and it changes without a fade.
for (const theme of ["light", "dark"])
  test(`${theme}: the selected tab is the same hue-free card in and out of groups`, async ({
    page,
  }) => {
    await installFolio(page);
    await page.addInitScript((theme) => {
      const doc = (id, name, groupId) => ({
        id,
        name: name + ".md",
        fileId: id,
        groupId,
        mode: "read",
        document: {
          id,
          name: name + ".md",
          path: "C:/s/" + name + ".md",
          version: "1",
          text: "# " + name + "\n",
        },
      });
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [],
          restored: [
            doc("a", "A", "g1"),
            doc("b", "B", "g1"),
            doc("c", "C", null),
          ],
          roots: [],
          active: "b",
          settings: {
            theme,
            tabGroups: [{ id: "g1", name: "G", color: "green" }],
          },
        }),
      });
    }, theme);
    await page.goto("/");
    const tab = (name) =>
      page
        .locator("#tabs .tab")
        .filter({ has: page.getByRole("tab", { name }) });
    const look = (name) =>
      tab(name).evaluate((el) => {
        const s = getComputedStyle(el),
          probe = document.createElement("i");
        probe.style.backgroundColor = "var(--tab-active)";
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          background: s.backgroundColor,
          expected,
          transition: s.transitionDuration,
          weight: getComputedStyle(el.querySelector(".tab-label")).fontWeight,
        };
      });

    const grouped = await look("B.md");
    expect(grouped.background).toBe(grouped.expected);
    expect(grouped.weight).toBe("600");

    await page.getByRole("tab", { name: "C.md" }).click();
    await expect(tab("C.md")).toHaveClass(/active/);
    const loose = await look("C.md");
    expect(loose.background).toBe(loose.expected);
    expect(loose.weight).toBe("600");
    expect(loose.transition).toMatch(/^0s(, 0s)*$/);
    // The one it left is no longer the bright card.
    expect((await look("B.md")).background).not.toBe(grouped.expected);
  });
