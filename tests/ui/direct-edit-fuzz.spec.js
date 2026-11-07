import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Random editing in the rendered note (direct editing), the way a person
// works: put the caret or a selection somewhere, then type, delete, press
// Enter, compose with an input method, paste, cut or move. After each burst
// of actions, once the page has settled, it checks:
// - no errors on the page;
// - every text run shows exactly the source it claims to come from, and the
//   page holds the same runs as a fresh render of the source;
// - the source changed only within the blocks the burst worked in (and their
//   neighbours, for joins and new blocks);
// - plain text typed at a caret lands in the source as it was typed;
// - the caret is still in the note;
// - an input method's text node is not replaced while it composes.
// At the end, undoing everything gives back the original file byte for byte,
// and redoing everything gives back the final one.
//
// Deterministic for a seed (timing aside); a failure names its seed and step.
// FOLIO_FUZZ_SEEDS=n runs seeds 1..n, FOLIO_FUZZ_SEED=k only seed k,
// FOLIO_FUZZ_STEPS=m bursts per seed.

const NOTE = [
  "# 随机编辑",
  "First **bold** and *italic*, `code`, [link](https://example.com) and $x^2$ here. 中文段落，含 emoji 😀。\nSecond line of the same paragraph.",
  "## Lists",
  "- one\n- two **bold**\n  - nested\n- [ ] task\n- [x] done",
  "1. first\n2. second",
  "> quote line\n> second quote line",
  "| A | B |\n|---|:-:|\n| 1 | two |\n| 中 | $y$ |",
  "```js\nconst x = 1;\n  indented();\n```",
  "$$\nE = mc^2\n$$",
  "---",
  "Text with an escaped \\* star and a footnote[^1].",
  "<div>html block</div>",
  "[^1]: The note.",
  "Last paragraph.",
  "",
].join("\n\n");

const env = (name) =>
  process.env[name] === undefined ? null : Number(process.env[name]);
const SEEDS =
  env("FOLIO_FUZZ_SEED") !== null
    ? [env("FOLIO_FUZZ_SEED")]
    : Array.from({ length: env("FOLIO_FUZZ_SEEDS") ?? 2 }, (_, i) => i + 1);
const STEPS = env("FOLIO_FUZZ_STEPS") ?? 30;
// FOLIO_FUZZ_TRACE=1 logs the source selection and the page's caret between
// actions.
const TRACE = Boolean(process.env.FOLIO_FUZZ_TRACE);
const describe = (page) =>
  page.evaluate(() => {
    const view = document.querySelector("#editor .cm-content").cmTile.root.view;
    const { main } = view.state.selection;
    const selection = getSelection();
    const name = (node) => {
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      if (!el) return String(node);
      const run = el.closest("[data-text-from]");
      return run
        ? `run@${run.dataset.textFrom}${run.isConnected ? "" : "(detached)"}`
        : el.tagName.toLowerCase() +
            (el.className && typeof el.className === "string"
              ? "." + el.className.trim().split(/\s+/)[0]
              : "");
    };
    const text = view.state.doc.toString();
    const around = `${JSON.stringify(text.slice(Math.max(0, main.head - 15), main.head))}|${JSON.stringify(text.slice(main.head, main.head + 15))}`;
    return `source ${main.anchor}-${main.head} ${around}, page ${name(selection.anchorNode)}:${selection.anchorOffset}-${name(selection.focusNode)}:${selection.focusOffset}, focus ${name(document.activeElement)}`;
  });

// Plain text: typed at a caret it must land in the source as it is.
const PLAIN = ["a", "中文", "xy z", "Hello", "测试", "7"];
// Text Markdown cares about.
const MARKUP = [
  "*",
  "_",
  "`",
  "$",
  "|",
  "#",
  "- ",
  "[ ]",
  "\\",
  "1. ",
  "> ",
  "**b**",
  "$x$",
  "😀",
  "  ",
];
const PASTES = ["一\n二", "a\n\nb", "| x |", "**p**", "line"];
const PINYIN = [
  ["n", "ni", "nih", "niha", "nihao"],
  ["zh", "zhong", "zhongw", "zhongwen"],
];
const IME_RESULTS = ["你好", "中文"];

