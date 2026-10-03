// Regenerates the README screenshots and animations from the real desktop app
// and a sample notebook (copied to a temporary folder; the repository notes are
// never modified). Needs a build (pnpm build) and ffmpeg on PATH. Usage:
//   node tools/readme-media.mjs [--lang=en] [scene ...]
// Chinese (default): docs/sample-notebook -> docs/images; English:
// docs/sample-notebook-en -> docs/images/en, with the interface in English.
import { _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
      annotate: {
        highlight: "Energy is the same in both domains",
        color: "the fast Fourier transform (FFT)",
        highlight2: "a quick check",
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
      annotate: {
        highlight: "能量在两个域中守恒",
        color: "快速傅里叶变换（FFT）",
        highlight2: "检查 FFT 的归一化",
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

async function session({ scale, theme = "light", record = false }) {
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
  return { app, page, temp, notes, started, keys, caption, moveTo };
}

// Record one scene and convert it to a looping GIF (palette per clip).
async function scene(name, theme, play) {
  if (only.size && !only.has(name)) return;
  const s = await session({ scale: 1, theme, record: true });
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

async function still(name, theme, arrange) {
  if (only.size && !only.has(name)) return;
  const s = await session({ scale: 2, theme });
  await arrange(s);
  await s.page.evaluate(() => document.querySelector("#demo-cursor").remove());
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: path.join(out, name + ".png") });
  console.log(name + ".png");
  await s.app.close();
  await fs.rm(s.temp, { recursive: true, force: true });
}

await still("overview", "light", async ({ page }) => {
  await page.locator("#content .diagram svg").first().waitFor();
});
await still("edit-dark", "dark", async ({ page }) => {
  await page.locator("#sidebar-toggle").click();
  await page.locator('.modes [data-mode="edit"]').click();
  await page
    .locator("#outline")
    .getByRole("button", { name: L.darkHeading, exact: true })
    .click();
  await page.waitForTimeout(900);
});

await scene("outline", "light", async ({ page, moveTo }) => {
  const outline = (name) =>
    page.locator("#outline").getByRole("button", { name, exact: true });
  for (const name of L.outline) {
    await moveTo(outline(name));
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1300);
  }
});

await scene("preview", "light", async ({ page, keys, mark }) => {
  const link = page.locator("#content a", { hasText: L.link }).first();
  await link.scrollIntoViewIfNeeded();
  // Measure only once the page is still: the smooth scroll has ended and idle
  // table layout (which keeps the reading line, so content below it may move)
  // has settled.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const reader = document.querySelector("#reader"),
          content = document.querySelector("#content"),
          top = reader.scrollTop,
          height = content.offsetHeight;
        setTimeout(
          () =>
            resolve(
              reader.scrollTop === top && content.offsetHeight === height,
            ),
          1200,
        );
      }),
    null,
    { timeout: 20000 },
  );
  // Idle table layout runs within its 3 s idle-callback timeout; recording
  // keeps the page busy enough that it tends to wait that long.
  await page.waitForTimeout(3500);
  // Aim at the link's first line: a link that wraps has a bounding box whose
  // centre lies between the lines, off the link.
  const onLink = async () => {
    const r = await link.evaluate((el) => el.getClientRects()[0].toJSON());
    await page.mouse.move(r.x + Math.min(40, r.width / 2), r.y + r.height / 2, {
      steps: 24,
    });
  };
  await mark();
  // Late layout (idle table sizing) can shift the link from under the
  // pointer; aim again until the preview opens.
  for (let tries = 0; ; tries++) {
    await onLink();
    const shown = await page
      .locator("#link-preview")
      .waitFor({ state: "visible", timeout: 1500 })
      .then(
        () => true,
        () => false,
      );
    if (shown) break;
    if (tries === 3) throw Error("The link preview did not open");
  }
  await page.waitForTimeout(1600);
  await onLink();
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1400);
  await keys("Alt + ←", "Alt+ArrowLeft");
  await page.waitForTimeout(1000);
});

await scene("find", "light", async ({ page, keys }) => {
  await keys("Ctrl + F", "Control+f");
  await page.keyboard.type(L.find, { delay: 180 });
  await page.waitForTimeout(700);
  for (let i = 0; i < 3; i++) await keys("Enter", "Enter");
  await keys("Esc", "Escape");
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
    await moveTo(entry);
    await page.mouse.down();
    await page.mouse.up();
    await page.locator("#content h1", { hasText: L.agent.title }).waitFor();
    await page.waitForTimeout(1200);
    for (const step of rest) await write(step, 1900);
    await caption("");
    await page.waitForTimeout(600);
  },
);

// Mark up the page like a notebook, in Read mode: select text and highlight
// or color it; Edit mode then shows what was written into the Markdown.
await scene("annotate", "light", async ({ page, keys, moveTo, mark }) => {
  await page
    .locator("#outline")
    .getByRole("button", { name: L.editHeading, exact: true })
    .click();
  await page.waitForTimeout(1200);
  // Drag across a phrase of the preview, as a reader would.
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
    await moveTo(button);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1100);
  };
  await mark();
  await select(L.annotate.highlight);
  await apply("highlight");
  await select(L.annotate.color);
  await apply("color");
  await select(L.annotate.highlight2);
  await apply("highlight");
  // Put the format bar away, then show the source beside the page.
  await page.keyboard.press("Escape");
  await page.mouse.move(40, 560, { steps: 12 });
  await page.waitForTimeout(900);
  await keys("Ctrl + 2", "Control+2");
  await page.waitForTimeout(1800);
});

await scene("edit", "light", async ({ page, mark }) => {
  await page.keyboard.press("Control+2");
  await page
    .locator("#outline")
    .getByRole("button", { name: L.editHeading, exact: true })
    .click();
  await page.waitForTimeout(900);
  // Alt+double-click in the preview puts the editor cursor on that text.
  await page
    .locator("#content p", { hasText: L.editParagraph })
    .dblclick({ modifiers: ["Alt"] });
  await page.keyboard.press("End");
  await mark();
  await page.keyboard.type(L.editText, { delay: 55 });
  await page.waitForTimeout(1800);
});
