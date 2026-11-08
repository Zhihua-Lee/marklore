import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Marks for the AI (src/marks.js) against a mocked main process that keeps
// the marks, batches and sessions in window.mock.state, as
// desktop/ai-bridge.mjs does.
const text = "# Plan\n\nSend it on Friday.\n\nAsk Ana about the budget.\n";
const PLAN = "C:/synthetic/Notes/Plan.md",
  IDEAS = "C:/synthetic/Notes/Ideas.md";
const claude = {
  id: "s1",
  client: "claude-code",
  cwd: "C:/work/project",
  folder: "project",
  push: true,
  active: "2026-11-07T10:00:00.000Z",
};

async function boot(
  page,
  { marks = [], batches = [], sessions = [claude], settings = {} } = {},
) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, marks, batches, sessions, settings, PLAN, IDEAS }) => {
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
      window.mock = {
        handlers: {},
        state: { marks, batches, sessions },
        calls: [],
      };
      const state = () => structuredClone(window.mock.state);
      let n = 0;
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [files["file-plan"]],
          restored: [],
          roots: [],
          settings,
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
              batch: null,
            });
          }
          const mark = list.find((m) => m.id === args.id);
          if (action === "edit") mark.text = args.text;
          if (action === "remove") list.splice(list.indexOf(mark), 1);
          return state();
        },
        sendMarks: async (target) => {
          window.mock.calls.push(["sendMarks", target]);
          const s = window.mock.state;
          const drafts = s.marks.filter((m) => !m.batch);
          const id = "b" + (s.batches.length + 1);
          s.batches.unshift({
            id,
            created: "2026-11-07T11:00:00.000Z",
            target,
            status: "sent",
            readBy: null,
            marks: drafts.map(({ id, file, name, quote, text }) => ({
              id,
              file,
              name,
              quote,
              text,
            })),
            replies: [],
          });
          for (const m of drafts) m.batch = id;
          return state();
        },
        finishBatch: async (id) => {
          window.mock.calls.push(["finishBatch", id]);
          const s = window.mock.state;
          s.batches = s.batches.filter((b) => b.id !== id);
          s.marks = s.marks.filter((m) => m.batch !== id);
          return state();
        },
        openMarked: async (id) => {
          window.mock.calls.push(["openMarked", id]);
          const mark = window.mock.state.marks.find((m) => m.id === id);
          return { ...byPath(mark.file) };
        },
      });
    },
    { text, marks, batches, sessions, settings, PLAN, IDEAS },
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

const draft = (id, quote, words, file = PLAN, name = "Plan.md") => ({
  id,
  file,
  name,
  quote,
  prefix: "",
  suffix: "",
  text: words,
  created: "2026-11-07T09:00:00.000Z",
  batch: null,
});

