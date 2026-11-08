// Regenerates the README screenshots and animations from the real desktop app
// and a sample notebook (copied to a temporary folder; the repository notes are
// never modified). Needs a build (pnpm build) and ffmpeg on PATH. Usage:
//   node tools/readme-media.mjs [--lang=en] [scene ...]
// Chinese (default): docs/sample-notebook -> docs/images; English:
// docs/sample-notebook-en -> docs/images/en, with the interface in English.
import { _electron as electron } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const english = args.includes("--lang=en");
// What each scene clicks and types, per language.
const L = english
  ? {
      notebook: "docs/sample-notebook-en",
      folder: "Sample notebook",
      note: "Fourier-analysis.md",
      out: "docs/images/en",
      language: "en",
      outline: [
        "Window functions",
        "Discrete implementation",
        "Parseval's identity",
        "Definition",
      ],
      link: "convolution theorem",
      find: "convolution",
      editHeading: "Parseval's identity",
      editParagraph: "Energy is the same in both domains",
      editText:
        " In the discrete case, $\\sum_n |x_n|^2 = \\frac{1}{N} \\sum_k |X_k|^2$ as well.",
      darkHeading: "Discrete implementation",
      direct: {
        block: "is a quick check",
        text: " For the DFT: $\\sum_n |x_n|^2 = \\frac{1}{N} \\sum_k |X_k|^2$.",
        next: "**Note.** Use the same convention in code and in notes.",
      },
      backlinks: {
        definition: "Definition (Fourier transform)",
        source: "Sampling-theorem",
        outline: "Energy is the same in both domains",
      },
      annotate: {
        highlight: "Energy is the same in both domains",
        color: "the fast Fourier transform (FFT)",
        highlight2: "a quick check",
      },
      // An assistant proposes edits over MCP; they are reviewed in the note.
      proposal: {
        caption: "AI assistant (MCP): proposes three edits",
        summary: "Tighten the Parseval section",
        edits: [
          {
            old_text: "Energy is the same in both domains:",
            new_text: "Energy is the same in both domains, up to $2\\pi$:",
          },
          {
            old_text: "is a quick check that an FFT is normalized correctly.",
            new_text:
              "is a quick check that an FFT is normalized correctly: NumPy's `np.fft.fft` leaves the $1/N$ to you.",
          },
          {
            old_text: "Computing it directly takes",
            new_text: "Computing it straight from the definition takes",
          },
        ],
        labels: {
          accept: "Accept this",
          reject: "Reject this",
          source: "Source",
          rendered: "Rendered",
          changes: "Changes only",
          finish: "Finish review",
        },
      },
      // Edit mode: typed into the note as it reads.
      edit: {
        after: "normalized correctly.",
        text: " For a sequence, $\\sum_n |x_n|^2 = \\frac{1}{N}\\sum_k |X_k|^2$: **mind the** $1/N$.",
      },
      agent: {
        file: "Laplace-transform.md",
        title: "Laplace transform",
        steps: [
          {
            label: "AI agent: creates Laplace-transform.md",
            text: "# Laplace transform\n\nThe Laplace transform extends the [Fourier transform](Fourier-analysis.md) to complex frequencies $s = \\sigma + i\\omega$, which suits systems with initial conditions.\n",
          },
          {
            label: "AI agent: adds the definition",
            text: "\n## Definition\n\n$$\nF(s) = \\int_0^\\infty f(t)\\,e^{-st}\\,dt\n$$\n",
          },
          {
            label: "AI agent: adds common pairs",
            text: "\n## Common pairs\n\n| $f(t)$ | $F(s)$ |\n| --- | --- |\n| $1$ | $\\dfrac{1}{s}$ |\n| $e^{at}$ | $\\dfrac{1}{s-a}$ |\n| $\\sin \\omega t$ | $\\dfrac{\\omega}{s^2+\\omega^2}$ |\n",
          },
          {
            label: "AI agent: links related notes",
            text: "\n## Related\n\n- [Convolution theorem](Convolution-theorem.md#theorem): convolution in time is a product in $s$.\n- [Fourier analysis](Fourier-analysis.md#definition): set $s = i\\omega$ to get the Fourier transform back.\n",
          },
        ],
      },
    }
  : {
      notebook: "docs/sample-notebook",
      folder: "示例笔记库",
      note: "傅里叶分析.md",
      out: "docs/images",
      language: "zh",
      outline: ["窗函数", "离散实现", "Parseval 恒等式", "定义"],
      link: "卷积定理",
      find: "卷积",
      editHeading: "Parseval 恒等式",
      editParagraph: "能量在两个域中守恒",
      editText:
        "离散情形下同样有 $\\sum_n |x_n|^2 = \\frac{1}{N} \\sum_k |X_k|^2$。",
      darkHeading: "离散实现",
      direct: {
        block: "检查 FFT 的归一化",
        text: "离散情形下同样有 $\\sum_n |x_n|^2 = \\frac{1}{N} \\sum_k |X_k|^2$。",
        next: "**注意**：代码和笔记里要用同一种约定。",
      },
      backlinks: {
        definition: "定义（傅里叶变换）",
        source: "采样定理",
        outline: "能量在两个域中守恒",
      },
      annotate: {
        highlight: "能量在两个域中守恒",
        color: "快速傅里叶变换（FFT）",
        highlight2: "检查 FFT 的归一化",
      },
      proposal: {
        caption: "AI 助手（MCP）：提议三处修改",
        summary: "补充 Parseval 一节",
        edits: [
          {
            old_text: "能量在两个域中守恒：",
            new_text: "能量在两个域中守恒（差一个因子 $2\\pi$）：",
          },
          {
            old_text: "常被用来检查 FFT 的归一化是否正确。",
            new_text:
              "常被用来检查 FFT 的归一化是否正确：NumPy 的 `np.fft.fft` 不除以 $N$。",
          },
          {
            old_text: "直接计算需要",
            new_text: "按定义直接计算需要",
          },
        ],
        labels: {
          accept: "接受这处",
          reject: "拒绝这处",
          source: "源码",
          rendered: "渲染",
          changes: "仅改动",
          finish: "完成审阅",
        },
      },
      edit: {
        after: "归一化是否正确。",
        text: "对离散序列同样有 $\\sum_n |x_n|^2 = \\frac{1}{N}\\sum_k |X_k|^2$，**别忘了** $1/N$。",
      },
      agent: {
        file: "拉普拉斯变换.md",
        title: "拉普拉斯变换",
        steps: [
          {
            label: "AI 新建：拉普拉斯变换.md",
            text: "# 拉普拉斯变换\n\n拉普拉斯变换把[傅里叶变换](傅里叶分析.md)推广到复频率 $s = \\sigma + i\\omega$，适合分析带初始条件的系统。\n",
          },
          {
            label: "AI 补充：定义",
            text: "\n## 定义\n\n$$\nF(s) = \\int_0^\\infty f(t)\\,e^{-st}\\,dt\n$$\n",
          },
          {
            label: "AI 补充：常用变换对",
            text: "\n## 常用变换对\n\n| $f(t)$ | $F(s)$ |\n| --- | --- |\n| $1$ | $\\dfrac{1}{s}$ |\n| $e^{at}$ | $\\dfrac{1}{s-a}$ |\n| $\\sin \\omega t$ | $\\dfrac{\\omega}{s^2+\\omega^2}$ |\n",
          },
          {
            label: "AI 补充：链接相关笔记",
            text: "\n## 相关笔记\n\n- [卷积定理](卷积定理.md#定理)：时域卷积对应 $s$ 域乘积。\n- [傅里叶分析](傅里叶分析.md#定义)：令 $s = i\\omega$ 即回到傅里叶变换。\n",
          },
        ],
      },
    };
