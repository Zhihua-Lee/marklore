// Regenerates the README screenshots and animations in docs/images from the
// real desktop app and docs/sample-notebook (copied to a temporary folder; the
// repository notes are never modified). Needs a build (pnpm build) and ffmpeg
// on PATH. Usage: node tools/readme-media.mjs [scene ...]
import { _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs/images");
const size = { width: 1280, height: 800 };
const only = new Set(process.argv.slice(2));
await fs.mkdir(out, { recursive: true });

async function session({ scale, theme = "light", record = false }) {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-media-")),
  );
  const notes = path.join(temp, "示例笔记库");
  await fs.cp(path.join(root, "docs/sample-notebook"), notes, {
    recursive: true,
  });
  const profile = path.join(temp, "profile");
  await fs.mkdir(profile);
  await fs.writeFile(
    path.join(profile, "session.json"),
    JSON.stringify({
      roots: [notes],
      settings: { theme, sidebar: true, outline: true },
    }),
  );
  const app = await electron.launch({
    args: [
      `--force-device-scale-factor=${scale}`,
      root,
      path.join(notes, "傅里叶分析.md"),
    ],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    ...(record && { recordVideo: { dir: path.join(temp, "video"), size } }),
  });
  const page = await app.firstWindow();
  const started = Date.now();
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(width, height);
    win.center();
  }, size);
  await page.locator("#content h1").waitFor();
  await page.locator("#content .katex").first().waitFor();
  await page.locator("#tree").getByText("傅里叶分析.md").waitFor();
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
  const moveTo = async (locator, dx = 0.5, dy = 0.5) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, {
      steps: 24,
    });
  };
  return { app, page, temp, started, keys, moveTo };
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
    .getByRole("button", { name: "离散实现", exact: true })
    .click();
  await page.waitForTimeout(900);
});

await scene("outline", "light", async ({ page, moveTo }) => {
  const outline = (name) =>
    page.locator("#outline").getByRole("button", { name, exact: true });
  for (const name of ["窗函数", "离散实现", "Parseval 恒等式", "定义"]) {
    await moveTo(outline(name));
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1300);
  }
});

await scene("preview", "light", async ({ page, moveTo, keys }) => {
  const link = page.locator("#content a", { hasText: "卷积定理" }).first();
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await moveTo(link);
  await page.locator("#link-preview").waitFor({ state: "visible" });
  await page.waitForTimeout(1600);
  await moveTo(link);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1400);
  await keys("Alt + ←", "Alt+ArrowLeft");
  await page.waitForTimeout(1000);
});

await scene("find", "light", async ({ page, keys }) => {
  await keys("Ctrl + F", "Control+f");
  await page.keyboard.type("卷积", { delay: 180 });
  await page.waitForTimeout(700);
  for (let i = 0; i < 3; i++) await keys("Enter", "Enter");
  await keys("Esc", "Escape");
});

await scene("edit", "light", async ({ page, mark }) => {
  await page.keyboard.press("Control+2");
  await page
    .locator("#outline")
    .getByRole("button", { name: "Parseval 恒等式", exact: true })
    .click();
  await page.waitForTimeout(900);
  // Alt+double-click in the preview puts the editor cursor on that text.
  await page
    .locator("#content p", { hasText: "能量在两个域中守恒" })
    .dblclick({ modifiers: ["Alt"] });
  await page.keyboard.press("End");
  await mark();
  await page.keyboard.type(
    "离散情形下同样有 $\\sum_n |x_n|^2 = \\frac{1}{N} \\sum_k |X_k|^2$。",
    { delay: 55 },
  );
  await page.waitForTimeout(1800);
});