test("marks wait until sent, then go together where the reader chose the first time", async ({
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
  await expect(page.locator("#toast")).toHaveText("已存为标记，1 条待发送");
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
  // The keyboard way; nothing is sent yet.
  await select(page, "the budget");
  await page.keyboard.press("Control+Alt+m");
  await expect(card.getByRole("textbox")).toBeFocused();
  await card.getByRole("textbox").fill("Which budget?");
  await card.getByRole("textbox").press("Control+Enter");
  await expect(button).toHaveAttribute("data-count", "2");
  expect(await calls(page, "sendMarks")).toEqual([]);
  // The list: the marks by note, and the first send asks where.
  await button.click();
  const panel = page.locator(".marks-panel");
  await expect(
    panel.getByRole("heading", { name: "未发送（2）" }),
  ).toBeVisible();
  await expect(panel.locator(".marks-note")).toHaveText(["Plan.md"]);
  await expect(panel.locator(".marks-list .mark-item-text")).toHaveText([
    "Can this be earlier?",
    "Which budget?",
  ]);
  await expect(panel.locator(".marks-target")).toHaveText("选择…");
  await panel.getByRole("button", { name: "发送 2 条" }).click();
  await expect(
    panel.getByRole("heading", { name: "发送给哪个 AI 会话？" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: /Claude Code · project/ }).click();
  expect(await calls(page, "sendMarks")).toEqual([
    [{ client: "claude-code", cwd: "C:/work/project", session: "s1" }],
  ]);
  await expect(page.locator("#toast")).toHaveText(
    "已发送给 Claude Code · project",
  );
  // Sent: dotted, out of the count, listed with the batch.
  await expect.poll(() => highlighted(page)).toEqual([]);
  await expect
    .poll(() => highlighted(page, "folio-mark-sent"))
    .toEqual(["on Friday", "the budget"]);
  await expect(button).toHaveClass(/settled/);
  await expect(panel.locator(".marks-batch .marks-status")).toHaveText(
    "等 AI 读取",
  );
  // The next send goes to the same place without asking.
  await page.keyboard.press("Escape");
  await select(page, "Ask Ana");
  await page.keyboard.press("Control+Alt+m");
  await card.getByRole("textbox").fill("Who is Ana?");
  await card.getByRole("textbox").press("Control+Enter");
  await button.click();
  await expect(panel.locator(".marks-target")).toHaveText(
    "Claude Code · project",
  );
  await panel.getByRole("button", { name: "发送 1 条" }).click();
  expect((await calls(page, "sendMarks")).length).toBe(2);
  await expect(panel.locator(".marks-batch")).toHaveCount(2);
});

test("the AI's answer is read in the list; finishing a batch takes its marks away", async ({
  page,
}) => {
  const sent = { ...draft("m1", "on Friday", "Earlier?"), batch: "b1" };
  await boot(page, {
    marks: [sent],
    batches: [
      {
        id: "b1",
        created: "2026-11-07T11:00:00.000Z",
        target: {
          client: "claude-code",
          cwd: "C:/work/project",
          session: "s1",
        },
        status: "replied",
        readBy: "claude-code",
        marks: [
          {
            id: "m1",
            file: PLAN,
            name: "Plan.md",
            quote: "on Friday",
            text: "Earlier?",
          },
        ],
        replies: [
          {
            by: "claude-code",
            text: "Proposed Thursday.",
            at: "2026-11-07T11:05:00.000Z",
          },
        ],
      },
    ],
  });
  const button = page.locator("#marks-button");
  await expect(button).toHaveClass(/answered/);
  await expect
    .poll(() => highlighted(page, "folio-mark-sent"))
    .toEqual(["on Friday"]);
  // Its card says where the answer is; a sent mark is not edited.
  await page
    .locator("#content")
    .getByText("Send it on Friday.")
    .click({ position: { x: 80, y: 8 } });
  const card = page.locator(".mark-card");
  await expect(card.locator(".mark-status")).toHaveText(
    "AI 已回复，回复在标记列表中",
  );
  await expect(card.getByRole("textbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await button.click();
  const panel = page.locator(".marks-panel");
  await expect(panel.locator(".marks-status")).toHaveText("AI 已回复");
  await expect(panel.locator(".marks-reply")).toContainText("Claude Code");
  await expect(panel.locator(".marks-reply")).toContainText(
    "Proposed Thursday.",
  );
  await panel.getByRole("button", { name: "完成" }).click();
  expect(await calls(page, "finishBatch")).toEqual([["b1"]]);
  await expect(panel.locator(".marks-batch")).toHaveCount(0);
  await expect.poll(() => highlighted(page, "folio-mark-sent")).toEqual([]);
  await expect(button).not.toHaveClass(/answered/);
});

test("a mark not sent opens from its passage to be changed or deleted", async ({
  page,
}) => {
  await boot(page, { marks: [draft("m1", "the budget", "Which?")] });
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
    marks: [draft("m1", "A reading list.", "Add two books", IDEAS, "Ideas.md")],
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

test("with no AI session running, the first send says how to start one", async ({
  page,
}) => {
  await boot(page, {
    sessions: [],
    marks: [draft("m1", "on Friday", "Earlier?")],
  });
  await page.locator("#marks-button").click();
  const panel = page.locator(".marks-panel");
  await panel.getByRole("button", { name: "发送 1 条" }).click();
  await expect(panel).toContainText(
    "没有正在运行的 AI 会话：先在终端里启动 Claude Code 或 Codex。",
  );
  await panel.getByRole("button", { name: "返回" }).click();
  await expect(
    panel.getByRole("heading", { name: "未发送（1）" }),
  ).toBeVisible();
  expect(await calls(page, "sendMarks")).toEqual([]);
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
