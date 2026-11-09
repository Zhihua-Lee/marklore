import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// AI proposals (src/proposals.js) against a mocked main process: the list,
// the decisions and the saves are recorded in window.mock.
async function boot(page, { proposals = [], roots = [], settings = {} } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ proposals, roots, settings }) => {
      const files = [
        {
          id: "file-plan",
          path: "C:/synthetic/Notes/Plan.md",
          name: "Plan.md",
          text: "# Plan\n\nWrite the draft.\n\nSend it on Friday.\n",
          version: "v1",
        },
      ];
      window.mock = {
        files,
        handlers: {},
        proposals,
        decided: [],
        saved: [],
        copied: [],
        created: [],
        connections: {
          claude: {
            kind: "claude",
            state: "other",
            installed: true,
            sessions: 0,
            command: "D:\\Old\\Marklore.exe",
            missing: true,
            file: "C:\\Users\\me\\.claude.json",
          },
          codex: {
            kind: "codex",
            state: "none",
            installed: true,
            sessions: 0,
            file: "C:\\Users\\me\\.codex\\config.toml",
          },
        },
      };
      const remove = (id) =>
        (window.mock.proposals = window.mock.proposals.filter(
          (p) => p.id !== id,
        ));
      window.folio = folioTest.mock({
        ready: async () => ({ incoming: [], restored: [], roots, settings }),
        read: async () => ({ unchanged: true }),
        save: async (id, text, version) => {
          window.mock.saved.push({ id, text });
          return { version: version + "s" };
        },
        proposals: async () => window.mock.proposals,
        openProposal: async (id) => ({
          proposal: window.mock.proposals.find((p) => p.id === id),
          document: { ...files[0] },
        }),
        decideProposal: async (id, decision) => {
          window.mock.decided.push({ id, ...decision });
          const p = window.mock.proposals.find((x) => x.id === id);
          // One edit decided: the proposal waits until no edit does.
          if (decision.edit !== undefined && p) {
            p.results ??= p.edits.map(() => "pending");
            p.results[decision.edit] = decision.status;
            if (p.results.includes("pending")) return;
          }
          remove(id);
        },
        createProposedNote: async (id) => {
          const p = window.mock.proposals.find((x) => x.id === id);
          window.mock.created.push(id);
          remove(id);
          return {
            id: "file-new",
            path: "C:/synthetic/Notes/" + p.name,
            name: p.name,
            text: p.text,
            version: "n1",
          };
        },
        aiSetup: async () => ({
          command: "C:\\Apps\\Marklore\\Marklore.exe",
          args: ["C:\\Apps\\Marklore\\resources\\app.asar\\desktop\\mcp.mjs"],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        }),
        copyText: async (text) => window.mock.copied.push(text),
        aiConnections: async () =>
          ["claude", "codex"].map((kind) => window.mock.connections[kind]),
        aiConnect: async (kind) => {
          window.mock.connections[kind] = {
            kind,
            state: "ok",
            installed: true,
            sessions: 0,
            file: "C:\\Users\\me\\.claude.json",
          };
        },
        aiDisconnect: async (kind) => {
          window.mock.connections[kind] = {
            kind,
            state: "none",
            installed: true,
            sessions: 0,
            file: "C:\\Users\\me\\.codex\\config.toml",
          };
        },
      });
    },
    { proposals, roots, settings },
  );
  await page.goto("/");
}

const edit = {
  id: "p1",
  kind: "edit",
  client: "claude-code",
  summary: "Earlier deadline",
  created: "2026-10-23T10:00:00.000Z",
  note: "Notes/Plan.md",
  file: "C:\\synthetic\\Notes\\Plan.md",
  name: "Plan.md",
  edits: [{ old_text: "on Friday", new_text: "on Thursday morning" }],
};

async function openFromToolbar(page, label) {
  const button = page.locator("#proposals-button");
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("data-count", "1");
  await button.click();
  await page.getByRole("menuitem", { name: label }).click();
}

// The bar's controls by name, and whether a toggle is on.
const control = (bar, name) => bar.getByRole("button", { name, exact: true });
const pressed = (bar, name) =>
  expect(control(bar, name)).toHaveAttribute("aria-pressed", "true");

