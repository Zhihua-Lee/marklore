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

test("a proposal previews the note as it would read, then is accepted and saved", async ({
  page,
}) => {
  await boot(page, { proposals: [edit] });
  await openFromToolbar(page, /Plan\.md\s*Claude Code：Earlier deadline/);
  const bar = page.locator("#proposal-bar");
  await expect(bar).toContainText("Claude Code 提议修改：Earlier deadline");
  await expect(bar.getByRole("button", { name: "预览" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The note shows the proposed text, the changed words marked.
  await expect(page.locator("#content")).toContainText(
    "Send it on Thursday morning.",
  );
  await expect(page.locator("#content .proposal-changed")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      [...CSS.highlights.get("folio-proposal")].map((r) => r.toString()),
    ),
  ).toEqual(["Thursday morning"]);
  // The source diff.
  await bar.getByRole("button", { name: "源码对比" }).click();
  await expect(page.locator("#content .diff-del")).toContainText(
    "Send it on Friday.",
  );
  await expect(page.locator("#content .diff-add")).toContainText(
    "Send it on Thursday morning.",
  );
  // Nothing changed in the note yet.
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  await bar.getByRole("button", { name: "接受并保存" }).click();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.mock.saved)).toEqual([
    {
      id: "file-plan",
      text: "# Plan\n\nWrite the draft.\n\nSend it on Thursday morning.\n",
    },
  ]);
  expect(await page.evaluate(() => window.mock.decided)).toEqual([
    { id: "p1", status: "accepted", saved: true },
  ]);
  await expect(page.locator("#content .proposal-changed")).toHaveCount(0);
  await expect(page.locator("#content")).toContainText("Thursday morning");
  await expect(page.locator("#proposals-button")).toBeHidden();
});

test("into a note with unsaved changes, a proposal joins the draft and undoes with one Ctrl+Z", async ({
  page,
}) => {
  await boot(page, { proposals: [edit] });
  await openFromToolbar(page, /Plan\.md/);
  const bar = page.locator("#proposal-bar");
  await bar.getByRole("button", { name: "预览" }).click();
  await expect(page.locator("#content .proposal-changed")).toHaveCount(0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("Mine. ");
  await expect(bar.getByRole("button", { name: "接受到草稿" })).toBeVisible();
  await bar.getByRole("button", { name: "接受到草稿" }).click();
  await expect(bar).toBeHidden();
  const text = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".cm-line")]
        .map((line) => line.textContent)
        .join("\n"),
    );
  expect(await text()).toBe(
    "Mine. # Plan\n\nWrite the draft.\n\nSend it on Thursday morning.\n",
  );
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  expect(await page.evaluate(() => window.mock.decided)).toEqual([
    { id: "p1", status: "accepted", saved: false },
  ]);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  expect(await text()).toBe(
    "Mine. # Plan\n\nWrite the draft.\n\nSend it on Friday.\n",
  );
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
  await expect(bar.locator(".proposal-count")).toHaveText("1 / 2");
  await bar.getByRole("button", { name: "拒绝" }).click();
  await expect(bar).toContainText("的提议与笔记当前内容对不上");
  await expect(bar).toContainText("第 1 处修改的原文已改变");
  await expect(bar.getByRole("button", { name: "接受并保存" })).toHaveCount(0);
  await bar.getByRole("button", { name: "关闭提议" }).click();
  await expect(bar).toBeHidden();
  const decided = await page.evaluate(() => window.mock.decided);
  expect(decided.map((d) => [d.id, d.status])).toEqual([
    ["p1", "rejected"],
    ["p2", "failed"],
  ]);
  expect(decided[1].error).toMatch(/no longer in the note/);
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  await expect(page.locator("#content")).toContainText("Send it on Friday.");
});

test("a proposed new note previews in its own tab and is created on accept", async ({
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
  await bar.getByRole("button", { name: "接受并创建" }).click();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.mock.created)).toEqual(["p3"]);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab")).toContainText("Meeting.md");
  await expect(page.locator("#content li")).toHaveText("Agenda");
});

test("Settings opens libraries to AI and copies the server's setup", async ({
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
  await page.locator("#ai-copy-claude").click();
  await page.locator("#ai-copy-codex").click();
  const [claude, codex] = await page.evaluate(() => window.mock.copied);
  expect(claude).toBe(
    'claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio --scope user marklore -- "C:\\Apps\\Marklore\\Marklore.exe" "C:\\Apps\\Marklore\\resources\\app.asar\\desktop\\mcp.mjs"',
  );
  expect(codex).toContain("[mcp_servers.marklore]");
  expect(codex).toContain("command = 'C:\\Apps\\Marklore\\Marklore.exe'");
  await expect(page.locator("#ai-setup")).toContainText("mcp.mjs");
});