function rng(seed) {
  let s = BigInt(seed) * 0x9e3779b97f4a7c15n + 1n;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    s ^= s >> 12n;
    s ^= (s << 25n) & mask;
    s ^= s >> 27n;
    return Number(((s * 0x2545f4914f6cdd1dn) & mask) >> 11n) / 2 ** 53;
  };
  return {
    below: (n) => Math.floor(next() * n),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

async function boot(page) {
  await installFolio(page);
  await page.addInitScript((text) => {
    const file = {
      id: "one",
      path: "C:/notes/One.md",
      name: "One.md",
      text,
      version: "v1",
    };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [file],
        roots: [],
        restored: [],
        settings: {
          sidebar: false,
          outline: false,
          directEdit: true,
          editSplit: true,
          richEdit: false,
        },
      }),
    });
    // The time of the last change to the page, to wait for it to settle.
    window.fuzzQuiet = performance.now();
    new MutationObserver(() => (window.fuzzQuiet = performance.now())).observe(
      document,
      { subtree: true, childList: true, characterData: true, attributes: true },
    );
  }, NOTE);
  await page.goto("/");
  await page.locator("#content [data-from]").first().waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
}

// The source editor's state (CodeMirror keeps its view on the content DOM).
const sourceState = (page) =>
  page.evaluate(() => {
    const view = document.querySelector("#editor .cm-content").cmTile.root.view;
    const { main } = view.state.selection;
    return { text: view.state.doc.toString(), from: main.from, to: main.to };
  });

// Wait for the deferred render after typing, then for the page to be still.
async function settle(page) {
  await page.waitForTimeout(700);
  await page.waitForFunction(
    () => performance.now() - window.fuzzQuiet > 250,
    null,
    {
      timeout: 10000,
    },
  );
}

