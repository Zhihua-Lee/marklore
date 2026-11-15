import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Switching between Read and Edit in a long note keeps the place: the text
// at the reading line comes back where it was. Read mode skips the parts of
// the note off screen (src/offscreen-blocks.js); finding the reading
// position must not lay them all out (src/positions.js), and the landing
// must be as exact as when everything is laid out.
const longNote =
  "# Long\n\n" +
  Array.from(
    { length: 60 },
    (_, n) =>
      `## Section ${n}\n\n${("Reading paragraph " + n + ". ").repeat(30)}$a_${n}^2$.\n\n` +
      `- item $x_${n}$ one\n- item two\n- item three\n\n` +
      `$$\\sum_{k=0}^{${n}} \\frac{k^2}{k+1}$$\n\n` +
      "| Name | Value |\n|---|---|\n" +
      `| row | $v_${n}$ |\n\n` +
      `Closing paragraph ${n} with a few words.\n\n`,
  ).join("");

async function boot(page) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          {
            id: "note",
            name: "Note.md",
            path: "C:/synthetic/Note.md",
            text,
            version: "v1",
          },
        ],
        settings: { sidebar: false, outline: false, richEdit: true },
      }),
    });
  }, longNote);
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelectorAll("#content [data-folio-math]").length,
        ),
      { timeout: 20000 },
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelectorAll("#content .reading-skip").length,
      ),
    )
    .toBeGreaterThan(30);
}

// The block under the reading line (32 px below the pane's top) and its
// top, relative to the pane.
const atLine = (page, pane) =>
  page.evaluate((pane) => {
    const box = document.querySelector(pane).getBoundingClientRect();
    for (const dy of [32, 40, 48, 56, 64, 80, 100]) {
      const el = document
        .elementFromPoint(box.left + box.width / 2, box.top + dy)
        ?.closest("p, li, h2, td, .math-block");
      if (el)
        return {
          text: el.textContent.trim().slice(0, 30),
          top: el.getBoundingClientRect().top - box.top,
        };
    }
    return null;
  }, pane);

// The reading position found from the screen down, and a place found by
// its offset, are those a walk through the whole note finds.
test("reading positions in a long note are found without measuring it all", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { visibleAnchor, findPosition } = await import("/src/positions.js");
    const reader = document.querySelector("#reader");
    const host = document.querySelector("#content");
    // The first shown block reaching below the reading line, measured one
    // by one from the top (what the anchor was found by before).
    const brute = () => {
      const y = reader.getBoundingClientRect().top + 32;
      let last = null;
      for (const el of host.querySelectorAll("[data-from]")) {
        if (!el.getClientRects().length) continue;
        last = el;
        if (el.getBoundingClientRect().bottom > y) break;
      }
      return last && Number(last.dataset.from);
    };
    const out = { gaps: 0, mismatches: [] };
    // Reading lines on the margins between blocks: the anchor is a block.
    const paragraphs = [...host.querySelectorAll(".section-body > p")];
    for (const p of paragraphs.filter((_, i) => i % 9 === 4)) {
      reader.scrollTop +=
        p.getBoundingClientRect().bottom -
        reader.getBoundingClientRect().top -
        32 +
        2;
      const anchor = visibleAnchor(reader);
      if (anchor.exact) continue;
      out.gaps++;
      if (anchor.from !== brute()) out.mismatches.push([anchor.from, brute()]);
    }
    // Offsets everywhere in the note, inside and between text runs.
    const ends = [...host.querySelectorAll("[data-to]")].map((e) =>
      Number(e.dataset.to),
    );
    const max = Math.max(...ends);
    // Not inside a drawn formula.
    const place = (el) =>
      !el.parentElement.closest(".formula[data-from], .math-block[data-from]");
    const walk = (from) => {
      let leaf = null;
      for (const el of host.querySelectorAll("[data-text-from]"))
        if (
          place(el) &&
          Number(el.dataset.textFrom) <= from &&
          Number(el.dataset.textTo) > from
        ) {
          leaf = el;
          break;
        }
      if (leaf) return leaf;
      let best = null,
        last = null;
      for (const el of host.querySelectorAll("[data-from]")) {
        if (!place(el)) continue;
        const s = Number(el.dataset.from),
          e = Number(el.dataset.to);
        if (s <= from) last = el;
        if (
          s <= from &&
          from < e &&
          (!best || e - s < Number(best.dataset.to) - Number(best.dataset.from))
        )
          best = el;
      }
      return best ?? last;
    };
    out.offsets = 0;
    for (let from = 0; from < max; from += 997) {
      out.offsets++;
      if (findPosition(host, from)?.element !== walk(from))
        out.mismatches.push(["offset", from]);
    }
    return out;
  });
  expect(result.gaps).toBeGreaterThan(3);
  expect(result.offsets).toBeGreaterThan(50);
  expect(result.mismatches).toEqual([]);
});