const out = path.join(root, L.out);
// Stills are resized to this; recordings keep the window's own size
// (1360 x 920, desktop/main.mjs), because Playwright's video viewport and the
// input coordinates drift apart (28 px) when a recorded window is resized.
const size = { width: 1280, height: 800 };
const recordSize = { width: 1360, height: 920 };
const only = new Set(args.filter((a) => !a.startsWith("--")));
await fs.mkdir(out, { recursive: true });

async function session({ scale, theme = "light", record = false, extra = {} }) {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-media-")),
  );
  const notes = path.join(temp, L.folder);
  await fs.cp(path.join(root, L.notebook), notes, {
    recursive: true,
  });
  const profile = path.join(temp, "profile");
  await fs.mkdir(profile);
  await fs.writeFile(
    path.join(profile, "session.json"),
    JSON.stringify({
      roots: [notes],
      settings: {
        theme,
        sidebar: true,
        outline: true,
        language: L.language,
        // Settings → Annotation: the format bar also works in Read mode.
        readingFormat: true,
        ...extra,
        // A scene with an assistant opens the sample library to AI.
        ...(extra.aiLibraries && { aiLibraries: [notes] }),
      },
    }),
  );
  const app = await electron.launch({
    args: [
      `--force-device-scale-factor=${scale}`,
      // Keep painting while other windows cover it (it is shown inactive).
      "--disable-features=CalculateNativeWinOcclusion",
      root,
      path.join(notes, L.note),
    ],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      // Shown without taking the foreground from whoever uses the computer.
      FOLIO_TEST_INACTIVE: "1",
      ELECTRON_RUN_AS_NODE: undefined,
    },
    ...(record && {
      recordVideo: { dir: path.join(temp, "video"), size: recordSize },
    }),
  });
  const page = await app.firstWindow();
  const started = Date.now();
  if (!record)
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(width, height);
      win.center();
    }, size);
  await page.locator("#content h1").waitFor();
  await page.locator("#content .katex").first().waitFor();
  // Let every formula render first: layout that settles mid-scene moves links
  // (an open link preview closes when its link moves).
  await page.waitForFunction(
    () => !document.querySelector("#content [data-folio-math]"),
    null,
    { timeout: 30000 },
  );
  await page.locator("#tree").getByText(L.note).waitFor();
  // Recordings have no system cursor: draw one, plus a key hint. The link
  // preview's file path is hidden (it would show the temporary folder).
  await page.addStyleTag({
    content: `#demo-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;transform:translate(-100px,-100px);transition:transform 0s}
#demo-cursor::after{content:"";position:absolute;left:-10px;top:-10px;width:20px;height:20px;border-radius:50%;background:#285e5055;transform:scale(0);transition:transform .18s}
#demo-cursor.down::after{transform:scale(1)}
#demo-keys{position:fixed;left:50%;bottom:28px;z-index:2147483647;transform:translateX(-50%);padding:7px 14px;border-radius:8px;background:#1b211ee6;color:#f5f1e5;font:600 15px/1.2 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;opacity:0;transition:opacity .15s}
#demo-keys.shown{opacity:1}
.preview-path{display:none}`,
  });
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1.5v16l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5h6z" fill="#fff" stroke="#1b211e" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const keys = document.createElement("div");
    keys.id = "demo-keys";
    document.body.append(cursor, keys);
    document.addEventListener(
      "mousemove",
      (e) =>
        (cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`),
      true,
    );
    document.addEventListener(
      "mousedown",
      () => cursor.classList.add("down"),
      true,
    );
    document.addEventListener(
      "mouseup",
      () => cursor.classList.remove("down"),
      true,
    );
  });
  const keys = async (label, press) => {
    await page.evaluate((label) => {
      const hint = document.querySelector("#demo-keys");
      hint.textContent = label;
      hint.classList.add("shown");
    }, label);
    for (const key of [press].flat()) await page.keyboard.press(key);
    await page.waitForTimeout(700);
    await page.evaluate(() =>
      document.querySelector("#demo-keys").classList.remove("shown"),
    );
  };
  const caption = (label) =>
    page.evaluate((label) => {
      const hint = document.querySelector("#demo-keys");
      hint.textContent = label;
      hint.classList.toggle("shown", Boolean(label));
    }, label);
  const moveTo = async (locator, dx = 0.5, dy = 0.5) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, {
      steps: 24,
    });
  };
  return { app, page, temp, notes, profile, started, keys, caption, moveTo };
}

// Record one scene and convert it to a looping GIF (palette per clip).
async function scene(name, theme, play, extra = {}) {
  if (only.size && !only.has(name)) return;
  const s = await session({ scale: 1, theme, record: true, extra });
  await s.page.waitForTimeout(600);
  // A scene may call mark() after its setup to start the clip there.
  let from = (Date.now() - s.started) / 1000;
  await play({
    ...s,
    mark: async () => {
      await s.page.waitForTimeout(400);
      from = (Date.now() - s.started) / 1000;
    },
  });
  await s.page.waitForTimeout(500);
  const to = (Date.now() - s.started) / 1000;
  const video = await s.page.video().path();
  // Scenes may leave the temporary copy edited: skip the unsaved-changes prompt.
  await s.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].destroy(),
  );
  await s.app.close();
  const gif = path.join(out, name + ".gif");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    from.toFixed(2),
    "-to",
    to.toFixed(2),
    "-i",
    video,
    "-vf",
    "fps=10,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    "-loop",
    "0",
    gif,
  ]);
  const { size: bytes } = await fs.stat(gif);
  console.log(`${name}.gif ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  await fs.rm(s.temp, { recursive: true, force: true });
}

async function still(name, theme, arrange, extra = {}) {
  if (only.size && !only.has(name)) return;
  const s = await session({ scale: 2, theme, extra });
  await arrange(s);
  await s.page.evaluate(() => document.querySelector("#demo-cursor").remove());
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: path.join(out, name + ".png") });
  console.log(name + ".png");
  await s.app.close();
  await fs.rm(s.temp, { recursive: true, force: true });
}

