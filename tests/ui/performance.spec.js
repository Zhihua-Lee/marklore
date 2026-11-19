import { test, expect } from "@playwright/test";

test("unchanged mode and recent-tab previews retain live DOM and local state", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createPreviewCache } = await import("/src/render-cache.js"),
      cache = createPreviewCache(),
      host = document.createElement("article"),
      html =
        '<p data-from="0" data-to="12"><span data-text-from="0" data-text-to="12">Hello 中文 note</span></p><details><summary>More</summary><p>Body</p></details><pre><code>diagram</code></pre>';
    document.body.append(host);
    cache.update(host, "a", html);
    const first = host.firstChild,
      details = host.querySelector("details"),
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    details.open = true;
    host.querySelector("pre").append(svg);
    const observer = new MutationObserver(() => {});
    observer.observe(host, { subtree: true, childList: true });
    const unchanged = cache.update(host, "a", html),
      modeMutations = observer.takeRecords().length;
    cache.update(host, "b", "<p>Other note</p>");
    cache.update(host, "a", html);
    const result = {
      unchanged,
      modeMutations,
      sameText: host.firstChild === first,
      sameDetails: host.querySelector("details") === details,
      open: details.open,
      sameDiagram: host.querySelector("svg") === svg,
    };
    observer.disconnect();
    host.remove();
    return result;
  });
  expect(result).toEqual({
    unchanged: false,
    modeMutations: 0,
    sameText: true,
    sameDetails: true,
    open: true,
    sameDiagram: true,
  });
});

test("editing the final block does not detach the other 1,199 preview blocks", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createPreviewCache } = await import("/src/render-cache.js"),
      cache = createPreviewCache(),
      host = document.createElement("article"),
      blocks = Array.from({ length: 1200 }, (_, i) => `<p>${i}</p>`);
    document.body.append(host);
    cache.update(host, "note", blocks.join(""));
    const first = host.firstChild,
      observer = new MutationObserver(() => {});
    observer.observe(host, { childList: true });
    blocks[1199] = "<p>Edited</p>";
    const start = performance.now();
    cache.update(host, "note", blocks.join(""));
    const result = {
      elapsedMs: performance.now() - start,
      firstPreserved: host.firstChild === first,
      mutations: observer.takeRecords().length,
      count: host.childNodes.length,
      last: host.lastChild.textContent,
    };
    observer.disconnect();
    host.remove();
    return result;
  });
  expect(result.firstPreserved).toBeTruthy();
  expect(result.mutations).toBe(2);
  expect(result.count).toBe(1200);
  expect(result.last).toBe("Edited");
  test.info().annotations.push({
    type: "measurement",
    description: `1,200-block edit reconciliation: ${result.elapsedMs.toFixed(1)} ms, ${result.mutations} DOM mutations`,
  });
});

test("a formula drawn again is not typeset again, and batches draw what single formulas do", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const markdown = await import("/src/markdown.js");
    await markdown.loadMath();
    // The KaTeX module markdown.js loaded (the same instance by its URL).
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => /\/katex\.js(\?|$)/.test(name));
    const katex = (await import(url)).default;
    const original = katex.renderToString;
    let calls = 0;
    katex.renderToString = (...args) => (calls++, original(...args));
    const html = (fragment) => {
      const box = document.createElement("div");
      box.append(fragment);
      return box.innerHTML;
    };
    try {
      const tex = "\\frac{a_{cache}}{b^2}";
      const first = html(markdown.formulaFragmentFor(tex, false));
      const again = html(markdown.formulaFragmentFor(tex, false));
      const typeset = calls;
      // Sanitized in one pass, then drawn: the same markup as one at a time.
      const list = [
        { source: "x_{batch}^2", display: false },
        { source: "\\sum_{k=0}^{n} k_{batch}", display: true },
        { source: "\\frac{1}{", display: false },
      ];
      markdown.prepareFormulas(list);
      const batched = list.map((f) =>
        html(markdown.formulaFragmentFor(f.source, f.display)),
      );
      return {
        same: first === again,
        typeset,
        katex: first.includes('class="katex"'),
        batched: batched.slice(0, 2).every((h) => h.includes('class="katex')),
        display: batched[1].includes("katex-display"),
        // Invalid TeX stays as its source, marked, with KaTeX's message.
        error:
          /^<span class="math-error" title="[^"]+">\\frac\{1\}\{<\/span>$/.test(
            batched[2],
          ),
        calls,
      };
    } finally {
      katex.renderToString = original;
    }
  });
  expect(result).toEqual({
    same: true,
    typeset: 1,
    katex: true,
    batched: true,
    display: true,
    error: true,
    calls: 4,
  });
});