test("a proposal is reviewed in the note, then accepted and saved at the end", async ({
  page,
}) => {
  await boot(page, { proposals: [edit] });
  await openFromToolbar(page, /Plan\.md\s*Claude Code：Earlier deadline/);
  const bar = page.locator("#proposal-bar");
  await expect(bar).toContainText("Claude Code 提议修改：Earlier deadline");
  // Reviewing: rendered, the whole note.
  await pressed(bar, "渲染");
  await pressed(bar, "全文");
  // The note shows the proposed text, the changed words marked (the
  // removed word struck through before the new ones).
  await expect(page.locator("#content")).toContainText(
    "Send it on FridayThursday morning.",
  );
  await expect(page.locator("#content .proposal-added")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      [...CSS.highlights.get("folio-proposal-add")].map((r) => r.toString()),
    ),
  ).toEqual(["Thursday morning"]);
  await expect(page.locator("#content del.proposal-del")).toHaveText("Friday");
  // Source, whole note: every line, the changed one in both versions.
  await control(bar, "源码").click();
  const source = page.locator("#content .proposal-srcview");
  await expect(source.locator(".src-row")).toHaveCount(6);
  await expect(source.locator(".src-del")).toHaveText(/Send it on Friday\./);
  await expect(source.locator(".src-add")).toHaveText(
    /Send it on Thursday morning\./,
  );
  await expect(source.locator(".src-add .proposal-word")).toHaveText(
    /Thursday morning/,
  );
  // Source, changes only: the hunk and the lines around it.
  await control(bar, "仅改动").click();
  await expect(source.locator(".src-row")).toHaveCount(5);
  // A single change: nothing to step through, the decision is the same.
  await expect(control(bar, "上一处修改")).toBeDisabled();
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 1 / 1 处",
  );
  await expect(bar.locator(".proposal-progress")).toHaveText("已决定 0 / 1");
  // Nothing is written while the review is open.
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  expect(await page.evaluate(() => window.mock.decided)).toEqual([]);
  // Deciding the last change ends the review: no button to finish it.
  await expect(control(bar, "完成审阅")).toHaveCount(0);
  await control(bar, "接受这处").click();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.mock.saved)).toEqual([
    {
      id: "file-plan",
      text: "# Plan\n\nWrite the draft.\n\nSend it on Thursday morning.\n",
    },
  ]);
  expect(await page.evaluate(() => window.mock.decided)).toEqual([
    { id: "p1", results: ["accepted"], saved: true },
  ]);
  await expect(page.locator("#content .proposal-added")).toHaveCount(0);
  await expect(page.locator("#content")).toContainText("Thursday morning");
  await expect(page.locator("#proposals-button")).toBeHidden();
});

test("into a note with unsaved changes, a proposal joins the draft and undoes with one Ctrl+Z", async ({
  page,
}) => {
  await boot(page, { proposals: [edit] });
  await openFromToolbar(page, /Plan\.md/);
  const bar = page.locator("#proposal-bar");
  // Out of the review: the note itself, and a way back in.
  await control(bar, "退出审阅").click();
  await expect(page.locator("#content .proposal-added")).toHaveCount(0);
  await expect(control(bar, "审阅")).toBeVisible();
  await expect(control(bar, "全部接受")).toHaveCount(0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("Mine. ");
  await control(bar, "审阅").click();
  await expect(control(bar, "全部接受")).toHaveAttribute(
    "title",
    /未保存的修改/,
  );
  // Accepting all writes at once and ends the review.
  await control(bar, "全部接受").click();
  await expect(bar).toBeHidden();
  const text = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".cm-line")]
        .map((line) => line.textContent)
        .join("\n"),
    );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  expect(await text()).toBe(
    "Mine. # Plan\n\nWrite the draft.\n\nSend it on Thursday morning.\n",
  );
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  expect(await page.evaluate(() => window.mock.decided)).toEqual([
    { id: "p1", results: ["accepted"], saved: false },
  ]);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  expect(await text()).toBe(
    "Mine. # Plan\n\nWrite the draft.\n\nSend it on Friday.\n",
  );
});

