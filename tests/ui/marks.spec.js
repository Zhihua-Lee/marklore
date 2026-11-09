import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Marks for the AI (src/marks.js) against a mocked main process that keeps
// the marks and the background run in window.mock.state, as
// desktop/ai-bridge.mjs does.
const text = "# Plan\n\nSend it on Friday.\n\nAsk Ana about the budget.\n";
const PLAN = "C:/synthetic/Notes/Plan.md",
  IDEAS = "C:/synthetic/Notes/Ideas.md";

async function boot(page, { marks = [], run = null } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, marks, run, PLAN, IDEAS }) => {
      const files = {
        "file-plan": {
          id: "file-plan",
          path: PLAN,
          name: "Plan.md",
          text,
          version: "v1",
        },
        "file-ideas": {
          id: "file-ideas",
          path: IDEAS,
          name: "Ideas.md",
          text: "# Ideas\n\nA reading list.\n",
          version: "v1",
        },
      };
      const byPath = (p) => Object.values(files).find((f) => f.path === p);
      window.mock = { handlers: {}, state: { marks, run }, calls: [] };
      const state = () => structuredClone(window.mock.state);
      let n = 0;
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [files["file-plan"]],
          restored: [],
          roots: [],
          settings: {},
        }),
        marks: async () => state(),
        changeMark: async (action, args) => {
          window.mock.calls.push(["changeMark", action, args]);
          const list = window.mock.state.marks;
          if (action === "add") {
            const file = files[args.fileId];
            list.push({
              id: "m" + ++n,
              file: file.path,
              name: file.name,
              quote: args.quote,
              prefix: args.prefix,
              suffix: args.suffix,
              text: args.text,
              created: "2026-11-07T10:0" + n + ":00.000Z",
              state: "open",
            });
          }
          const mark = list.find((m) => m.id === args.id);
          if (action === "edit") mark.text = args.text;
          if (action === "remove") list.splice(list.indexOf(mark), 1);
          return state();
        },
        setContext: async (value) =>
          window.mock.calls.push(["setContext", value]),
        copyText: async (text) => window.mock.calls.push(["copyText", text]),
        startRun: async () => {
          window.mock.calls.push(["startRun"]);
          const s = window.mock.state;
          const taken = s.marks.filter((m) => m.state === "open");
          for (const m of taken) m.state = "background";
          s.run = {
            id: "r1",
            status: "running",
            started: "2026-11-08T10:00:00.000Z",
            finished: null,
            count: taken.length,
            proposals: 0,
          };
          return state();
        },
        stopRun: async (id) => {
          window.mock.calls.push(["stopRun", id]);
          const s = window.mock.state;
          for (const m of s.marks)
            if (m.state === "background") m.state = "open";
          s.run = { ...s.run, status: "stopped" };
          return state();
        },
        dismissRun: async (id) => {
          window.mock.calls.push(["dismissRun", id]);
          window.mock.state.run = null;
          return state();
        },
        openMarked: async (id) => {
          window.mock.calls.push(["openMarked", id]);
          const mark = window.mock.state.marks.find((m) => m.id === id);
          return { ...byPath(mark.file) };
        },
      });
    },
    { text, marks, run, PLAN, IDEAS },
  );
  await page.goto("/");
  await expect(page.locator("#content h1")).toContainText("Plan");
}

const highlighted = (page, name = "folio-mark") =>
  page.evaluate(
    (name) => [...(CSS.highlights.get(name) || [])].map((r) => r.toString()),
    name,
  );
const calls = (page, name) =>
  page.evaluate(
    (name) =>
      window.mock.calls.filter((c) => c[0] === name).map((c) => c.slice(1)),
    name,
  );

// Selects a phrase of the rendered note.
async function select(page, phrase) {
  await page.evaluate((phrase) => {
    const walker = document.createTreeWalker(
      document.querySelector("#content"),
      NodeFilter.SHOW_TEXT,
    );
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(phrase);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + phrase.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    throw Error("No " + phrase);
  }, phrase);
}

const mark = (id, quote, words, extra = {}) => ({
  id,
  file: PLAN,
  name: "Plan.md",
  quote,
  prefix: "",
  suffix: "",
  text: words,
  created: "2026-11-07T09:00:00.000Z",
  state: "open",
  ...extra,
});

