import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter } from "./rich-helpers.js";

// Properties a note does not have yet: the first one is added in Edit mode
// (the toolbar's properties button, or the note's menu), with nothing shown
// above the note until then; new notes may start with the default
// properties of Settings → Editing, and "Add default properties" adds those
// a note lacks. Saving may keep a modified time the note has up to date.
const plain = "# 周会\n\nText.\n";
const top = (heading) =>
  heading.evaluate((h) => Math.round(h.getBoundingClientRect().top));

test("a note without properties gets its first one in Edit mode", async ({
  page,
}) => {
  await boot(page, plain);
  // Read mode: nothing is added above the note.
  await page.keyboard.press("Control+1");
  await expect(page.locator("#content h1")).toContainText("周会");
  await expect(page.locator("#content .fm-first")).toHaveCount(0);
  await expect(
    page.locator("#content :is(.front-matter, .fm-none, .fm-title)"),
  ).toHaveCount(0);
  const read = await top(page.locator("#content h1"));
  // Edit mode: nothing either, so the first line stays where it was.
  await page.keyboard.press("Control+2");
  await expect(editor(page).locator("h1")).toContainText("周会");
  await expect(editor(page).locator(".fm-first")).toHaveCount(0);
  expect(await top(editor(page).locator("h1"))).toBe(read);
  const button = page.getByRole("button", { name: "属性", exact: true });
  await button.click();
  const first = editor(page).locator(".fm-first");
  const fields = first.locator(".fm-new input");
  await expect(fields.first()).toBeFocused();
  await fields.first().fill("author");
  await fields.first().press("Enter");
  await fields.nth(1).fill("李");
  await fields.nth(1).press("Enter");
  // The card, unfolded, with the property; no more "Add property" above.
  const card = editor(page).locator("details.front-matter");
  await expect(card).toHaveAttribute("open", "");
  await expect(card.locator('.fm-row[data-key="author"]')).toHaveText(
    /作者\s*李/,
  );
  await expect(editor(page).locator(".fm-first")).toHaveCount(0);
  expect(await saved(page)).toBe("---\nauthor: 李\n---\n\n" + plain);
  // One change, taken back by undo.
  await caretAfter(page, "Text.");
  await page.keyboard.press("Control+z");
  await expect(editor(page).locator(".rich-properties details")).toHaveCount(0);
  expect(await saved(page)).toBe(plain);
  // Esc drops it, writing nothing, and takes the fields away again.
  await button.click();
  await expect(fields.first()).toBeFocused();
  await fields.first().fill("x");
  await fields.first().press("Escape");
  await expect(editor(page).locator(".fm-first")).toHaveCount(0);
  expect(await top(editor(page).locator("h1"))).toBe(read);
  expect(await saved(page)).toBe(plain);
});

test("the properties button adds one more to a note that has some", async ({
  page,
}) => {
  const text = "---\ntags: [x]\n---\n\nText.\n";
  await boot(page, text);
  // From Read mode: Edit mode, the card unfolded, asking for one more.
  await page.keyboard.press("Control+1");
  await expect(page.locator("#content details.front-matter")).toHaveCount(1);
  await page.getByRole("button", { name: "属性", exact: true }).click();
  const card = editor(page).locator("details.front-matter");
  await expect(card).toHaveAttribute("open", "");
  const fields = card.locator(".fm-new input");
  await expect(fields.first()).toBeFocused();
  await fields.first().fill("author");
  await fields.first().press("Enter");
  await fields.nth(1).fill("李");
  await fields.nth(1).press("Enter");
  await expect(card.locator('.fm-row[data-key="author"]')).toHaveCount(1);
  expect(await saved(page)).toBe(
    text.replace("tags: [x]", "tags: [x]\nauthor: 李"),
  );
  // Esc: nothing more written.
  await page.getByRole("button", { name: "属性", exact: true }).click();
  await expect(fields.first()).toBeFocused();
  await fields.first().fill("y");
  await fields.first().press("Escape");
  await expect(card.locator(".fm-new")).toHaveCount(0);
  expect(await saved(page)).toBe(
    text.replace("tags: [x]", "tags: [x]\nauthor: 李"),
  );
});

test("the note's menu adds the first property, also from Read mode", async ({
  page,
}) => {
  await boot(page, plain);
  await page.keyboard.press("Control+1");
  await page.locator("#content p").click({ button: "right" });
  await page
    .locator("#context")
    .getByRole("menuitem", { name: "添加属性" })
    .click();
  // Edit mode, asking for it.
  const fields = editor(page).locator(".fm-first .fm-new input");
  await expect(fields.first()).toBeFocused();
  await fields.first().fill("tags");
  await fields.first().press("Enter");
  await fields.nth(1).fill("a, b");
  await fields.nth(1).press("Enter");
  expect(await saved(page)).toBe("---\ntags: a, b\n---\n\n" + plain);
  // A note with properties is not offered a first one.
  await editor(page).locator("p").click({ button: "right" });
  await expect(
    page.locator(".rich-menu").getByRole("menuitem", { name: "添加属性" }),
  ).toHaveCount(0);
});

