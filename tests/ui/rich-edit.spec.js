import { test, expect } from "@playwright/test";
import {
  note,
  boot,
  editor,
  saved,
  insertedOnly,
  caretAfter,
  compose,
} from "./rich-helpers.js";

test("the note shows drawn and stays byte-identical until edited", async ({
  page,
}) => {
  await boot(page);
  // Formulas, a table, a diagram, a task box: drawn, no pencil.
  await expect(editor(page).locator(".formula .katex").first()).toBeVisible();
  await expect(
    editor(page).locator(".math-block .katex").first(),
  ).toBeVisible();
  await expect(editor(page).locator("table")).toBeVisible();
  await expect(editor(page).locator(".task-list-item-checkbox")).toHaveCount(2);
  await expect(page.locator(".block-edit-launch, .direct-pencil")).toHaveCount(
    0,
  );
  await expect(page.locator("#status")).toHaveText("已保存");
});

test("switching between Read and Edit keeps the place in the note", async ({
  page,
}) => {
  const long = Array.from(
    { length: 40 },
    (_, i) => `## Part ${i}\n\nText of part ${i} with $x_${i}$.\n`,
  ).join("\n");
  await boot(page, long);
  const top = (pane) =>
    page.evaluate((pane) => {
      const box = document.querySelector(pane).getBoundingClientRect();
      const heads = [...document.querySelectorAll(pane + " h2")];
      return heads.find((h) => h.getBoundingClientRect().bottom > box.top + 10)
        ?.textContent;
    }, pane);
  // Blocks off screen have estimated heights until drawn: scroll until the
  // heading stays put.
  for (let i = 0; i < 6; i++) {
    await page.locator("#rich-reader").evaluate((el) => {
      const h = [...el.querySelectorAll("h2")].find(
        (h) => h.textContent === "Part 25",
      );
      el.scrollTop +=
        h.getBoundingClientRect().top - el.getBoundingClientRect().top - 20;
    });
    await page.waitForTimeout(80);
  }
  expect(await top("#rich-reader")).toBe("Part 25");
  await page.keyboard.press("Control+1");
  await expect(page.locator("#reader")).toBeVisible();
  await expect.poll(() => top("#reader")).toMatch(/Part 2[45]/);
  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich-reader")).toBeVisible();
  await expect.poll(() => top("#rich-reader")).toMatch(/Part 2[45]/);
});

test("typing changes the note only where it was typed", async ({ page }) => {
  await boot(page);
  await caretAfter(page, "频域里卷积");
  await page.keyboard.type("Q");
  await caretAfter(page, "内层积分是");
  await compose(page, "函数");
  await expect(page.locator("#status")).toHaveText("● 未保存");
  const text = await saved(page);
  const once = note.replace("频域里卷积", "频域里卷积Q");
  expect(insertedOnly(once, text, "函数")).toBe(true);
});

test("a formula is one unit: Backspace selects it, then removes it", async ({
  page,
}) => {
  await boot(page);
  // "价格 \$5" is plain text; the formula in the quote is "$x^2 + y^2 = 1$".
  await caretAfter(page, "引用里也有公式 ");
  await page.keyboard.press("ArrowRight");
  // Stepping in with the arrow opens its source in place.
  await expect(editor(page).locator(".math-src")).toHaveText("$x^2 + y^2 = 1$");
  await page.keyboard.press("End");
  await expect(editor(page).locator(".math-src")).toHaveCount(0);
  await caretAfter(page, "引用里也有公式 ");
  await page.keyboard.press("Delete");
  await expect(
    editor(page).locator(".rich-picked, .ProseMirror-selectednode"),
  ).toHaveCount(1);
  await page.keyboard.press("Delete");
  const text = await saved(page);
  expect(text).toContain("> 引用里也有公式 。");
  expect(text.replace("> 引用里也有公式 。", "")).toBe(
    note.replace("> 引用里也有公式 $x^2 + y^2 = 1$。", ""),
  );
});

test("editing a formula's source in place, then leaving it", async ({
  page,
}) => {
  await boot(page);
  await editor(page)
    .locator(".formula .katex-html")
    .first()
    .locator(".mord")
    .first()
    .click();
  const open = editor(page).locator(".math-src");
  await expect(open).toContainText("\\mathcal{F}(f * g)");
  await page.keyboard.type("+1");
  await page.keyboard.press("ArrowDown");
  await expect(open).toHaveCount(0);
  const text = await saved(page);
  expect(insertedOnly(note, text, "+1")).toBe(true);
});

test("Enter in a numbered item renumbers; an empty item leaves the list", async ({
  page,
}) => {
  await boot(page);
  await caretAfter(page, "写出定义 ");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("new step");
  let text = await saved(page);
  expect(text).toContain(
    "1. 写出定义 $h(t) = (f*g)(t)$\n2. new step\n3. 对两边做变换",
  );
  expect(text).toContain("4. 整理得到乘积");
  await caretAfter(page, "整理得到乘积");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  text = await saved(page);
  const at = text.indexOf("2. new step");
  expect(text.slice(at, text.indexOf("3) 括号编号") + 7)).toContain(
    "4. 整理得到乘积\n\nafter\n\n3) 括号编号",
  );
});