test("Edit then Read lands on the block Edit mode showed", async ({ page }) => {
  await boot(page);
  for (const text of ["Closing paragraph 17", "Closing paragraph 52"]) {
    await page.keyboard.press("Control+2");
    await expect(page.locator("#rich-reader")).toBeVisible();
    await page.evaluate((text) => {
      const scroller = document.querySelector("#rich-reader");
      const el = [...document.querySelectorAll("#rich p")].find((e) =>
        e.textContent.includes(text),
      );
      el.scrollIntoView({ block: "start" });
      scroller.scrollTop -= 20;
    }, text);
    await page.waitForTimeout(300);
    const editing = await atLine(page, "#rich-reader");
    await page.keyboard.press("Control+1");
    await expect(page.locator("#reader")).toBeVisible();
    await page.waitForTimeout(400);
    const reading = await atLine(page, "#reader");
    expect(reading.text, text).toBe(editing.text);
    expect(Math.abs(reading.top - editing.top), text).toBeLessThanOrEqual(3);
  }
});

// A paragraph several screens tall: the reading place is a line inside it,
// not the block, and each switch keeps that line where it was.
const tallNote =
  "# Tall\n\n" +
  Array.from({ length: 6 }, (_, n) => `Short paragraph ${n}.\n\n`).join("") +
  Array.from({ length: 1500 }, (_, i) => "w" + String(i).padStart(4, "0")).join(
    " ",
  ) +
  "\n\n" +
  Array.from({ length: 30 }, (_, n) => `After paragraph ${n}.\n\n`).join("");

// The word at the reading line and the top of its line, relative to the pane.
const wordAtLine = (page, pane) =>
  page.evaluate((pane) => {
    const box = document.querySelector(pane).getBoundingClientRect();
    const caret = document.caretPositionFromPoint(
      box.left + box.width / 2,
      box.top + 40,
    );
    const text = caret.offsetNode.textContent;
    let start = caret.offset;
    while (start > 0 && text[start - 1] !== " ") start--;
    const range = document.createRange();
    range.setStart(caret.offsetNode, start);
    range.setEnd(caret.offsetNode, start + 1);
    return {
      word: text.slice(start, start + 5),
      top: range.getBoundingClientRect().top - box.top,
    };
  }, pane);

test("switching keeps the line read inside a tall paragraph", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          {
            id: "tall",
            name: "Tall.md",
            path: "C:/synthetic/Tall.md",
            text,
            version: "v1",
          },
        ],
        settings: { sidebar: false, outline: false, richEdit: true },
      }),
    });
  }, tallNote);
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
  for (const depth of [0.3, 0.55, 0.8]) {
    await page.evaluate((depth) => {
      const reader = document.querySelector("#reader");
      const p = [...document.querySelectorAll("#content p")].find((e) =>
        e.textContent.startsWith("w0000"),
      );
      const r = p.getBoundingClientRect();
      reader.scrollTop +=
        r.top - reader.getBoundingClientRect().top + r.height * depth;
    }, depth);
    await page.waitForTimeout(200);
    const reading = await wordAtLine(page, "#reader");
    await page.keyboard.press("Control+2");
    await expect(page.locator("#rich-reader")).toBeVisible();
    await page.waitForTimeout(300);
    const editing = await wordAtLine(page, "#rich-reader");
    expect(editing.word, `Edit at ${depth}`).toBe(reading.word);
    expect(Math.abs(editing.top - reading.top)).toBeLessThanOrEqual(3);
    await page.keyboard.press("Control+1");
    await expect(page.locator("#reader")).toBeVisible();
    await page.waitForTimeout(300);
    const back = await wordAtLine(page, "#reader");
    expect(back.word, `Read again at ${depth}`).toBe(reading.word);
    expect(Math.abs(back.top - reading.top)).toBeLessThanOrEqual(3);
  }
});
