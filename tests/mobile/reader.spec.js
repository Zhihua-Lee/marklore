import { test, expect } from "@playwright/test";

test.describe("Mobile reader UI", () => {
  test("home shows the folder's table of contents like the desktop, and sync status", async ({
    page,
  }) => {
    await page.goto("./?mock");
    await expect(page.locator("#app")).toContainText("Marklore");
    await expect(page.locator(".mobile-status-footer")).toContainText(
      "数学笔记",
    );
    await expect(page.locator(".mobile-status-footer")).toContainText(
      "7 篇笔记",
    );
    await expect(page.locator(".mobile-status-footer")).toContainText(
      "1 小时前同步",
    );

    // The root _目录.md in its order: the chapter folder first (open, as a
    // first-level section), its pages under it, then the other pages.
    const index = page.locator(".mobile-home-index");
    const titles = await index
      .locator(".ix-list > .ix-item > .ix-row > .ix-title")
      .allTextContents();
    expect(titles).toEqual([
      "第一章 实数",
      "一致收敛",
      "长笔记：实分析习题",
      "English notes",
    ]);
    const chapter = index.locator('.ix-item[data-kind="folder"]').first();
    await expect(chapter).toHaveAttribute("aria-expanded", "true");
    const page1 = chapter.locator(
      'a.ix-title[data-note-path="第一章 实数/确界原理.md"]',
    );
    await expect(page1).toBeVisible();
    // Each page shows its first sentence, as on the desktop.
    await expect(
      index.locator('.ix-row:has(a[data-note-path="一致收敛.md"]) .ix-excerpt'),
    ).toContainText("函数列");
    await expect(page.locator(".mobile-tree")).toHaveCount(0);

    // Folding: closed shows the page count; it stays closed after a reload.
    await chapter.locator("> .ix-row > .ix-twisty").click();
    await expect(chapter).toHaveAttribute("aria-expanded", "false");
    await expect(page1).toBeHidden();
    await expect(chapter.locator("> .ix-row > .ix-count")).toHaveText("2 页");
    await page.reload();
    await expect(
      page.locator('.mobile-home-index .ix-item[data-kind="folder"]').first(),
    ).toHaveAttribute("aria-expanded", "false");
    // Tapping a folder's name opens it too.
    await page
      .locator('.mobile-home-index .ix-title[data-folder-path="第一章 实数"]')
      .click();
    await expect(
      page.locator(
        '.mobile-home-index a.ix-title[data-note-path="第一章 实数/确界原理.md"]',
      ),
    ).toBeVisible();

    // Sync button works cleanly and updates status to 刚刚同步
    await page.locator(".mobile-sync-btn").click();
    await expect(page.locator(".mobile-status-footer")).toContainText(
      "刚刚同步",
      {
        timeout: 5000,
      },
    );
  });

  test("renders math, code, tables, front matter, and relative assets with zero horizontal overflow", async ({
    page,
  }) => {
    await page.goto("./?mock");
    await page
      .locator('.mobile-home-index a.ix-title[data-note-path="一致收敛.md"]')
      .click();
    await expect(page.locator(".mobile-topbar-title")).toHaveText("一致收敛");
    await expect(page.locator(".prose .katex").first()).toBeVisible();
    await expect(page.locator(".prose .math-block").first()).toBeVisible();
    await expect(page.locator(".prose .table-scroll").first()).toBeVisible();
    await expect(page.locator(".prose .code-block").first()).toBeVisible();
    await expect(page.locator("details.front-matter")).toBeVisible();

    // Relative image loaded via library.asset
    const imgOk = await page
      .locator(".prose img")
      .first()
      .evaluate((img) => {
        return (
          img.complete && img.naturalWidth > 0 && img.src.startsWith("blob:")
        );
      });
    expect(imgOk).toBe(true);

    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 812 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }

    // Also verify zero horizontal overflow on Home at 375px and 390px
    await page.locator(".mobile-topbar-btn", { hasText: "主页" }).click();
    await expect(page.locator(".mobile-search-input")).toBeVisible();
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 812 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test("handles encoded/<...> links, anchor jumps, external rel, outline, history back + scroll restore", async ({
    page,
  }) => {
    await page.goto("./?mock");
    // An index entry written as <…> with spaces opens its page.
    await page
      .locator(
        '.mobile-home-index a.ix-title[data-note-path="第一章 实数/实数的完备性.md"]',
      )
      .click();
    await expect(page.locator(".mobile-topbar-title")).toHaveText(
      "实数的完备性",
    );
    await expect(page).toHaveURL(/#\/note\//);

    // Same-folder relative link with #anchor -> 确界原理#上确界
    await page.locator('.prose a:has-text("确界原理")').click();
    await expect(page.locator(".mobile-topbar-title")).toHaveText("确界原理");

    // Cross-folder ../ link with heading anchor -> 一致收敛#weierstrass-判别法
    await page.locator('.prose a:has-text("一致收敛")').click();
    await expect(page.locator(".mobile-topbar-title")).toHaveText("一致收敛");
    await page.waitForTimeout(100);
    const weierY = await page.evaluate(() => {
      const el = document.getElementById("weierstrass-判别法");
      return el ? Math.abs(el.getBoundingClientRect().top) : 9999;
    });
    expect(weierY).toBeLessThan(120);

    // Navigate back to Home, open long note
    await page.locator(".mobile-topbar-btn", { hasText: "主页" }).click();
    await page
      .locator('.mobile-home-index a.ix-title[data-note-path="长笔记.md"]')
      .click();
    await expect(page.locator(".mobile-topbar-title")).toContainText("长笔记");

    // Outline sheet opens, jumps to a deep section, and closes
    await page.locator(".mobile-topbar-btn", { hasText: "大纲" }).click();
    await expect(
      page.locator('[role="dialog"][aria-label="大纲"]'),
    ).toBeVisible();
    await page.locator(".mobile-outline-item", { hasText: "第 20 题" }).click();
    await expect(
      page.locator('[role="dialog"][aria-label="大纲"]'),
    ).toBeHidden();
    await page.waitForTimeout(100);
    const sec20Scroll = await page.evaluate(() => window.scrollY);
    expect(sec20Scroll).toBeGreaterThan(200);

    // Top bar hides when scrolling down and reappears when scrolling up
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(80);
    await page.evaluate(() => window.scrollTo(0, 1400));
    await page.waitForTimeout(220);
    await expect(page.locator(".mobile-topbar")).toHaveClass(/is-hidden/);
    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForTimeout(240);
    await expect(page.locator(".mobile-topbar")).not.toHaveClass(/is-hidden/);
    const scrollBeforeHome = await page.evaluate(() => window.scrollY);
    expect(scrollBeforeHome).toBeGreaterThan(600);

    // Navigate forward to Home and browser back restores prior scroll
    await page.locator(".mobile-topbar-btn", { hasText: "主页" }).click();
    await expect(page.locator(".mobile-search-input")).toBeVisible();
    await page.goBack();
    await expect(page.locator(".mobile-topbar-title")).toContainText("长笔记");
    await page.waitForTimeout(150);
    const restoredScroll = await page.evaluate(() => window.scrollY);
    expect(Math.abs(restoredScroll - scrollBeforeHome)).toBeLessThan(80);
    expect(restoredScroll).toBeGreaterThan(400);

    // Browser back again returns to Home
    await page.goBack();
    await expect(page.locator(".mobile-search-input")).toBeVisible();
  });

  test("reopens last-read note with restored scroll on launch and updates recent list", async ({
    page,
  }) => {
    await page.goto("./?mock");
    await page
      .locator('.mobile-home-index a.ix-title[data-note-path="长笔记.md"]')
      .click();
    await expect(page.locator(".mobile-topbar-title")).toContainText("长笔记");

    await page.evaluate(() => window.scrollTo(0, 620));
    await page.waitForTimeout(350);

    // Cold launch to bare ./?mock restores last-read note + scroll
    await page.goto("./?mock");
    await expect(page.locator(".mobile-topbar-title")).toContainText("长笔记");
    await page.waitForTimeout(120);
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(500);

    // Recent list shows 长笔记 at top on Home
    await page.locator(".mobile-topbar-btn", { hasText: "主页" }).click();
    await expect(
      page.locator(".mobile-recent-label", { hasText: "最近" }),
    ).toBeVisible();
    const firstRecent = page.locator("[data-recent-path]").first();
    await expect(firstRecent).toHaveAttribute("data-recent-path", "长笔记.md");

    // Reloading #/note/... directly opens that note
    await page.goto(
      "./?mock#/note/" + encodeURIComponent("第一章 实数/确界原理.md"),
    );
    await expect(page.locator(".mobile-topbar-title")).toHaveText("确界原理");
  });

  test("search highlights matches and scrolls to matching line", async ({
    page,
  }) => {
    await page.goto("./?mock");
    const searchInput = page.locator(".mobile-search-input");
    await searchInput.fill("柯西");
    const ch1Hit = page.locator(
      '.mobile-search-item[data-search-path="第一章 实数/实数的完备性.md"]',
    );
    await expect(ch1Hit).toBeVisible();
    await expect(ch1Hit).toContainText("第一章 实数");
    await expect(ch1Hit.locator("mark.mobile-search-mark").first()).toHaveText(
      "柯西",
    );

    await searchInput.fill("25");
    const deepHit = page.locator(
      '.mobile-search-item[data-search-path="长笔记.md"]',
    );
    await expect(deepHit).toBeVisible();
    await expect(deepHit.locator("mark.mobile-search-mark").first()).toHaveText(
      "25",
    );

    await deepHit.click();
    await expect(page.locator(".mobile-topbar-title")).toContainText("长笔记");
    await page.waitForTimeout(120);
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(500);
  });

  test("settings persist size, theme, typeface across reloads and adapt UI", async ({
    page,
  }) => {
    await page.goto("./?mock");
    await page.locator('.mobile-icon-btn[aria-label="设置"]').click();
    const sheet = page.locator('[role="dialog"][aria-label="阅读设置"]');
    await expect(sheet).toBeVisible();

    await sheet.locator('button[aria-label="增大字号"]').click();
    await expect(sheet.locator(".mobile-setting-value")).toHaveText("19px");
    await sheet.locator(".mobile-seg-btn", { hasText: "深色" }).click();
    await sheet.locator(".mobile-seg-btn", { hasText: "宋体" }).click();
    await sheet.locator(".mobile-sheet-close").click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const fontVars = await page.evaluate(() => ({
      size: getComputedStyle(document.documentElement)
        .getPropertyValue("--note-size")
        .trim(),
      font: getComputedStyle(document.documentElement)
        .getPropertyValue("--font-note")
        .trim(),
    }));
    expect(fontVars.size).toBe("19px");
    expect(fontVars.font).toContain("Songti SC");
  });

  test("first-run states: unconfigured clientId, signedout, and folder picker -> sync -> home", async ({
    page,
  }) => {
    // Unconfigured -> fill ID -> signedout screen
    await page.goto("./?mock=unconfigured");
    await expect(page.locator("#app")).toContainText(
      "需要先填写在微软注册的应用程序 ID",
    );
    await page
      .locator(".mobile-onboard input.mobile-input")
      .fill("test-client-id-123");
    await page.locator(".mobile-onboard button[type='submit']").click();
    await expect(page.locator(".mobile-signin-btn")).toHaveText(
      "用微软账号登录",
    );
    await expect(page.locator(".mobile-onboard-note")).toContainText(
      "微软账号",
    );

    // Signed out -> empty folder picker -> choose subfolder -> sync progress -> home
    await page.goto("./?mock=empty");
    await expect(page.locator(".mobile-picker-title")).toHaveText(
      "选择笔记文件夹",
    );
    await expect(
      page.locator("button", { hasText: "选这个文件夹" }),
    ).toBeDisabled();

    await page.locator(".mobile-picker-row", { hasText: "数学笔记" }).click();
    await expect(page.locator(".mobile-breadcrumbs")).toContainText("数学笔记");
    const chooseBtn = page.locator("button", { hasText: "选这个文件夹" });
    await expect(chooseBtn).toBeEnabled();
    await chooseBtn.click();

    await expect(page.locator(".mobile-status-footer")).toContainText(
      "7 篇笔记",
      {
        timeout: 5000,
      },
    );
  });

  test("edge cases: missing image placeholder, missing note toast, onChange refresh, wake lock, external link", async ({
    page,
  }) => {
    await page.goto("./?mock");
    const outcome = await page.evaluate(async () => {
      const { mountReader } = await import("/ui/reader.js");
      let wakeRequested = 0;
      let wakeReleased = 0;
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          async request() {
            wakeRequested += 1;
            return {
              async release() {
                wakeReleased += 1;
              },
            };
          },
        },
      });

      const store = {
        settings: {
          size: 17,
          theme: "light",
          typeface: "sans",
          keepAwake: true,
        },
      };
      let noteText = `# 标题\n\n第一版正文。\n\n![缺失图](missing.png)\n\n[未同步](not-here.md) · [外链](https://example.com)\n`;
      const changeListeners = new Set();
      const fakeLibrary = {
        info: async () => ({
          folderName: "测试",
          lastSync: Date.now(),
          notes: 1,
          images: 0,
        }),
        list: async () => [
          { path: "a.md", title: "标题", modified: 1, size: 10 },
        ],
        text: async (p) => (p === "a.md" ? noteText : null),
        asset: async () => null,
        search: async () => [],
        state: {
          get: async (k, fallback) => (k in store ? store[k] : fallback),
          set: async (k, v) => {
            store[k] = v;
          },
        },
        onChange(fn) {
          changeListeners.add(fn);
          return () => changeListeners.delete(fn);
        },
      };
      const fakeAccount = {
        status: () => ({
          configured: true,
          signedIn: true,
          user: "u@example.com",
          folder: { id: "1", name: "测试" },
          syncing: false,
        }),
        onStatus: () => () => {},
        onProgress: () => () => {},
        sync: async () => {},
      };

      const host = document.createElement("div");
      document.body.replaceChildren(host);
      history.replaceState(null, "", "#/note/a.md");
      const ctrl = mountReader(host, {
        library: fakeLibrary,
        account: fakeAccount,
      });
      await new Promise((r) => setTimeout(r, 120));

      const missingImgText =
        host.querySelector(".mobile-image-missing")?.textContent || "";
      const extLink = host.querySelector(
        '.prose a[href="https://example.com"]',
      );
      const extTarget = extLink?.getAttribute("target");
      const extRel = extLink?.getAttribute("rel");

      // Missing note link triggers toast
      host.querySelector('.prose a[href="not-here.md"]').click();
      await new Promise((r) => setTimeout(r, 50));
      const toastMsg = host.querySelector(".mobile-toast")?.textContent || "";

      // library.onChange updates currently open note while preserving scroll
      noteText = "# 标题\n\n第二版更新内容。\n";
      for (const fn of changeListeners) fn();
      await new Promise((r) => setTimeout(r, 120));
      const updatedBody = host.querySelector(".prose")?.textContent || "";

      // Returning home releases wake lock
      host.querySelector('.mobile-topbar-btn[aria-label="返回主页"]').click();
      await new Promise((r) => setTimeout(r, 80));

      ctrl.destroy();
      return {
        missingImgText,
        extTarget,
        extRel,
        toastMsg,
        updatedBody,
        wakeRequested,
        wakeReleased,
      };
    });

    expect(outcome.missingImgText).toContain("图片未同步");
    expect(outcome.extTarget).toBe("_blank");
    expect(outcome.extRel).toContain("noopener");
    expect(outcome.toastMsg).toContain("笔记不在手机上");
    expect(outcome.updatedBody).toContain("第二版更新内容");
    expect(outcome.wakeRequested).toBeGreaterThanOrEqual(1);
    expect(outcome.wakeReleased).toBeGreaterThanOrEqual(1);
  });

  test("notes stay readable when the sign-in has expired; sync asks to sign in", async ({
    page,
  }) => {
    await page.goto("./?mock=expired");
    await expect(page.locator(".mobile-home-index")).toContainText("一致收敛");
    const sync = page.locator(".mobile-status-footer .mobile-sync-btn");
    await expect(sync).toHaveText("登录后同步");
    await page
      .locator(".mobile-home-index a.ix-title", { hasText: "一致收敛" })
      .first()
      .click();
    await expect(page.locator(".katex").first()).toBeVisible();
    await page.goBack();
    await page.locator(".mobile-status-footer .mobile-sync-btn").click();
    await expect(
      page.locator(".mobile-status-footer .mobile-sync-btn"),
    ).toHaveText("同步");
    await expect(page.locator(".mobile-home-index")).toBeVisible();
  });

  test("search snippets read as plain text, not Markdown", async ({ page }) => {
    await page.goto("./?mock");
    await page.locator(".mobile-search-input").fill("柯西");
    const snippet = page.locator(".mobile-search-snippet").first();
    await expect(snippet).toContainText("见 确界原理");
    await expect(snippet).not.toContainText("](");
    await expect(snippet).not.toContainText("$");
  });
  test("images not on the phone download when a note shows them", async ({
    page,
  }) => {
    await page.goto("./?mock=lazy");
    await page
      .locator('.mobile-home-index a.ix-title[data-note-path="一致收敛.md"]')
      .click();
    // The note shows at once; the image follows after its download.
    await expect(page.locator(".mobile-topbar-title")).toHaveText("一致收敛");
    await expect(page.locator(".mobile-image-missing")).toContainText(
      "正在下载图片",
    );
    await expect(page.locator(".prose img")).toHaveJSProperty("complete", true);
    await expect(page.locator(".mobile-image-missing")).toHaveCount(0);
    expect(
      await page
        .locator(".prose img")
        .evaluate((img) => img.naturalWidth > 0 && img.src.startsWith("blob:")),
    ).toBe(true);
  });

  test("an image that cannot download now says so; the setting keeps all", async ({
    page,
  }) => {
    await page.goto("./?mock=lazyoffline");
    await page
      .locator('.mobile-home-index a.ix-title[data-note-path="一致收敛.md"]')
      .click();
    await expect(page.locator(".mobile-image-missing")).toContainText(
      "图片还没下载到手机",
    );
    await page.goBack();
    await page.locator('.mobile-icon-btn[aria-label="设置"]').click();
    const toggle = page.getByRole("checkbox", { name: /下载全部图片供离线/ });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.markloreReader.account.status().offlineImages,
        ),
      )
      .toBe(true);
  });
  test("an index note shows its table of contents, the rest as written", async ({
    page,
  }) => {
    await page.goto(
      "./?mock#/note/" + encodeURIComponent("第一章 实数/_目录.md"),
    );
    await expect(page.locator(".mobile-topbar-title")).toHaveText(
      "第一章 实数",
    );
    await expect(page.locator(".prose h1")).toHaveText("第一章 实数");
    const view = page.locator(".prose .ix-list");
    await expect(view.locator("a.ix-title")).toHaveText([
      "确界原理",
      "实数的完备性",
    ]);
    // Not the plain list it is written as.
    await expect(page.locator(".prose > ul")).toHaveCount(0);
    await view.locator("a.ix-title", { hasText: "确界原理" }).click();
    await expect(page.locator(".mobile-topbar-title")).toHaveText("确界原理");
  });
});