test("a note's retained-memory estimate counts its drawn formulas", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js");
    const estimate = (text) =>
      renderMarkdown(text, "x", { deferMath: true }).bytes / 1048576;
    const prose = "A plain paragraph of prose, nothing else in it.\n\n";
    return {
      // ~50,000 characters of prose: a few MB.
      plain: estimate(prose.repeat(1000)),
      // 1,000 formulas: about 100 MB once drawn (measured ~100 KB each).
      formulas: estimate(
        Array.from({ length: 1000 }, (_, i) => `$x_{${i}}$ text`).join("\n\n"),
      ),
    };
  });
  expect(result.plain).toBeLessThan(8);
  // Above the preview cache's 64 MB: such a note is not kept in the background.
  expect(result.formulas).toBeGreaterThan(80);
});

test("preview retention respects document and HTML budgets and releases closed tabs", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createPreviewCache } = await import("/src/render-cache.js"),
      cache = createPreviewCache({ maxDocuments: 2 }),
      host = document.createElement("article");
    cache.update(host, "a", "<p>A</p>");
    const firstA = host.firstChild;
    cache.update(host, "b", "<p>B</p>");
    cache.update(host, "c", "<p>C</p>");
    cache.update(host, "a", "<p>A</p>");
    const evicted = host.firstChild !== firstA,
      secondA = host.firstChild;
    cache.release("a");
    cache.update(host, "a", "<p>A</p>");
    const released = host.firstChild !== secondA;
    cache.update(host, "b", "<p>B</p>");
    cache.update(host, "a", "<p>Updated externally</p>");
    const invalidated = host.textContent === "Updated externally",
      tight = createPreviewCache({ maxHtmlBytes: 20 });
    tight.update(host, "a", "<p>A</p>");
    const budgetA = host.firstChild;
    tight.update(host, "large", "<p>" + "long note".repeat(20) + "</p>");
    tight.update(host, "a", "<p>A</p>");
    return {
      evicted,
      released,
      invalidated,
      budgetEvicted: host.firstChild !== budgetA,
    };
  });
  expect(result).toEqual({
    evicted: true,
    released: true,
    invalidated: true,
    budgetEvicted: true,
  });
});

test("formulas drawn in idle time come in slices as long as the frames between them", async ({
  page,
}) => {
  // Each slice of a long note's formulas is followed by a frame that lays
  // out and paints the note again, at a cost of its own. With a fixed 8 ms
  // a slow machine drew one group of 8 per frame, and the frames took most
  // of the time. Here a formula takes 1 ms to draw and each frame after a
  // slice 30 ms.
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createFormulaHydrator } = await import("/src/formula-hydration.js");
    const spin = (ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
    };
    const scroller = document.createElement("div");
    scroller.style.cssText =
      "position:fixed;left:0;top:0;width:400px;height:200px;overflow:auto";
    const host = document.createElement("div");
    const count = 480;
    // Far below the screen: drawn in idle time only.
    host.innerHTML =
      '<div style="height:4000px"></div>' +
      Array.from(
        { length: count },
        (_, i) => `<p><span data-folio-math="${i}">x_${i}</span></p>`,
      ).join("");
    scroller.append(host);
    document.body.append(scroller);
    const formulas = new Map(
      Array.from({ length: count }, (_, i) => [String(i), i]),
    );
    const hydrator = createFormulaHydrator(
      formulas,
      (i) => {
        spin(1);
        const drawn = document.createElement("span");
        drawn.textContent = `drawn ${i}`;
        return drawn;
      },
      { progressive: true },
    );
    let slices = 0,
      queued = false;
    host.addEventListener("folio:math-rendered", () => {
      slices++;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        spin(30);
      });
    });
    hydrator.activate(host);
    const start = performance.now();
    await new Promise((resolve) => {
      const check = () =>
        host.querySelector("[data-folio-math]") &&
        performance.now() - start < 60000
          ? setTimeout(check, 50)
          : resolve();
      check();
    });
    const left = host.querySelectorAll("[data-folio-math]").length;
    hydrator.deactivate();
    scroller.remove();
    return { left, slices };
  });
  expect(result.left).toBe(0);
  // About 30 a slice (8 with the fixed budget: 60 slices).
  expect(result.slices).toBeLessThan(30);
});