test("marks are kept; the list says how the AI takes them, or hands them to a background AI", async ({
  page,
}) => {
  await boot(page);
  const button = page.locator("#marks-button");
  // From the context menu.
  await select(page, "on Friday");
  await page
    .locator("#content")
    .getByText("Send it on Friday.")
    .click({ button: "right", position: { x: 70, y: 8 } });
  await page.getByRole("menuitem", { name: "标记给 AI… Ctrl+Alt+M" }).click();
  const card = page.locator(".mark-card");
  await expect(card.locator(".mark-quote")).toHaveText("on Friday");
  await card.getByRole("textbox").fill("Can this be earlier?");
  await card.getByRole("button", { name: "保存标记" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator("#toast")).toHaveText("已存为标记，1 条待处理");
  expect((await calls(page, "changeMark"))[0]).toEqual([
    "add",
    {
      fileId: "file-plan",
      quote: "on Friday",
      prefix: "# Plan\n\nSend it ",
      suffix: ".\n\nAsk Ana about the budget.\n",
      text: "Can this be earlier?",
    },
  ]);
  await expect.poll(() => highlighted(page)).toEqual(["on Friday"]);
  // The keyboard way.
  await select(page, "the budget");
  await page.keyboard.press("Control+Alt+m");
  await expect(card.getByRole("textbox")).toBeFocused();
  await card.getByRole("textbox").fill("Which budget?");
  await card.getByRole("textbox").press("Control+Enter");
  await expect(button).toHaveAttribute("data-count", "2");
  // The list: the marks by note, nothing to send, what to tell the AI.
  await button.click();
  const panel = page.locator(".marks-panel");
  await expect(panel.locator(".marks-note")).toHaveText(["Plan.md"]);
  await expect(panel.locator(".marks-list .mark-item-text")).toHaveText([
    "Can this be earlier?",
    "Which budget?",
  ]);
  await expect(panel.getByRole("button", { name: /发送/ })).toHaveCount(0);
  await expect(panel.locator(".marks-hint")).toContainText(
    "在你的 AI 对话里说：",
  );
  await panel.getByRole("button", { name: "看一下 Marklore 的标记" }).click();
  expect(await calls(page, "copyText")).toEqual([["看一下 Marklore 的标记"]]);
  await expect(page.locator("#toast")).toHaveText("已复制，粘贴到 AI 的对话里");
  // Or a background AI takes them: worked on, dotted, out of the count.
  await panel.getByRole("button", { name: "交给后台 AI（2 条）" }).click();
  expect(await calls(page, "startRun")).toEqual([[]]);
  await expect(panel.locator(".marks-run")).toHaveText(
    /后台 AI 正在处理 2 条标记…/,
  );
  await expect(panel.locator(".mark-item-status")).toHaveText([
    "后台 AI 正在处理",
    "后台 AI 正在处理",
  ]);
  await expect.poll(() => highlighted(page)).toEqual([]);
  await expect
    .poll(() => highlighted(page, "folio-mark-sent"))
    .toEqual(["on Friday", "the budget"]);
  await expect(button).toHaveClass(/working/);
  await expect(panel.locator(".marks-how")).toHaveCount(0);
  // Stopped: the marks are the reader's again.
  await panel.getByRole("button", { name: "停止" }).click();
  expect(await calls(page, "stopRun")).toEqual([["r1"]]);
  await expect(panel.locator(".marks-run")).toHaveText(/后台 AI 已停止/);
  await expect(button).toHaveAttribute("data-count", "2");
  await panel.getByRole("button", { name: "收起" }).click();
  expect(await calls(page, "dismissRun")).toEqual([["r1"]]);
  await expect(panel.locator(".marks-run")).toHaveCount(0);
});

test("what the AI made of the marks shows in the list and on each mark", async ({
  page,
}) => {
  await boot(page, {
    marks: [
      mark("m1", "on Friday", "Earlier?", { state: "proposed" }),
      mark("m2", "the budget", "Which?", {
        state: "replied",
        answer: { by: "claude-code", text: "This year's or next?" },
      }),
    ],
    run: {
      id: "r1",
      status: "done",
      started: "2026-11-08T10:00:00.000Z",
      finished: "2026-11-08T10:02:00.000Z",
      count: 2,
      proposals: 1,
      result: "Moved the date; asked about the budget.",
    },
  });
  // Waiting on review: dotted; answered: solid, a dot on the button.
  await expect
    .poll(() => highlighted(page, "folio-mark-sent"))
    .toEqual(["on Friday"]);
  await expect.poll(() => highlighted(page)).toEqual(["the budget"]);
  const button = page.locator("#marks-button");
  await expect(button).toHaveClass(/answered/);
  await button.click();
  const panel = page.locator(".marks-panel");
  await expect(panel.locator(".marks-run-line")).toHaveText(
    "后台 AI 处理完了：提了 1 条修改",
  );
  await expect(panel.locator(".marks-run-result")).toHaveText(
    "Moved the date; asked about the budget.",
  );
  await expect(panel.locator(".mark-item-status")).toHaveText([
    "AI 提了修改，等你审阅",
    "AI：This year's or next?",
  ]);
  // Nothing open: nothing to hand over.
  await expect(panel.locator(".marks-how")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // The answered mark's card: what was said, read only; ask further, or
  // be done with it.
  const passage = () =>
    page
      .locator("#content")
      .getByText("Ask Ana about the budget")
      .click({ position: { x: 160, y: 8 } });
  await passage();
  const card = page.locator(".mark-card");
  await expect(card.locator(".mark-turn")).toHaveText([
    "你：Which?",
    "AI：This year's or next?",
  ]);
  await expect(card.getByRole("textbox")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "保存" })).toHaveCount(0);
  await card.getByRole("button", { name: "追问…" }).click();
  const further = card.getByRole("textbox");
  await expect(further).toBeFocused();
  await expect(further).toHaveValue("");
  await further.fill("Next year's.");
  await further.press("Control+Enter");
  await expect(card).toHaveCount(0);
  expect((await calls(page, "changeMark")).at(-1)).toEqual([
    "edit",
    { id: "m2", text: "Next year's." },
  ]);
  // Done with an answer: the mark goes.
  await page.evaluate(() => {
    const m = window.mock.state.marks.find((x) => x.id === "m2");
    m.state = "replied";
    m.answer = { by: "claude-code", text: "Noted." };
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#marks-button")).toHaveClass(/answered/);
  await passage();
  await card.getByRole("button", { name: "完成", exact: true }).click();
  expect((await calls(page, "changeMark")).at(-1)).toEqual([
    "remove",
    { id: "m2" },
  ]);
});

test("a background AI that did not finish says why", async ({ page }) => {
  await boot(page, {
    marks: [mark("m1", "on Friday", "Earlier?")],
    run: {
      id: "r1",
      status: "failed",
      started: "2026-11-08T10:00:00.000Z",
      finished: "2026-11-08T10:00:05.000Z",
      count: 1,
      proposals: 0,
      error: "Not signed in.",
    },
  });
  await page.locator("#marks-button").click();
  const panel = page.locator(".marks-panel");
  await expect(panel.locator(".marks-run-line")).toHaveText(
    "后台 AI 没有完成：Not signed in.",
  );
  await expect(
    panel.getByRole("button", { name: "交给后台 AI（1 条）" }),
  ).toBeEnabled();
});

test("a mark opens from its passage to be changed or deleted", async ({
  page,
}) => {
  await boot(page, { marks: [mark("m1", "the budget", "Which?")] });
  await expect.poll(() => highlighted(page)).toEqual(["the budget"]);
  await page
    .locator("#content")
    .getByText("Ask Ana about the budget")
    .click({ position: { x: 160, y: 8 } });
  const card = page.locator(".mark-card");
  await expect(card.getByRole("textbox")).toHaveValue("Which?");
  await card.getByRole("textbox").fill("Which year's budget?");
  await card.getByRole("button", { name: "保存", exact: true }).click();
  expect((await calls(page, "changeMark")).at(-1)).toEqual([
    "edit",
    { id: "m1", text: "Which year's budget?" },
  ]);
  await page
    .locator("#content")
    .getByText("Ask Ana about the budget")
    .click({ position: { x: 160, y: 8 } });
  await card.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => highlighted(page)).toEqual([]);
  await expect(page.locator("#marks-button")).toHaveClass(/settled/);
});

test("a mark in the list on another note opens that note at the passage", async ({
  page,
}) => {
  await boot(page, {
    marks: [
      mark("m1", "A reading list.", "Add two books", {
        file: IDEAS,
        name: "Ideas.md",
      }),
    ],
  });
  await page.locator("#marks-button").click();
  await page.locator(".marks-panel .mark-item").click();
  expect(await calls(page, "openMarked")).toEqual([["m1"]]);
  await expect(page.locator(".marks-panel")).toHaveCount(0);
  await expect(page.locator("#content h1")).toContainText("Ideas");
  await expect(page.locator(".mark-card .mark-quote")).toHaveText(
    "A reading list.",
  );
});

test("the note and the selected text are told for the AI to ask about", async ({
  page,
}) => {
  await boot(page);
  await expect
    .poll(async () => (await calls(page, "setContext")).at(-1))
    .toEqual([{ fileId: "file-plan", selection: null }]);
  await select(page, "on Friday");
  await expect
    .poll(async () => (await calls(page, "setContext")).at(-1))
    .toEqual([
      {
        fileId: "file-plan",
        selection: { text: "on Friday", from: text.indexOf("on Friday") },
      },
    ]);
});

test("a new note cannot be marked until it is saved", async ({ page }) => {
  await boot(page);
  await page.locator("#new").click();
  await page.keyboard.type("Draft text");
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await select(page, "Draft");
  await page.keyboard.press("Control+Alt+m");
  await expect(page.locator("#toast")).toHaveText("请先保存笔记，再标记");
});
