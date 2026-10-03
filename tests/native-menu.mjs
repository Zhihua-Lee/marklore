import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-native-menu-"));
const note = path.join(temp, "menu.md");
await fs.writeFile(
  note,
  "# Typography and menu\n\nEnglish reading: A good notebook keeps the details clear.\n\n中文阅读：笔画粗细与英文字母协调，公式保留数学语义。\n\nMixed 中英文字体 alongside $e^{i\\pi}+1=0$ and $\\sum_{i=1}^{n} x_i^2$.\n\n## Regular and strong\n\nRegular 正文 and **strong 粗体**, with *italic emphasis*.\n",
);
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [note] : [project, note],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await instance.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].hide();
  });
  await page.locator("#content h1").waitFor();
  const resizeEvidence = await instance.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const minimum = win.getMinimumSize();
    const widths = [680, 640, 512, 480].map((width) => {
      win.setSize(width, 600);
      return win.getSize()[0];
    });
    win.setSize(1360, 920);
    return { minimum, widths };
  });
  assert.deepEqual(resizeEvidence.minimum, [480, 360]);
  // Windows non-client borders / DPI rounding (the resize frame kept without a
  // system title bar) can add up to three logical pixels at 350% scaling.
  resizeEvidence.widths.forEach((actual, i) => {
    assert.ok(Math.abs(actual - [680, 640, 512, 480][i]) <= 3);
  });
  console.log("Native compact-window sizes:", JSON.stringify(resizeEvidence));
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const actualFonts = async (selector) => {
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    assert.ok(nodeId, `Font sample must exist: ${selector}`);
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    assert.ok(fonts.length, `Actual glyph fonts must resolve: ${selector}`);
    return fonts;
  };
  const fontEvidence = {};
  for (const typeface of ["literata", "balanced", "classic", "book"]) {
    await page.evaluate((value) => {
      const selector = document.querySelector("#typeface");
      selector.value = value;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }, typeface);
    await page.evaluate(() => document.fonts.ready);
    fontEvidence[typeface] = {
      latin: await actualFonts("#content p:nth-of-type(1)"),
      cjk: await actualFonts("#content p:nth-of-type(2)"),
      math: [
        ...(await actualFonts("#content .katex-html .mathnormal")),
        ...(await actualFonts("#content .katex-html .mbin")),
      ],
    };
    assert.ok(
      fontEvidence[typeface].math.some((font) => /KaTeX/.test(font.familyName)),
      "Formula glyphs must use the loaded mathematical font, not body fallback",
    );
    if (typeface === "literata")
      assert.ok(
        fontEvidence[typeface].latin.some((font) =>
          /Literata/.test(font.familyName),
        ),
        "Literata must load from the bundled font",
      );
  }
  await page.evaluate(() => {
    const selector = document.querySelector("#typeface");
    selector.value = "literata";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const artifacts = path.join(project, ".local");
  await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: path.join(artifacts, "native-appearance.png"),
  });
  await fs.writeFile(
    path.join(artifacts, "native-font-evidence.json"),
    JSON.stringify(fontEvidence, null, 2),
  );
  console.log("Actual native glyph fonts:", JSON.stringify(fontEvidence));
  await cdp.detach();
  const menuState = () =>
    instance.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        visible: window.isMenuBarVisible(),
        autoHide: window.isMenuBarAutoHide(),
        items: Menu.getApplicationMenu().items.flatMap((item) =>
          item.submenu.items.map(({ accelerator, role, label }) => ({
            accelerator,
            role,
            label,
          })),
        ),
      };
    });
  const before = await menuState();
  assert.equal(before.visible, false, "Native menu strip must stay hidden");
  assert.equal(before.autoHide, false, "Alt must not reveal an auto-hide menu");
  for (const shortcut of [
    "CmdOrCtrl+O",
    "CmdOrCtrl+Shift+O",
    "CmdOrCtrl+N",
    "CmdOrCtrl+S",
    "CmdOrCtrl+Shift+S",
    "CmdOrCtrl+R",
    "CmdOrCtrl+1",
    "CmdOrCtrl+2",
    "CmdOrCtrl+3",
  ]) {
    assert.ok(
      before.items.some((item) => item.accelerator === shortcut),
      `${shortcut} must remain registered`,
    );
  }
  for (const role of [
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "selectall",
    "togglefullscreen",
    "quit",
  ]) {
    assert.ok(
      before.items.some((item) => item.role === role),
      `${role} retained`,
    );
  }
  await page.keyboard.press("Alt");
  assert.equal(
    (await menuState()).visible,
    false,
    "Alt must not expose the menu",
  );
  const initialTabs = await page.getByRole("tab").count();
  await page.keyboard.press("Control+n");
  await page.waitForFunction(
    (count) => document.querySelectorAll('[role="tab"]').length === count,
    initialTabs + 1,
  );
  // A duplicated native + renderer handler would create a second note.
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("tab").count(), initialTabs + 1);
  assert.equal((await menuState()).visible, false);
  // No system title bar: the page's own window controls, and Ctrl+wheel zoom
  // routed through Electron (the page has no blocking wheel listener).
  const controls = page.locator(".window-controls");
  await controls.waitFor();
  assert.deepEqual(
    await controls
      .locator("button")
      .evaluateAll((buttons) => buttons.map((b) => b.dataset.window)),
    ["fullScreen", "minimize", "maximize", "close"],
  );
  const zoomLabel = () => page.locator("#zoom-reset").textContent();
  const zoomBefore = await zoomLabel();
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.emit("zoom-changed", {}, "in"),
  );
  await page.waitForFunction(
    (before) => document.querySelector("#zoom-reset").textContent !== before,
    zoomBefore,
  );
  assert.equal(
    parseInt(await zoomLabel()),
    parseInt(zoomBefore) + 10,
    "Ctrl+wheel zooms the note one step",
  );
  // Without a system title bar Windows decides per point whether a press drags
  // the window (WM_NCHITTEST: 1 client, 2 caption). Page-level test input
  // bypasses this, which let tabs be taken as the title bar in v0.1.33-36.
  const hit = await instance.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.showInactive();
    return {
      hwnd: win.getNativeWindowHandle().readBigUInt64LE(0).toString(),
      content: win.getContentBounds(),
      scale: screen.getDisplayMatching(win.getContentBounds()).scaleFactor,
    };
  });
  await page.waitForTimeout(300);
  const probes = await page.evaluate(() => {
    const centre = (el, fx = 0.5) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * fx, y: r.top + r.height / 2 };
    };
    return {
      tab: centre(document.querySelector("#tabs [role='tab']"), 0.3),
      close: centre(document.querySelector("#tabs button[aria-label^='关闭']")),
      button: centre(document.querySelector("#new")),
      drag: centre(document.querySelector(".topbar .drag-space")),
    };
  });
  const nc = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      [
        'Add-Type @"',
        "using System; using System.Runtime.InteropServices;",
        'public class NC { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }',
        '"@',
        "[NC]::SetProcessDPIAware() | Out-Null",
        `$h = [IntPtr]::new([Int64]${hit.hwnd})`,
        ...Object.entries(probes).map(([name, p]) => {
          const x = Math.round((hit.content.x + p.x) * hit.scale),
            y = Math.round((hit.content.y + p.y) * hit.scale);
          return `"${name}=" + [NC]::SendMessage($h, 0x84, [IntPtr]::Zero, [IntPtr]::new(([Int64]${y} -shl 16) -bor ${x}))`;
        }),
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );
  const nchit = Object.fromEntries(
    nc
      .trim()
      .split(/\s+/)
      .map((line) => line.split("=")),
  );
  assert.deepEqual(
    nchit,
    { tab: "1", close: "1", button: "1", drag: "2" },
    "Tabs and buttons take clicks; only the empty space drags the window",
  );
  console.log(
    "Native menu passed: hidden after Alt; accelerators and edit roles retained; Ctrl+N executes once; own window controls; Ctrl+wheel zoom via Electron; tabs are client area (WM_NCHITTEST).",
  );
} finally {
  if (instance) {
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await instance.close().catch(() => {});
  }
  // This uniquely-created fixture never contains user notes or their profile.
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