test("default properties are added without changing those a note has", async ({
  page,
}) => {
  const text = "---\nTitle: 已有\ntags: [x]\n---\n\nText.\n";
  await boot(page, text, {
    propertyTemplate: "title: {title}\ncreated: {date}\ntags: []\ndraft: true",
  });
  await page.clock.setFixedTime(new Date(2026, 2, 14, 9, 5));
  await editor(page).locator("p").click({ button: "right" });
  await page
    .locator(".rich-menu")
    .getByRole("menuitem", { name: "添加默认属性" })
    .click();
  await expect(editor(page).locator('.fm-row[data-key="created"]')).toHaveCount(
    1,
  );
  expect(await saved(page)).toBe(
    text.replace("tags: [x]", "tags: [x]\ncreated: 2026-03-14\ndraft: true"),
  );
  // Undone as one change.
  await caretAfter(page, "Text.");
  await page.keyboard.press("Control+z");
  expect(await saved(page)).toBe(text);
  // All there: nothing more to add.
  await page.keyboard.press("Control+y");
  await editor(page).locator("p").click({ button: "right" });
  await expect(
    page.locator(".rich-menu").getByRole("menuitem", { name: "添加默认属性" }),
  ).toHaveCount(0);
  // From Read mode, on a note without properties: its name is its title.
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Other.md", exact: true }).click();
  await page.keyboard.press("Control+1");
  await page.locator("#content p").click({ button: "right" });
  await page
    .locator("#context")
    .getByRole("menuitem", { name: "添加默认属性" })
    .click();
  await expect(page.locator("#content details.front-matter")).toHaveCount(1);
  expect(await saved(page)).toBe(
    "---\ntitle: Other\ncreated: 2026-03-14\ntags: []\ndraft: true\n---\n\n# Other\n\nSecond note.\n",
  );
});

test("new notes start with the default properties only when asked", async ({
  page,
}) => {
  await boot(page, plain, {
    newNoteProperties: true,
    propertyTemplate: "title: {title}\ncreated: {datetime}\ntags: []",
  });
  await page.clock.setFixedTime(new Date(2026, 2, 14, 9, 5));
  await page.keyboard.press("Control+n");
  const card = editor(page).locator("details.front-matter");
  await expect(card.locator(".fm-when")).toContainText("2026年3月14日");
  await expect(card.locator(".fm-when")).toContainText("09:05");
  // Not an unsaved change: nothing was written in it yet.
  await expect(page.locator("#tabs [aria-selected=true]")).not.toContainText(
    "●",
  );
  // Typing goes below the properties.
  await page.keyboard.type("Hello");
  await page.keyboard.press("Control+3");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "title:created: 2026-03-14 09:05tags: []---Hello",
  );
  // Off (the default): a new note is empty.
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator("#new-note-properties")).toBeChecked();
  await page.locator("#new-note-properties").uncheck();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.keyboard.press("Control+n");
  await page.keyboard.press("Control+2");
  await expect(editor(page).locator(".rich-properties details")).toHaveCount(0);
  await expect(editor(page).locator(".fm-first")).toHaveCount(0);
});

test("the modified time is kept on save only when asked and only if there", async ({
  page,
}) => {
  const text =
    "---\ntitle: T\nmodified: 2020-01-02T03:04:05.0000000+08:00\nupdated: 2020/1/2\n---\n\nText.\n";
  await boot(page, text);
  // Today in local time, with the local offset (+08:00 and the like).
  const [day, zone] = await page.evaluate(() => {
    const now = new Date();
    const two = (n) => String(n).padStart(2, "0");
    const offset = -now.getTimezoneOffset();
    const abs = Math.abs(offset);
    return [
      `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
      (offset < 0 ? "-" : "+") +
        two(Math.floor(abs / 60)) +
        ":" +
        two(abs % 60),
    ];
  });
  // Off: saved as typed.
  await caretAfter(page, "Text.");
  await page.keyboard.type("1");
  expect(await saved(page)).toBe(text.replace("Text.", "Text.1"));
  // On: an edit, saved, carries the time, written as it was (OneNote's
  // seven decimals and offset); `updated`, not a date, stays.
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator("#stamp-modified").check();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await caretAfter(page, "Text.1");
  await page.waitForTimeout(600);
  await page.keyboard.type("2");
  const stamped = await saved(page);
  const time = /modified: (.*)\n/.exec(stamped)[1];
  expect(time).toMatch(
    new RegExp(`^${day}T\\d\\d:\\d\\d:\\d\\d\\.\\d{3}0000\\${zone}$`),
  );
  expect(stamped).toBe(
    text
      .replace("Text.", "Text.12")
      .replace("2020-01-02T03:04:05.0000000+08:00", time),
  );
  // The editor shows it, and the note is saved: no unsaved mark.
  await expect(page.locator("#tabs [aria-selected=true]")).not.toContainText(
    "●",
  );
  await page.locator("#rich details.front-matter summary").first().click();
  await expect(
    editor(page).locator('.fm-row[data-key="modified"] .fm-value'),
  ).toContainText(time.slice(11, 16));
  // Saving again with nothing changed (the caret moved) writes the same.
  await caretAfter(page, "Text");
  expect(await saved(page)).toBe(stamped);
  // Undo takes back the typing, not the time.
  await caretAfter(page, "Text.12");
  await page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("#rich p")?.textContent),
    )
    .toBe("Text.1");
  await page.keyboard.press("Control+3");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "modified: " + time,
  );
  await page.keyboard.press("Control+2");
  // A note without a modified time never gets one.
  await page.getByRole("tab", { name: "Other.md", exact: true }).click();
  await page.keyboard.press("Control+2");
  await expect(editor(page).locator("p")).toHaveText("Second note.");
  await expect(editor(page).locator(".fm-first")).toHaveCount(0);
  await editor(page).locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(editor(page).locator("p")).toHaveText("Second note.!");
  expect(await saved(page)).toBe("# Other\n\nSecond note.!\n");
});