test("several changes: two independent choices of view, review colors, and staged decisions", async ({
  page,
}) => {
  const three = {
    ...edit,
    id: "p4",
    summary: "Tidy the plan",
    edits: [
      { old_text: "# Plan", new_text: "# Plan for the week" },
      { old_text: "Write the draft.", new_text: "Write the first draft." },
      { old_text: "Send it on Friday.\n", new_text: "" },
    ],
  };
  await boot(page, { proposals: [three] });
  await openFromToolbar(page, /Plan\.md/);
  const bar = page.locator("#proposal-bar");
  const content = page.locator("#content");
  // The controls keep their places whatever is chosen.
  const places = () =>
    bar
      .locator("button")
      .evaluateAll((list) =>
        list.map((b) => [
          b.textContent,
          Math.round(b.getBoundingClientRect().x),
        ]),
      );
  const start = await places();
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 1 / 3 处",
  );
  // Rendered, whole note: new words green and underlined, the removed
  // paragraph struck through in red where it was, a mark per change.
  expect(
    await page.evaluate(() =>
      [...CSS.highlights.get("folio-proposal-add")].map((r) =>
        r.toString().trim(),
      ),
    ),
  ).toEqual(["for the week", "first"]);
  const removed = content.locator("del.proposal-del-block");
  await expect(removed).toHaveText("Send it on Friday.");
  await expect(page.locator(".proposal-rail-mark")).toHaveCount(3);
  const colors = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const del = getComputedStyle(document.querySelector("del.proposal-del"));
    return {
      accent,
      background: del.backgroundColor,
      ink: del.color,
      line: del.textDecorationLine,
    };
  });
  const rgb = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
  const [r, g] = rgb(colors.background);
  expect(r).toBeGreaterThan(g + 20);
  expect(colors.ink).not.toBe(colors.accent);
  expect(colors.background).not.toBe(colors.accent);
  expect(colors.line).toBe("line-through");
  // Rendered, changes only: one card per change, before and after.
  await control(bar, "仅改动").click();
  const cards = content.locator(".proposal-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1).locator(".proposal-before")).toContainText(
    "Write the draft.",
  );
  await expect(cards.nth(1).locator(".proposal-after")).toContainText(
    "Write the first draft.",
  );
  await expect(cards.nth(2).locator(".proposal-after")).toContainText("（无）");
  expect(
    await page.evaluate(() =>
      [...CSS.highlights.get("folio-proposal-del")].map((r) => r.toString()),
    ),
  ).toEqual(["Send it on Friday."]);
  // Source, changes only: the hunks, the words that differ standing out.
  await control(bar, "源码").click();
  await pressed(bar, "仅改动");
  await expect(content.locator(".proposal-card")).toHaveCount(0);
  await expect(content.locator(".src-hunk")).toHaveCount(3);
  await expect(content.locator(".src-add .proposal-word")).toHaveText([
    / ?for the week/,
    / ?first ?/,
  ]);
  // Change by change works in every view; the places did not move.
  expect(await places()).toEqual(start);
  await control(bar, "下一处修改").click();
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 2 / 3 处",
  );
  await expect(content.locator(".src-hunk.proposal-current")).toContainText(
    "Write the first draft.",
  );
  // Accepted: marked, and on to the next undecided change.
  await control(bar, "接受这处").click();
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 3 / 3 处",
  );
  await expect(content.locator(".src-hunk.proposal-ok")).toContainText(
    "Write the first draft.",
  );
  await control(bar, "拒绝这处").click();
  await expect(content.locator(".src-hunk.proposal-no")).toContainText(
    "Send it on Friday.",
  );
  await expect(bar.locator(".proposal-progress")).toHaveText("已决定 2 / 3");
  // Back to the rendered note: the decisions show there too.
  await control(bar, "渲染").click();
  await control(bar, "全文").click();
  await expect(content.locator(".proposal-tag.proposal-ok")).toHaveText(
    "已接受",
  );
  await expect(content.locator(".proposal-tag.proposal-no")).toHaveText(
    "已拒绝",
  );
  await expect(content.locator("del.proposal-del-block")).toHaveClass(
    /proposal-no/,
  );
  // After the last change it went back to the first undecided one.
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 1 / 3 处",
  );
  // A decision taken back, then made again; nothing was written meanwhile.
  await control(bar, "下一处修改").click();
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 2 / 3 处",
  );
  await pressed(bar, "接受这处");
  await control(bar, "接受这处").click();
  await expect(control(bar, "接受这处")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(bar.locator(".proposal-progress")).toHaveText("已决定 1 / 3");
  await control(bar, "接受这处").click();
  await expect(bar.locator(".proposal-progress")).toHaveText("已决定 2 / 3");
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 1 / 3 处",
  );
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  expect(await page.evaluate(() => window.mock.decided)).toEqual([]);
  expect(await places()).toEqual(start);
  // Out and back in: the decisions were kept.
  await control(bar, "退出审阅").click();
  await control(bar, "审阅").click();
  await expect(bar.locator(".proposal-progress")).toHaveText("已决定 2 / 3");
  // The last undecided change decided: the review ends and is written.
  await control(bar, "拒绝这处").click();
  await expect(bar).toBeHidden();
  expect((await page.evaluate(() => window.mock.saved)).at(-1).text).toBe(
    "# Plan\n\nWrite the first draft.\n\nSend it on Friday.\n",
  );
  expect(await page.evaluate(() => window.mock.decided)).toEqual([
    { id: "p4", results: ["rejected", "accepted", "rejected"], saved: true },
  ]);
  await expect(page.locator(".proposal-rail")).toHaveCount(0);
});

