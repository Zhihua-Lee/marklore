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