// Marklore's MCP server as an assistant runs it (the setup the app shows in
// Settings → AI assistant), speaking JSON-RPC over stdio.
async function assistant(page, profile) {
  // The app opens the ticked library to AI once it has started.
  const access = path.join(profile, "ai", "access.json");
  for (let i = 0; i < 100; i++) {
    if (
      await fs.stat(access).then(
        () => true,
        () => false,
      )
    )
      break;
    await page.waitForTimeout(100);
  }
  const setup = await page.evaluate(() => window.folio.aiSetup());
  const child = spawn(setup.command, setup.args, {
    env: { ...process.env, ...setup.env, FOLIO_DATA_DIR: profile },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map();
  let next = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, resolve);
      setTimeout(() => reject(Error(`No answer to ${method}`)), 15000);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "claude-code", version: "1" },
  });
  return {
    async call(name, args) {
      const { result } = await request("tools/call", {
        name,
        arguments: args,
      });
      if (result.isError) throw Error(result.content[0].text);
      return JSON.parse(result.content[0].text);
    },
    close: () => child.stdin.end(),
  };
}
// Click the way a person would: move there, press, release.
async function press(page, moveTo, locator, wait = 900) {
  await moveTo(locator);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(wait);
}

await still("overview", "light", async ({ page }) => {
  await page.locator("#content .diagram svg").first().waitFor();
});