test("tables: typing in cells, Tab, and the right-click menu", async ({
  page,
}) => {
  await boot(page);
  await editor(page).locator("td").first().click();
  await page.keyboard.press("End");
  await compose(page, "运算");
  await page.keyboard.press("Tab");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await editor(page).locator("td").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "这一列居中" }).click();
  const text = await saved(page);
  const outside = (s) =>
    s
      .split("\n")
      .filter((l) => !l.startsWith("|"))
      .join("\n");
  expect(outside(text)).toBe(outside(note));
  expect(text).toContain("| 卷积运算");
  expect(text).toContain("$f*g$!");
  expect(text).toMatch(/\| :-+: \|/);
});

test("links: the address box under the caret, and Ctrl+K", async ({ page }) => {
  await boot(page);
  await editor(page).getByText("一个链接").click();
  const box = page.locator(".rich-link-box");
  await expect(box).toBeVisible();
  await expect(box.locator("input")).toHaveValue("https://example.com");
  await box.locator("input").fill("https://example.org/f");
  await box.locator("input").press("Enter");
  await expect(box)
    .toBeHidden({ timeout: 2000 })
    .catch(() => {});
  await caretAfter(page, "第二行 ");
  await expect(box).toBeHidden();
  let text = await saved(page);
  expect(text).toContain('[一个链接](https://example.org/f "标题")');
  // Ctrl+K on a selection links it.
  await caretAfter(page, "转义字符");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("notes/x.md");
  await page.keyboard.press("Enter");
  text = await saved(page);
  expect(text).toMatch(/\[转义\]\(notes\/x\.md\)/);
});

test("undo returns the exact note; each tab keeps its own history", async ({
  page,
}) => {
  await boot(page);
  await caretAfter(page, "频域里卷积");
  await page.keyboard.type("abc");
  await page.getByRole("tab", { name: "Other.md", exact: true }).click();
  await page.getByRole("tab", { name: /Rich.md/ }).click();
  await expect(editor(page)).toContainText("频域里卷积abc");
  await editor(page).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
  await expect(editor(page)).not.toContainText("卷积abc");
  await expect(page.locator("#status")).toHaveText("已保存");
});

test("the source pane, when shown, follows the editor and back", async ({
  page,
}) => {
  await boot(page, note, { editSplit: true });
  await expect(page.locator("#editor-pane")).toBeVisible();
  await caretAfter(page, "频域里卷积");
  await page.keyboard.type("R");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "频域里卷积R",
  );
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nTail paragraph.");
  await expect(editor(page)).toContainText("Tail paragraph.", {
    timeout: 3000,
  });
});

test("the source pane is off by default in Edit mode", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#editor-pane")).toBeHidden();
});

test("a new note opens in the editor, not the source pane", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => window.mock.handlers.command("new"));
  await expect(page.getByRole("tab", { name: /未命名\.md/ })).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator("#editor-pane")).toBeHidden();
  await expect(page.locator("#reader")).toBeHidden();
  await expect(page.getByText(/还不能原样保留/)).toHaveCount(0);
  await page.keyboard.type("# Title");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Body");
  await expect(editor(page).locator("h1")).toHaveText("Title");
  await expect(page.locator("#editor .cm-content")).toContainText("Body");
  // The note's text is exactly what was typed.
  await expect(page.locator("#editor .cm-line")).toHaveText([
    "# Title",
    "",
    "Body",
  ]);
});

test("code blocks are colored as when read, and stay so while typed in", async ({
  page,
}) => {
  const text = "Intro\n\n```js\nconst a = 1; // one\n```\n";
  await boot(page, text);
  const keyword = editor(page).locator("pre .hljs-keyword").first();
  await expect(keyword).toHaveText("const");
  const color = await keyword.evaluate((el) => getComputedStyle(el).color);
  // (Colored, the code is several runs of text.)
  await caretAfter(page, "// one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("let b = 2;");
  await expect(editor(page).locator("pre .hljs-keyword")).toHaveText([
    "const",
    "let",
  ]);
  await expect(editor(page).locator("pre .hljs-comment")).toHaveText("// one");
  await page.keyboard.press("Control+1");
  const read = await page
    .locator("#content pre .hljs-keyword")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(read).toBe(color);
  expect(await saved(page)).toBe(text.replace("// one", "// one\nlet b = 2;"));
});

test("an image: a click shows its address and description to change", async ({
  page,
}) => {
  const text = "Before ![A cat](assets/cat.png) after.\n";
  await boot(page, text);
  await editor(page).locator("img").click();
  const box = page.locator(".rich-image-box");
  await expect(box).toBeVisible();
  await expect(box.getByLabel("图片地址")).toHaveValue("assets/cat.png");
  await box.getByLabel("说明文字").fill("A sleeping cat");
  await box.getByLabel("说明文字").press("Enter");
  await expect(editor(page).locator("img")).toHaveAttribute(
    "alt",
    "A sleeping cat",
  );
  await box.getByLabel("图片地址").fill("assets/dog.png");
  await box.getByLabel("图片地址").press("Enter");
  expect(await saved(page)).toBe(
    "Before ![A sleeping cat](assets/dog.png) after.\n",
  );
  // Still selected, its box still open: remove it.
  await expect(box).toBeVisible();
  await box.getByRole("button", { name: "移除图片" }).click();
  expect(await saved(page)).toBe("Before  after.\n");
});