// What a settled page must satisfy; returns a list of problems.
const checkPage = (page) =>
  page.evaluate(async () => {
    const problems = [];
    const view = document.querySelector("#editor .cm-content").cmTile.root.view;
    const text = view.state.doc.toString();
    const content = document.querySelector("#content");
    const plain = (value) => value.replace(/\u00a0/g, " ");
    // Runs outside islands: the ones direct editing types into.
    const runs = (root) =>
      [...root.querySelectorAll("[data-text-from]")]
        .filter((el) => !el.classList.contains("direct-empty"))
        .filter(
          (el) =>
            !el.closest(
              ".formula,.math-block,.code-block:not(.code-direct),.code-toolbar,svg,.mermaid",
            ),
        )
        .map((el) => ({
          from: Number(el.dataset.textFrom),
          text: plain(
            el.matches("pre > code")
              ? el.textContent.replace(/\n$/, "")
              : el.textContent,
          ),
        }));
    const live = runs(content);
    // Guard against checking nothing.
    if (live.length < 10) problems.push(`only ${live.length} text runs found`);
    for (const run of live) {
      const own = plain(text.slice(run.from, run.from + run.text.length));
      if (own !== run.text)
        problems.push(
          `run at ${run.from} shows ${JSON.stringify(run.text)} but the source has ${JSON.stringify(own)}`,
        );
    }
    // The same runs as a fresh render of the source.
    const { renderDocument } = await import("/src/document-render.js");
    const fresh = document.createElement("div");
    const opened = content.querySelector(".formula-source,.math-source");
    const result = renderDocument(
      { id: "one", fileId: "one", path: "C:/notes/One.md", text },
      {
        deferMath: true,
        interactiveTasks: true,
        open: opened ? view.state.selection.main.head : null,
      },
    );
    fresh.append(
      result.fragment ??
        document.createRange().createContextualFragment(result.html),
    );
    const key = (run) => `${run.from}:${run.text}`;
    const want = new Set(runs(fresh).map(key)),
      have = new Set(live.map(key));
    const missing = [...want].filter((k) => !have.has(k)),
      extra = [...have].filter((k) => !want.has(k));
    if (missing.length || extra.length)
      problems.push(
        `page differs from a fresh render: missing ${JSON.stringify(missing.slice(0, 4))}, extra ${JSON.stringify(extra.slice(0, 4))}`,
      );
    // The caret is still in the note.
    const selection = getSelection();
    if (
      !content.contains(document.activeElement) ||
      !selection.rangeCount ||
      !content.contains(selection.anchorNode)
    ) {
      const where = (node) => {
        const el = node?.nodeType === 1 ? node : node?.parentElement;
        return el
          ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}${el.isConnected ? "" : " (detached)"}`
          : String(node);
      };
      problems.push(
        `the caret left the note: focus on ${where(document.activeElement)}, selection in ${where(selection.anchorNode)}, source caret ${view.state.selection.main.head} in ${JSON.stringify(text.slice(Math.max(0, view.state.selection.main.head - 30), view.state.selection.main.head))}|${JSON.stringify(text.slice(view.state.selection.main.head, view.state.selection.main.head + 30))}`,
      );
    }
    return problems;
  });

// The source range of the top-level blocks around the caret or selection.
const blocksAround = (page) =>
  page.evaluate(() => {
    const content = document.querySelector("#content");
    // Top-level blocks in order: a section's heading, then its body's blocks.
    const blocks = [];
    const collect = (parent) => {
      for (const el of parent.children) {
        if (el.classList.contains("note-section")) {
          for (const child of el.children)
            if (child.classList.contains("section-body")) collect(child);
            else if (child.matches("h1,h2,h3,h4,h5,h6")) blocks.push(child);
        } else blocks.push(el);
      }
    };
    collect(content);
    // A block's source range: its own, or that of what it wraps (a table box).
    const range = (el) => {
      const all = [el, ...el.querySelectorAll("[data-from][data-to]")].filter(
        (node) =>
          node.dataset.from !== undefined && node.dataset.to !== undefined,
      );
      if (!all.length) return null;
      return {
        from: Math.min(...all.map((node) => Number(node.dataset.from))),
        to: Math.max(...all.map((node) => Number(node.dataset.to))),
      };
    };
    const selection = getSelection();
    if (!selection.rangeCount) return null;
    const index = [selection.anchorNode, selection.focusNode]
      .map((node) => blocks.findIndex((block) => block.contains(node)))
      .filter((i) => i >= 0);
    if (!index.length) return null;
    // With a neighbour on each side that has a source range.
    const ranges = [];
    for (const i of index) {
      for (let j = i; j >= 0; j--) {
        const own = range(blocks[j]);
        if (own) {
          ranges.push(own);
          if (j < i) break;
        }
      }
      for (let j = i + 1; j < blocks.length; j++) {
        const own = range(blocks[j]);
        if (own) {
          ranges.push(own);
          break;
        }
      }
    }
    if (!ranges.length) return null;
    return {
      from: Math.min(...ranges.map((r) => r.from)),
      to: Math.max(...ranges.map((r) => r.to)),
    };
  });

// A point on a random character of the note (text, formula or empty block).
const randomPoint = (page, r) =>
  page.evaluate((r) => {
    const content = document.querySelector("#content");
    const targets = [
      ...content.querySelectorAll("[data-text-from], .formula, .direct-empty"),
    ].filter((el) => !el.closest(".code-toolbar,button"));
    const el = targets[Math.floor(r[0] * targets.length)];
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n; (n = walker.nextNode());) if (n.length) nodes.push(n);
    let rect = el.getBoundingClientRect();
    if (nodes.length && !el.classList.contains("formula")) {
      const node = nodes[Math.floor(r[1] * nodes.length)];
      const offset = Math.floor(r[2] * (node.length + 1));
      const range = document.createRange();
      range.setStart(node, Math.min(offset, node.length));
      range.collapse(true);
      const rects = range.getClientRects();
      if (rects.length) rect = rects[0];
      else {
        range.setEnd(node, Math.min(offset + 1, node.length));
        rect = range.getBoundingClientRect();
      }
    }
    return {
      x: rect.left + Math.max(1, Math.min(rect.width / 2, 2)),
      y: rect.top + rect.height / 2,
    };
  }, r);

const changedRegion = (before, after) => {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    from: start,
    to: before.length - end,
    inserted: after.slice(start, after.length - end),
  };
};

for (const seed of SEEDS)
  test(`random editing keeps the source and the page in step (seed ${seed})`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60000 + STEPS * 8000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await boot(page);
    const cdp = await context.newCDPSession(page);
    const r = rng(seed);
    const log = [];
    const fail = (step, message, extra = "") => {
      throw new Error(
        `seed ${seed}, step ${step}: ${message}\nlast actions:\n  ${log.slice(TRACE ? -40 : -12).join("\n  ")}${extra}`,
      );
    };
    const original = (await sourceState(page)).text;
    await page.mouse.click(
      ...Object.values(
        (await randomPoint(page, [0.1, 0, 0])) ?? { x: 400, y: 200 },
      ),
    );

    for (let step = 1; step <= STEPS; step++) {
      const before = await sourceState(page);
      // One burst: an optional new place, then one to three actions.
      let typedPlain = null,
        wide = false;
      if (r.chance(0.6)) {
        const point = await randomPoint(page, [
          r.below(1e6) / 1e6,
          r.below(1e6) / 1e6,
          r.below(1e6) / 1e6,
        ]);
        if (point) {
          const shift = r.chance(0.15);
          log.push(`${step}: ${shift ? "shift-" : ""}click`);
          await page.mouse.click(point.x, point.y, {
            modifiers: shift ? ["Shift"] : [],
          });
          if (shift) wide = true;
        }
      }
      const placed = await sourceState(page);
      // The blocks each action starts in (null: somewhere without a range).
      let span = { from: Infinity, to: -Infinity };
      const count = 1 + r.below(3);
      for (let k = 0; k < count; k++) {
        if (TRACE) log.push(`      ${await describe(page)}`);
        const here = await blocksAround(page);
        span = here &&
          span && {
            from: Math.min(span.from, here.from),
            to: Math.max(span.to, here.to),
          };
        const roll = r.below(100);
        if (roll < 22) {
          const text = r.chance(0.5) ? r.pick(PLAIN) : r.pick(MARKUP);
          log.push(`${step}: type ${JSON.stringify(text)}`);
          await page.keyboard.type(text);
          if (count === 1 && PLAIN.includes(text) && placed.from === placed.to)
            typedPlain = text;
        } else if (roll < 32) {
          log.push(`${step}: Enter`);
          await page.keyboard.press("Enter");
        } else if (roll < 35) {
          log.push(`${step}: Shift+Enter`);
          await page.keyboard.press("Shift+Enter");
        } else if (roll < 47) {
          const key = r.pick([
            "Backspace",
            "Backspace",
            "Delete",
            "Control+Backspace",
            "Control+Delete",
          ]);
          log.push(`${step}: ${key}`);
          await page.keyboard.press(key);
        } else if (roll < 64) {
          const key = r.pick([
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "Shift+ArrowLeft",
            "Shift+ArrowRight",
            "Shift+ArrowDown",
            "Shift+End",
            "Control+ArrowLeft",
            "Control+ArrowRight",
          ]);
          log.push(`${step}: ${key}`);
          await page.keyboard.press(key);
          if (key.startsWith("Shift")) wide = true;
        } else if (roll < 68) {
          const key = r.pick(["Tab", "Shift+Tab"]);
          log.push(`${step}: ${key}`);
          await page.keyboard.press(key);
        } else if (roll < 80) {
          // An input method: compose, maybe pause past the render delay, commit.
          const i = r.below(PINYIN.length),
            steps = PINYIN[i],
            pause = r.pick([0, 0, 300, 900]);
          // A Windows input method first takes the key (keyCode 229).
          const processKey = r.chance(0.5);
          log.push(
            `${step}: ${processKey ? "key 229, " : ""}compose ${steps.at(-1)} → ${IME_RESULTS[i]} (pause ${pause})`,
          );
          if (processKey) {
            const key = {
              key: "Process",
              code: "KeyN",
              windowsVirtualKeyCode: 229,
            };
            await cdp.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              ...key,
            });
            await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
          }
          for (const [n, composing] of steps.entries()) {
            await cdp.send("Input.imeSetComposition", {
              text: composing,
              selectionStart: composing.length,
              selectionEnd: composing.length,
            });
            if (n === 0)
              await page.evaluate(() => {
                window.fuzzComposing = getSelection().anchorNode;
              });
          }
          if (pause) await page.waitForTimeout(pause);
          const kept = await page.evaluate(
            () => !window.fuzzComposing || window.fuzzComposing.isConnected,
          );
          await cdp.send("Input.insertText", { text: IME_RESULTS[i] });
          if (!kept)
            fail(
              step,
              "the text node being composed was replaced while the input method composed",
            );
        } else if (roll < 88) {
          const text = r.pick(PASTES);
          log.push(`${step}: paste ${JSON.stringify(text)}`);
          await page.evaluate(
            (text) => navigator.clipboard.writeText(text),
            text,
          );
          await page.keyboard.press("Control+v");
        } else if (roll < 93) {
          log.push(`${step}: Shift+ArrowRight ×3, cut`);
          for (let n = 0; n < 3; n++)
            await page.keyboard.press("Shift+ArrowRight");
          await page.keyboard.press("Control+x");
          wide = true;
        } else if (roll < 97) {
          log.push(`${step}: Control+z`);
          await page.keyboard.press("Control+z");
          wide = true;
        } else {
          log.push(`${step}: Control+Shift+z`);
          await page.keyboard.press("Control+Shift+z");
          wide = true;
        }
      }
      await settle(page);
      if (TRACE) log.push(`      settled: ${await describe(page)}`);
      if (errors.length) fail(step, `page error: ${errors[0]}`);
      const after = await sourceState(page);
      const region = changedRegion(before.text, after.text);
      const changed = region.from < region.to || region.inserted;
      // Locality: only the blocks worked in (and their neighbours) change.
      if (changed && !wide && span) {
        // Ranges read during the burst may already count its own insertions.
        const from = span.from,
          to = span.to + Math.max(0, before.text.length - after.text.length);
        if (region.from < from || region.to > to)
          fail(
            step,
            `the source changed outside the blocks worked in (${from}–${to}): ${region.from}–${region.to}`,
            `\nbefore: ${JSON.stringify(before.text.slice(Math.max(0, region.from - 20), region.to + 20))}\nafter:  ${JSON.stringify(after.text.slice(Math.max(0, region.from - 20), region.from + region.inserted.length + 20))}`,
          );
      }
      if (typedPlain && after.text !== before.text) {
        const expected =
          placed.text.slice(0, placed.from) +
          typedPlain +
          placed.text.slice(placed.from);
        if (after.text !== expected && region.inserted !== typedPlain)
          fail(
            step,
            `typed ${JSON.stringify(typedPlain)} but the source changed by ${JSON.stringify(region)}`,
          );
      }
      const problems = await checkPage(page);
      if (problems.length) fail(step, problems.join("\n"));
    }

    // Undo everything, then redo everything.
    // The steps left must run out at the original, and back.
    const final = (await sourceState(page)).text;
    const depths = () =>
      page.evaluate(async () => {
        // The source editor's own copy of @codemirror/commands.
        const url = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => name.includes("@codemirror_commands.js"));
        const { undoDepth, redoDepth } = await import(url);
        const view = document.querySelector("#editor .cm-content").cmTile.root
          .view;
        return { undo: undoDepth(view.state), redo: redoDepth(view.state) };
      });
    // A press may change no text (typing then deleting within half a second
    // is one step that nets to nothing), but it must use up a step.
    // Nothing else may change the source meanwhile: the steps add up.
    await page.evaluate(() => {
      const view = document.querySelector("#editor .cm-content").cmTile.root
        .view;
      const dispatch = view.dispatch.bind(view);
      window.fuzzDispatches = [];
      view.dispatch = (...specs) => {
        const spec = specs[0] ?? {};
        if (spec.changes !== undefined || spec.docChanged)
          window.fuzzDispatches.push(
            `${spec.docChanged !== undefined ? "transaction" : JSON.stringify(spec.userEvent ?? "")} from ${new Error().stack
              .split("\n")
              .slice(2, 6)
              .map((line) =>
                line
                  .trim()
                  .replace(/https?:\/\/[^/]+/, "")
                  .replace(/\?v=\w+/, ""),
              )
              .join(" < ")}`,
          );
        return dispatch(...specs);
      };
    });
    // (Down to a number of steps: a Ctrl+Z among the random actions leaves
    // steps to redo beyond the final text.)
    const history = async (key, side, until = 0) => {
      for (let n = 0; n < 400; n++) {
        const before = await depths();
        if (before[side] <= until) return;
        const text = (await sourceState(page)).text;
        await page.evaluate(() => (window.fuzzDispatches = []));
        await page.keyboard.press(key);
        await page.waitForTimeout(r.pick([0, 0, 50, 700]));
        const after = await depths();
        const dispatched = await page.evaluate(
          () => window.fuzzDispatches.length,
        );
        // (A step that nets to nothing is dropped, not moved to the other side.)
        const moved =
          after.undo + after.redo === before.undo + before.redo ||
          (await sourceState(page)).text === text;
        if (after[side] >= before[side] || dispatched !== 1 || !moved)
          fail(
            STEPS,
            `${key} press ${n + 1}: steps ${JSON.stringify(before)} → ${JSON.stringify(after)}: ${await describe(page)}\nsource changes: ${(await page.evaluate(() => window.fuzzDispatches)).join("\n  ")}`,
          );
      }
    };
    const start = await depths();
    await history("Control+z", "undo");
    await settle(page);
    const undone = (await sourceState(page)).text;
    if (undone !== original) {
      const region = changedRegion(original, undone);
      fail(
        STEPS,
        "undoing everything did not give back the original",
        `\noriginal: ${JSON.stringify(original.slice(Math.max(0, region.from - 20), region.to + 20))}\nundone:   ${JSON.stringify(undone.slice(Math.max(0, region.from - 20), region.from + region.inserted.length + 20))}`,
      );
    }
    await history("Control+Shift+z", "redo", start.redo);
    expect((await sourceState(page)).text).toBe(final);
    expect(errors).toEqual([]);
  });