test("a rejection can say why: per change, or for the whole proposal", async ({
  page,
}) => {
  const two = {
    ...edit,
    id: "p5",
    summary: "Tidy the plan",
    edits: [
      { old_text: "# Plan", new_text: "# Plan for the week" },
      { old_text: "on Friday", new_text: "on Thursday" },
    ],
  };
  await boot(page, { proposals: [two] });
  await openFromToolbar(page, /Plan\.md/);
  const bar = page.locator("#proposal-bar");
  // The arrow beside "reject this" offers to reject and say why.
  await control(bar, "拒绝这处的选项").click();
  await page.getByRole("menuitem", { name: "拒绝并说明…" }).click();
  const reason = page.locator(".proposal-reason input");
  await expect(reason).toBeFocused();
  await reason.fill("Keep the title short");
  await reason.press("Enter");
  await expect(reason).toHaveCount(0);
  // Rejected, the reason kept, on to the next change.
  await expect(bar.locator(".proposal-one .proposal-count")).toHaveText(
    "第 2 / 2 处",
  );
  await control(bar, "上一处修改").click();
  await pressed(bar, "拒绝这处");
  await expect(control(bar, "拒绝这处")).toHaveAttribute(
    "title",
    "理由：Keep the title short",
  );
  // Escape drops what was typed; the reason stays as it was.
  await control(bar, "拒绝这处的选项").click();
  await page.getByRole("menuitem", { name: "拒绝并说明…" }).click();
  await expect(reason).toHaveValue("Keep the title short");
  await reason.fill("Something else");
  await reason.press("Escape");
  await expect(control(bar, "拒绝这处")).toHaveAttribute(
    "title",
    "理由：Keep the title short",
  );
  await control(bar, "下一处修改").click();
  await control(bar, "接受这处").click();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.mock.decided)).toEqual([
    {
      id: "p5",
      results: ["rejected", "accepted"],
      saved: true,
      reasons: ["Keep the title short", null],
    },
  ]);
});

test("a whole new note rejected with a note for the AI", async ({ page }) => {
  await boot(page, {
    proposals: [
      {
        id: "p6",
        kind: "note",
        client: "codex-mcp-client",
        summary: "Meeting notes",
        created: "2026-10-23T10:00:00.000Z",
        note: "Notes/Meeting.md",
        name: "Meeting.md",
        text: "# Meeting\n",
      },
    ],
  });
  await openFromToolbar(page, /Meeting\.md/);
  const bar = page.locator("#proposal-bar");
  // Per change: nothing to choose for a whole note.
  await expect(control(bar, "拒绝这处的选项")).toBeDisabled();
  await control(bar, "全部拒绝的选项").click();
  await page.getByRole("menuitem", { name: "全部拒绝并说明…" }).click();
  await page.locator(".proposal-reason input").fill("Use the existing note");
  await page.locator(".proposal-reason input").press("Enter");
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.mock.decided)).toEqual([
    { id: "p6", status: "rejected", note: "Use the existing note" },
  ]);
});