test("while a button is held, formulas drawn in idle time keep to short slices", async ({
  page,
}) => {
  // Selecting or marking text while a long note's formulas are drawn: a
  // long slice made the click or the drag wait for it.
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createFormulaHydrator } = await import("/src/formula-hydration.js");
    const spin = (ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
    };
    const scroller = document.createElement("div");
    scroller.style.cssText =
      "position:fixed;left:0;top:0;width:400px;height:200px;overflow:auto";
    const host = document.createElement("div");
    const count = 480;
    host.innerHTML =
      '<div style="height:4000px"></div>' +
      Array.from(
        { length: count },
        (_, i) => `<p><span data-folio-math="${i}">x_${i}</span></p>`,
      ).join("");
    scroller.append(host);
    document.body.append(scroller);
    const formulas = new Map(
      Array.from({ length: count }, (_, i) => [String(i), i]),
    );
    const hydrator = createFormulaHydrator(
      formulas,
      (i) => {
        spin(1);
        const drawn = document.createElement("span");
        drawn.textContent = `drawn ${i}`;
        return drawn;
      },
      { progressive: true },
    );
    const left = () => host.querySelectorAll("[data-folio-math]").length;
    let before = count,
      held = true,
      released = 0,
      queued = false;
    const slices = [];
    host.addEventListener("folio:math-rendered", () => {
      const now = left();
      slices.push({
        drawn: before - now,
        held,
        settled: !held && performance.now() - released > 600,
      });
      before = now;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        spin(30);
      });
    });
    hydrator.activate(host);
    window.dispatchEvent(new PointerEvent("pointerdown"));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    held = false;
    released = performance.now();
    window.dispatchEvent(new PointerEvent("pointerup"));
    const start = performance.now();
    await new Promise((resolve) => {
      const check = () =>
        left() && performance.now() - start < 60000
          ? setTimeout(check, 50)
          : resolve();
      check();
    });
    hydrator.deactivate();
    scroller.remove();
    return {
      left: left(),
      held: slices.filter((s) => s.held).map((s) => s.drawn),
      settled: slices.filter((s) => s.settled).map((s) => s.drawn),
    };
  });
  expect(result.left).toBe(0);
  expect(result.held.length).toBeGreaterThan(3);
  // One group of 8 at a time while held; longer slices once let go.
  expect(Math.max(...result.held)).toBeLessThanOrEqual(8);
  expect(Math.max(...result.settled)).toBeGreaterThan(8);
});

test("anchor fallback measures only blocks needed to locate the reading line", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { visibleAnchor, findPosition } = await import("/src/positions.js"),
      host = document.createElement("div");
    host.style.cssText =
      "position:fixed;top:0;left:0;width:500px;height:100px;overflow:auto;z-index:99999";
    host.innerHTML = Array.from(
      { length: 1200 },
      (_, i) =>
        `<p style="height:80px;margin:0" data-from="${i * 100}" data-to="${(i + 1) * 100}">Block ${i}</p>`,
    ).join("");
    document.body.append(host);
    host.scrollTop = 20;
    let measured = 0;
    for (const block of host.children) {
      const original = block.getClientRects.bind(block);
      block.getClientRects = () => {
        measured++;
        return original();
      };
    }
    const anchor = visibleAnchor(host);
    host.innerHTML =
      '<p data-from="0" data-to="30"><span data-text-from="4" data-text-to="11">中英word字</span></p>';
    const precise = findPosition(host, 7);
    const result = {
      measured,
      from: anchor.from,
      preciseOffset: precise.range.startOffset,
      exactText: precise.range.toString(),
    };
    host.remove();
    return result;
  });
  expect(result).toEqual({
    measured: 1,
    from: 0,
    preciseOffset: 3,
    exactText: "o",
  });
});

test("a diagram detached before its queued render can render after tab restoration", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { renderDiagrams } = await import("/src/diagrams.js"),
      host = document.createElement("article");
    host.id = "cached-diagram-test";
    host.innerHTML =
      '<pre><code class="language-mermaid">flowchart LR\nA[Read] --&gt; B[Think]</code></pre>';
    document.body.append(host);
    renderDiagrams(host, "light", () => {});
    host.remove();
    await new Promise((resolve) => setTimeout(resolve, 30));
    document.body.append(host);
    renderDiagrams(host, "light", () => {});
  });
  await expect(page.locator("#cached-diagram-test .diagram svg")).toBeVisible({
    timeout: 20000,
  });
  await page.evaluate(async () => {
    const { renderDiagrams } = await import("/src/diagrams.js"),
      host = document.querySelector("#cached-diagram-test");
    renderDiagrams(host, "dark", () => {});
    renderDiagrams(host, "light", () => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await expect(page.locator("#cached-diagram-test pre")).toHaveAttribute(
    "data-diagram-theme",
    "light",
  );
});