// Who links here: the count beside a definition, and the card listing the
// notes that cite it, each with its sentence.
await still(
  "backlinks",
  "light",
  async ({ page, moveTo }) => {
    const badge = page
      .locator("#content p", { hasText: L.backlinks.definition })
      .locator(".backlink-badge");
    await badge.waitFor({ timeout: 15000 });
    await badge.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await moveTo(badge);
    await page.locator("#backlinks-card").waitFor();
    await page.waitForTimeout(600);
  },
  { outlineAnchors: "all" },
);

// Edit mode in the dark theme: the note as it reads, the toolbar above it.
await still("edit-dark", "dark", async ({ page }) => {
  await page.keyboard.press("Control+2");
  await page.locator("#rich .ProseMirror").waitFor();
  await page
    .locator("#outline")
    .getByRole("button", { name: L.darkHeading, exact: true })
    .click();
  await page.waitForTimeout(900);
});

// An AI agent writes a note into the library (simulated: the scene writes the
// file in steps, as an agent's edits would land on disk). The tree shows the
// new file; once opened, each step re-renders.
await scene(
  "agent",
  "light",
  async ({ page, notes, caption, moveTo, mark }) => {
    const file = path.join(notes, L.agent.file);
    let text = "";
    const write = async ({ label, text: chunk }, wait) => {
      await caption(label);
      text += chunk;
      await fs.writeFile(file, text);
      await page.waitForTimeout(wait);
    };
    await mark();
    const [first, ...rest] = L.agent.steps;
    await write(first, 400);
    const entry = page
      .locator("#tree")
      .getByText(L.agent.file, { exact: true });
    await entry.waitFor();
    await page.waitForTimeout(900);
    await press(page, moveTo, entry, 0);
    await page.locator("#content h1", { hasText: L.agent.title }).waitFor();
    await page.waitForTimeout(1200);
    for (const step of rest) await write(step, 1900);
    await caption("");
    await page.waitForTimeout(600);
  },
);