test("a rejected proposal changes nothing; a stale one can only be dismissed", async ({
  page,
}) => {
  const stale = {
    ...edit,
    id: "p2",
    summary: "Fix a word",
    edits: [{ old_text: "Write the first draft.", new_text: "Write it." }],
  };
  await boot(page, { proposals: [edit, stale] });
  await page.locator("#proposals-button").click();
  await page.getByRole("menuitem", { name: /Earlier deadline/ }).click();
  const bar = page.locator("#proposal-bar");
  await expect(bar.locator(".proposal-switch .proposal-count")).toHaveText(
    "1 / 2",
  );
  // Rejecting all ends that review; the next one no longer fits the note.
  await control(bar, "全部拒绝").click();
  await expect(bar).toContainText("的提议与笔记当前内容对不上");
  await expect(bar).toContainText("第 1 处修改的原文已改变");
  await expect(control(bar, "全部拒绝")).toHaveCount(0);
  await control(bar, "关闭提议").click();
  await expect(bar).toBeHidden();
  const decided = await page.evaluate(() => window.mock.decided);
  expect(decided.map((d) => [d.id, d.status || d.results.join()])).toEqual([
    ["p1", "rejected"],
    ["p2", "failed"],
  ]);
  expect(decided[1].error).toMatch(/no longer in the note/);
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  await expect(page.locator("#content")).toContainText("Send it on Friday.");
});

test("a proposed new note is reviewed in its own tab and created on accepting", async ({
  page,
}) => {
  await boot(page, {
    proposals: [
      {
        id: "p3",
        kind: "note",
        client: "codex-mcp-client",
        summary: "Meeting notes",
        created: "2026-10-23T10:00:00.000Z",
        note: "Notes/Meeting.md",
        name: "Meeting.md",
        text: "# Meeting\n\n- Agenda\n",
      },
    ],
  });
  await openFromToolbar(page, /Meeting\.md\s*Codex：Meeting notes/);
  const bar = page.locator("#proposal-bar");
  await expect(bar).toContainText("Codex 提议新建这篇笔记：Meeting notes");
  await expect(page.locator("#content h1")).toContainText("Meeting");
  // A new note is one whole: nothing to step through or narrow down.
  await expect(control(bar, "接受这处")).toBeDisabled();
  await expect(control(bar, "仅改动")).toBeDisabled();
  await control(bar, "源码").click();
  await expect(page.locator("#content .src-add")).toHaveCount(3);
  await control(bar, "全部接受").click();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.mock.created)).toEqual(["p3"]);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab")).toContainText("Meeting.md");
  await expect(page.locator("#content li")).toHaveText("Agenda");
});

test("Settings opens libraries to AI and connects assistants with one button", async ({
  page,
}) => {
  await boot(page, {
    roots: [
      { id: "r1", name: "Notes", path: "C:\\synthetic\\Notes" },
      { id: "r2", name: "Private", path: "C:\\synthetic\\Private" },
    ],
    settings: { aiLibraries: ["C:\\synthetic\\Notes"] },
  });
  await page.locator("#weight").click();
  await page
    .locator(".settings-nav")
    .getByRole("button", { name: "AI 助手" })
    .click();
  const boxes = page.locator("#ai-libraries input");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Private" }).check();
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings.aiLibraries))
    .toEqual(["C:\\synthetic\\Notes", "C:\\synthetic\\Private"]);
  // Each assistant: its state, and one button.
  const row = (kind) => page.locator(`#ai-connections li[data-kind="${kind}"]`);
  await expect(row("claude")).toContainText("Claude Code");
  await expect(row("claude")).toContainText(
    "连接的 Marklore 已不在原处：D:\\Old\\Marklore.exe",
  );
  await expect(row("codex")).toContainText("未连接");
  await row("codex").getByRole("button", { name: "连接" }).click();
  await expect(row("codex")).toContainText("已连接 · 新开的会话就能使用");
  await expect(page.locator("#toast")).toHaveText(
    "已连接 Codex：在它新开的会话里就能使用 Marklore",
  );
  await row("claude").getByRole("button", { name: "改为连接这个" }).click();
  await expect(row("claude")).toContainText("已连接");
  await row("claude").getByRole("button", { name: "断开" }).click();
  await expect(row("claude")).toContainText("未连接");
  // Any other assistant: the setup as JSON.
  await page.locator("#ai-copy-json").click();
  const [json] = await page.evaluate(() => window.mock.copied);
  expect(JSON.parse(json).mcpServers.marklore.command).toBe(
    "C:\\Apps\\Marklore\\Marklore.exe",
  );
  await expect(page.locator("#ai-setup")).toContainText("mcp.mjs");
});
