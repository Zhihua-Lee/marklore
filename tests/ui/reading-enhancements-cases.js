// Browser-native cases are shared by Playwright and an offline Chromium runner.
import { createPreviewCache } from "../../src/render-cache.js";
import { createFormulaHydrator } from "../../src/formula-hydration.js";
import {
  decorateSortableTables,
  sortTable,
  wireSortableTables,
} from "../../src/table-sort.js";
import { decorateCodeBlocks, wireCodeBlocks } from "../../src/code-blocks.js";
import { findPosition, selectionSource, unfold } from "../../src/positions.js";

const check = (condition, message) => {
  if (!condition) throw Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test) {
  const end = performance.now() + 4000;
  while (!test()) {
    if (performance.now() > end)
      throw Error("Timed out waiting for browser rendering");
    await sleep(25);
  }
}
function fixture() {
  const box = document.createElement("div"),
    host = document.createElement("article");
  box.style.cssText =
    "position:fixed;inset:0 auto auto 0;width:700px;height:320px;overflow:auto;z-index:999999;background:white;color:black;";
  host.className = "prose";
  host.style.cssText =
    "display:block;margin:0;padding:0;max-width:none;font-size:16px;";
  box.append(host);
  document.body.append(box);
  return { box, host };
}
function tableSkeleton(offset = 0) {
  const template = document.createElement("template");
  const values = ["10", "2", "2", ""];
  template.innerHTML = `<div class="table-scroll"><table data-from="${offset}" data-to="${offset + 100}"><colgroup><col><col></colgroup><thead><tr><th>Value</th><th>Name</th></tr></thead><tbody>${values.map((value, i) => `<tr><td><span data-text-from="${offset + i * 10}" data-text-to="${offset + i * 10 + Math.max(1, value.length)}">${value}</span></td><td>row${i}</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="2">Total</td></tr></tfoot></table></div>`;
  // A merged footer does not participate in sorting, but merged tables are
  // conservatively excluded by the production eligibility check.
  template.content.querySelector("tfoot td").removeAttribute("colspan");
  decorateSortableTables(template.content);
  return { html: template.innerHTML, fragment: template.content };
}

export const cases = {
  "insertions and deletions retain 1,200 live blocks and source offsets"() {
    const { box, host } = fixture(),
      cache = createPreviewCache();
    try {
      const make = (offset = 0) =>
        Array.from(
          { length: 1200 },
          (_, i) =>
            `<p data-from="${offset + i * 10}" data-to="${offset + i * 10 + 9}">block${i}</p>`,
        ).join("");
      cache.update(host, "note", make());
      const nodes = [...host.children],
        observer = new MutationObserver(() => {});
      observer.observe(host, { childList: true });
      const start = performance.now();
      cache.update(
        host,
        "note",
        '<p data-from="0" data-to="4">new</p>' + make(5),
      );
      const elapsed = performance.now() - start;
      check(
        nodes.every((node, i) => host.children[i + 1] === node),
        "insert detached unchanged blocks",
      );
      check(
        nodes[1199].dataset.from === "11995",
        "source offsets not translated",
      );
      check(
        observer.takeRecords().length === 1,
        "insert should require one child mutation",
      );
      cache.update(host, "note", make());
      check(
        nodes.every((node, i) => host.children[i] === node),
        "delete detached unchanged blocks",
      );
      check(
        observer.takeRecords().length === 1,
        "delete should require one child mutation",
      );
      const blocks = Array.from(
        { length: 1200 },
        (_, i) =>
          `<p data-from="${i * 10}" data-to="${i * 10 + 9}">block${i}</p>`,
      );
      blocks[1199] = "<p>edited</p>";
      cache.update(host, "note", blocks.join(""));
      check(
        observer.takeRecords().length === 2,
        "single replacement mutation regression",
      );
      check(host.firstChild === nodes[0], "first block replaced");
      observer.disconnect();
      return { prepend1200Ms: elapsed };
    } finally {
      cache.clear();
      box.remove();
    }
  },
  "preview retention preserves local state, duplicate identity and bounded eviction"() {
    const { box, host } = fixture(),
      cache = createPreviewCache({ maxDocuments: 2 });
    try {
      const html =
        "<p>same</p><p>same</p><details><summary>more</summary>body</details>";
      cache.update(host, "a", html);
      const [first, second, details] = host.children;
      details.open = true;
      cache.update(host, "a", "<p>prefix</p>" + html);
      check(
        host.children[1] === first && host.children[2] === second,
        "duplicate siblings not stable",
      );
      cache.update(host, "b", "<p>B</p>");
      cache.update(host, "a", "<p>prefix</p>" + html);
      check(host.lastChild === details && details.open, "tab state was lost");
      check(
        cache.update(host, "a", "<p>prefix</p>" + html) === false,
        "unchanged render not skipped",
      );
      cache.update(host, "b", "<p>B</p>");
      cache.update(host, "c", "<p>C</p>");
      cache.update(host, "a", html);
      check(host.firstChild !== first, "LRU did not evict");
      const current = host.firstChild;
      cache.release("a");
      cache.update(host, "a", html);
      check(host.firstChild !== current, "release did not invalidate");
    } finally {
      cache.clear();
      box.remove();
    }
  },
  "table sorting cycles stably without losing cells, footer, widths or source mappings"() {
    const { box, host } = fixture(),
      cache = createPreviewCache();
    try {
      let result = tableSkeleton();
      cache.update(host, "table", result.html, result.fragment);
      wireSortableTables(host);
      const table = host.querySelector("table"),
        rows = [...table.tBodies[0].rows];
      const cols = table.querySelector("colgroup"),
        footer = table.tFoot;
      const header = table.tHead.rows[0].cells[0],
        sort = header.querySelector(".table-sort");
      sort.click();
      check(
        [...table.tBodies[0].rows].every(
          (row, i) => row === [rows[1], rows[2], rows[0], rows[3]][i],
        ),
        "numeric ascending/ties/empty",
      );
      check(
        header.getAttribute("aria-sort") === "ascending",
        "missing accessible sort state",
      );
      result = tableSkeleton(100);
      cache.update(host, "table", "<p>prefix</p>" + result.html);
      check(
        host.querySelector("table") === table,
        "sorted table replaced after offset-only edit",
      );
      check(
        rows[1].querySelector("span").dataset.textFrom === "110",
        "sorted row source mapped by DOM order",
      );
      check(
        findPosition(host, 110).element === rows[1].querySelector("span"),
        "source lookup changed after sort",
      );
      const range = document.createRange(),
        selected = window.getSelection();
      range.setStart(rows[1].querySelector("span").firstChild, 0);
      range.setEnd(rows[1].querySelector("span").firstChild, 1);
      selected.removeAllRanges();
      selected.addRange(range);
      check(
        selectionSource(host)?.from === 110,
        "single-cell selection lost precision",
      );
      range.setStart(rows[1].querySelector("span").firstChild, 0);
      range.setEnd(rows[0].querySelector("span").firstChild, 1);
      selected.removeAllRanges();
      selected.addRange(range);
      check(
        selectionSource(host) === null,
        "unsafe sorted cross-row source selection accepted",
      );
      selected.removeAllRanges();
      sort.click();
      check(
        table.tBodies[0].rows[0] === rows[0],
        "descending is lexicographic",
      );
      sort.click();
      check(
        rows.every((row, i) => table.tBodies[0].rows[i] === row),
        "original order not restored",
      );
      header.click();
      header.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      check(
        rows.every((row, i) => table.tBodies[0].rows[i] === row) &&
          header.getAttribute("aria-sort") === "none",
        "header text click must not sort; only the button does",
      );
      check(
        table.querySelector("colgroup") === cols && table.tFoot === footer,
        "table layout/footer lost",
      );
      const irregular = document.createElement("template");
      irregular.innerHTML =
        "<table><thead><tr><th colspan=2>Merged</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>";
      decorateSortableTables(irregular.content);
      check(
        !irregular.content.querySelector("button"),
        "merged cells should not be sorted",
      );
    } finally {
      cache.clear();
      box.remove();
    }
  },
  async "code wraps, folds, copies the entire source and leaves Mermaid alone"() {
    const { box, host } = fixture(),
      prior = window.folio;
    try {
      const source =
        Array.from(
          { length: 45 },
          (_, i) => `line ${i} ${"x".repeat(120)}`,
        ).join("\n") + "\n";
      const pre = document.createElement("pre"),
        code = document.createElement("code");
      code.className = "language-python";
      code.textContent = source;
      pre.append(code);
      host.append(pre);
      decorateCodeBlocks(host);
      wireCodeBlocks(host, (message) => {
        throw Error(message);
      });
      const frame = host.querySelector("figure"),
        fold = host.querySelector(".code-fold"),
        wrap = host.querySelector(".code-wrap-toggle");
      check(
        getComputedStyle(pre).whiteSpace === "pre-wrap",
        "default wrapping not applied",
      );
      check(pre.clientHeight < pre.scrollHeight, "long code not collapsed");
      fold.click();
      check(
        fold.getAttribute("aria-expanded") === "true",
        "fold cannot expand",
      );
      check(
        pre.clientHeight >= pre.scrollHeight - 1,
        "expanded code still clipped",
      );
      wrap.click();
      check(
        getComputedStyle(pre).whiteSpace === "pre",
        "wrap toggle not applied",
      );
      fold.click();
      check(
        frame.classList.contains("code-collapsed"),
        "cannot collapse again",
      );
      let copied;
      window.folio = {
        copyText: async (text) => {
          copied = text;
        },
      };
      host.querySelector(".code-copy").click();
      await sleep(0);
      check(
        copied === source,
        "collapsed copy omitted lines or included toolbar",
      );
      unfold(code);
      check(
        !frame.classList.contains("code-collapsed") &&
          fold.getAttribute("aria-expanded") === "true",
        "source navigation did not reveal folded code",
      );
      const diagram = document.createElement("pre");
      diagram.innerHTML =
        '<code class="language-mermaid">flowchart LR\nA --&gt; B</code>';
      host.append(diagram);
      decorateCodeBlocks(host);
      check(
        !diagram.parentElement.querySelector(".code-fold,.code-wrap-toggle"),
        "Mermaid received code-only controls",
      );
      check(
        host.querySelectorAll("figure").length === 2,
        "decoration not idempotent",
      );
    } finally {
      window.folio = prior;
      box.remove();
    }
  },
  async "progressive math renders near the viewport, pauses old tabs and flushes for print"() {
    const { box, host } = fixture(),
      cache = createPreviewCache({ maxHtmlBytes: 32 * 1024 * 1024 });
    let calls = 0;
    const formulas = new Map(
      Array.from({ length: 1000 }, (_, i) => [String(i), String(i)]),
    );
    const html = [...formulas.keys()]
      .map(
        (key) =>
          `<div class="math-block" style="height:60px" data-from="${Number(key) * 10}" data-to="${Number(key) * 10 + 9}"><span data-folio-math="${key}">x${key}</span></div>`,
      )
      .join("");
    const hydrate = createFormulaHydrator(
      formulas,
      (source) => {
        calls++;
        const span = document.createElement("span");
        span.className = "rendered-formula";
        span.textContent = source;
        return span;
      },
      { progressive: true },
    );
    try {
      cache.update(host, "math", html, null, { hydrate });
      check(calls === 0, "math compiled synchronously before first paint");
      await until(() => calls > 0);
      await sleep(80);
      const initial = calls;
      check(initial < 100, "first viewport eagerly rendered distant formulas");
      box.scrollTop = box.scrollHeight;
      await until(() => host.lastChild.querySelector(".rendered-formula"));
      cache.update(host, "other", "<p>other tab</p>");
      const paused = calls;
      await sleep(80);
      check(calls === paused, "old tab continued rendering");
      cache.update(host, "math", html, null, { hydrate });
      const target = host.children[420];
      check(
        target.querySelector("[data-folio-math]"),
        "distant formula rendered before navigation",
      );
      // Real .math-block margins and reading zoom change each block's stride.
      // Navigate to the element itself, not a pixel estimate of its index.
      target.scrollIntoView({ block: "center", behavior: "instant" });
      await until(() => {
        const rect = target.getBoundingClientRect(),
          viewport = box.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      });
      await until(() => target.querySelector(".rendered-formula"));
      check(
        calls > paused && calls < 1000,
        "restored tab did not resume viewport-only rendering",
      );
      window.dispatchEvent(new Event("beforeprint"));
      check(
        calls === 1000 && !host.querySelector("[data-folio-math]"),
        "print dropped offscreen formulas or rendered twice",
      );
      return { formulas: 1000, initialViewportFormulas: initial };
    } finally {
      cache.clear();
      box.remove();
    }
  },
  async "formula hydration yields between bounded batches"() {
    const { box, host } = fixture();
    let count = 0,
      previous = 0,
      batches = 0,
      largest = 0;
    const formulas = new Map(
      Array.from({ length: 96 }, (_, i) => [String(i), String(i)]),
    );
    host.innerHTML = [...formulas.keys()]
      .map((key) => `<span data-folio-math="${key}">x</span>`)
      .join(" ");
    host.addEventListener("folio:math-rendered", () => {
      largest = Math.max(largest, count - previous);
      previous = count;
      batches++;
    });
    const hydrate = createFormulaHydrator(
      formulas,
      () => {
        count++;
        return document.createTextNode("x");
      },
      { progressive: true, budgetMs: 1 },
    );
    try {
      hydrate.activate(host);
      await until(() => count === 96);
      check(
        batches >= 3 && largest <= 32,
        "a hydration task exceeded its formula count budget",
      );
      return { batches, largest };
    } finally {
      hydrate.deactivate();
      box.remove();
    }
  },
  "small-note hydration and non-observer fallback remain synchronous"() {
    const { box, host } = fixture();
    const render = () => document.createTextNode("complete");
    const formulas = new Map([["valid", {}]]);
    const hydrate = createFormulaHydrator(formulas, render);
    try {
      host.innerHTML =
        '<span data-folio-math="valid">pending</span><span data-folio-math="forged">untrusted</span>';
      hydrate(host);
      check(
        host.textContent === "completeuntrusted",
        "eager hydration or authentication failed",
      );
      const original = window.IntersectionObserver;
      const progressive = createFormulaHydrator(formulas, render, {
        progressive: true,
      });
      try {
        window.IntersectionObserver = undefined;
        host.innerHTML = '<span data-folio-math="valid">pending</span>';
        progressive.activate(host);
        check(
          host.textContent === "complete",
          "non-observer browser left placeholders",
        );
      } finally {
        window.IntersectionObserver = original;
        progressive.deactivate();
      }
    } finally {
      hydrate.deactivate();
      box.remove();
    }
  },
  "ungrouped tabs have a distinct fill and active state in both themes"() {
    const { box, host } = fixture();
    try {
      host.innerHTML =
        '<div id="tabs"><div class="tab"><button class="tab-label">one</button></div><div class="tab active"><button class="tab-label">two</button></div><div class="tab grouped" style="--group-color:#cc6600">group</div></div>';
      const [plain, active, grouped] = host.querySelectorAll(".tab");
      for (const [background, ink] of [
        ["#f6f5f1", "#292e2d"],
        ["#202523", "#e5e9e1"],
      ]) {
        host.style.setProperty("--bg", background);
        host.style.setProperty("--ink", ink);
        const fills = [plain, active, grouped].map(
          (tab) => getComputedStyle(tab).backgroundColor,
        );
        check(
          fills.every((fill) => fill !== "rgba(0, 0, 0, 0)"),
          "a tab is transparent",
        );
        check(
          new Set(fills).size === 3,
          "active/grouped/ungrouped fills not distinct",
        );
      }
    } finally {
      box.remove();
    }
  },
};