// The assistant proposes instead of writing (MCP): the edits show in the note
// in review colors. The first is accepted; the second is looked at as source,
// changes only, and rejected; the last is accepted in the rendered changes,
// and finishing the review writes the accepted ones.
await scene(
  "proposal",
  "light",
  async ({ page, notes, profile, caption, moveTo, mark }) => {
    const P = L.proposal;
    const ai = await assistant(page, profile);
    try {
      await page
        .locator("#outline")
        .getByRole("button", { name: L.editHeading, exact: true })
        .click();
      await page.waitForTimeout(1200);
      await mark();
      await caption(P.caption);
      await ai.call("propose_edit", {
        note: `${L.folder}/${L.note}`,
        summary: P.summary,
        edits: P.edits,
      });
      const button = page.locator("#proposals-button");
      await button.waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(900);
      await press(page, moveTo, button, 500);
      await press(
        page,
        moveTo,
        page.getByRole("menuitem", { name: new RegExp(L.note) }),
        0,
      );
      await caption("");
      const bar = page.locator("#proposal-bar");
      await page.locator("#content .proposal-added").first().waitFor();
      await page.waitForTimeout(1800);
      const control = (name) => bar.getByRole("button", { name, exact: true });
      await press(page, moveTo, control(P.labels.accept), 1400);
      await press(page, moveTo, control(P.labels.source), 1400);
      await press(page, moveTo, control(P.labels.changes), 1800);
      await press(page, moveTo, control(P.labels.reject), 1400);
      await press(page, moveTo, control(P.labels.rendered), 1800);
      await press(page, moveTo, control(P.labels.accept), 1400);
      await press(page, moveTo, control(P.labels.finish), 1800);
      await bar.waitFor({ state: "hidden" });
      await page.waitForTimeout(800);
    } finally {
      ai.close();
    }
  },
  { aiLibraries: "__notes__" },
);

// Edit mode: type into the note as it reads. A formula typed as `$…$`
// typesets once closed, `**…**` turns bold; Source mode then shows the
// plain Markdown that was written.
await scene("edit", "light", async ({ page, keys, mark }) => {
  await page
    .locator("#outline")
    .getByRole("button", { name: L.editHeading, exact: true })
    .click();
  await page.waitForTimeout(900);
  await keys("Ctrl + 2", "Control+2");
  await page.locator("#rich .ProseMirror").waitFor();
  await page.waitForTimeout(900);
  await mark();
  // Click just after the sentence, as a writer would.
  const end = await page.evaluate((text) => {
    const root = document.querySelector("#rich .ProseMirror");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const at = node.data.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + text.length - 1);
      range.setEnd(node, at + text.length);
      const rect = [...range.getClientRects()].at(-1);
      return { x: rect.right - 1, y: rect.top + rect.height / 2 };
    }
    throw Error("Text not found: " + text);
  }, L.edit.after);
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press("End");
  // Out of the way of the text being typed.
  await page.mouse.move(end.x + 140, end.y + 160, { steps: 12 });
  await page.waitForTimeout(400);
  await page.keyboard.type(L.edit.text, { delay: 65 });
  await page.waitForTimeout(1800);
  await keys("Ctrl + 3", "Control+3");
  await page.waitForTimeout(2400);
});

// Mark up the page like a notebook, in Read mode: select text and highlight
// or color it; Source mode then shows what was written into the Markdown.
await scene("annotate", "light", async ({ page, keys, moveTo, mark }) => {
  await page
    .locator("#outline")
    .getByRole("button", { name: L.editHeading, exact: true })
    .click();
  await page.waitForTimeout(1200);
  // Drag across a phrase of the page, as a reader would.
  const select = async (phrase) => {
    const box = await page.evaluate((phrase) => {
      const walker = document.createTreeWalker(
        document.querySelector("#content"),
        NodeFilter.SHOW_TEXT,
      );
      for (let node; (node = walker.nextNode());) {
        const at = node.nodeValue.indexOf(phrase);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + phrase.length);
        const rects = range.getClientRects();
        const first = rects[0],
          last = rects[rects.length - 1];
        return {
          x1: first.left + 1,
          y1: first.top + first.height / 2,
          x2: last.right - 1,
          y2: last.top + last.height / 2,
        };
      }
      return null;
    }, phrase);
    if (!box) throw Error("Phrase not found: " + phrase);
    await page.mouse.move(box.x1, box.y1, { steps: 18 });
    await page.mouse.down();
    await page.mouse.move(box.x2, box.y2, { steps: 22 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  };
  const apply = async (action) => {
    const button = page.locator(`[data-selection-action="${action}"]`);
    await button.waitFor();
    await press(page, moveTo, button, 1100);
  };
  await mark();
  await select(L.annotate.highlight);
  await apply("highlight");
  await select(L.annotate.color);
  await apply("color");
  await select(L.annotate.highlight2);
  await apply("highlight");
  // Put the format bar away, then show the source.
  await page.keyboard.press("Escape");
  await page.mouse.move(40, 560, { steps: 12 });
  await page.waitForTimeout(900);
  await keys("Ctrl + 3", "Control+3");
  await page.waitForTimeout(2200);
});
