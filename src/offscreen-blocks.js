// Lets the browser skip drawing the parts of a long note that are off screen.
//
// With every formula drawn, a long note holds tens of thousands of elements,
// many of them positioned KaTeX spans. Chromium then spent most of each
// scrolled frame painting, updating cull rects and hit-testing the whole note
// (measured: ~20 ms per hover hit test, 50+ long frames per 80 wheel notches
// at 4x CPU slowdown). `content-visibility: auto` on finished blocks removes
// that work for blocks away from the screen.
//
// It was dropped once because estimated heights made jumps land short. Here a
// block is skipped only once it is finished (formulas drawn, images loaded, no
// pending diagram), has been laid out and is away from the screen (see pass),
// and its measured height is its placeholder height, so the note keeps
// exactly its layout: jumps, reading positions and the scrollbar see the same
// geometry. The DOM is unchanged, so find-in-note and selection still reach
// every block.
//
// Whatever could change a skipped block's height un-skips it: a change inside
// it, a new width (window, panes), the type size or face, fonts arriving. It
// is measured again in idle time.
import { navigationMoving, isCorrection } from "./positions.js";
import { tableSettled } from "./table-layout.js";

const SKIP = "reading-skip";
// A section's body (everything under its heading, sub-sections included), and
// blocks of a note before or without headings. Bodies are few even in a long
// note (each skipped element costs an intersection check per frame), and
// they hold their blocks' margins already (flow-root).
const CANDIDATES = ".section-body, .prose > :not(.note-section, .anchor-only)";
const COSMETIC = [SKIP, "section-hover", "section-focus"];
const UNFINISHED =
  "[data-folio-math], code.language-mermaid, [contenteditable], .table-measure";

// Layout containment (part of content-visibility) keeps a child's margin from
// collapsing through the block's edge, and makes the block the containing
// block of its absolutely positioned content. Only blocks where neither can
// move anything are skipped.
function edgeContained(el, style, side) {
  const s = side === "top" ? "Top" : "Bottom";
  if (
    parseFloat(style["padding" + s]) ||
    parseFloat(style["border" + s + "Width"])
  )
    return true;
  const nodes = [...el.childNodes];
  if (side === "bottom") nodes.reverse();
  for (const node of nodes) {
    if (node.nodeType === 3) {
      if (node.data.trim()) return true;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = getComputedStyle(node);
    if (child.display === "none") continue;
    if (child.display.startsWith("inline")) return true;
    if (child.position === "absolute" || child.position === "fixed")
      return false;
    if (child.float !== "none") return false;
    if (parseFloat(child["margin" + s])) return false;
    if (
      child.display !== "block" &&
      child.display !== "list-item" &&
      child.display !== "flow-root"
    )
      return true;
    if (child.display === "flow-root" || child.overflowY !== "visible")
      return true;
    return edgeContained(node, child, side);
  }
  // Empty: its own margins could collapse through it.
  return false;
}
function safe(el) {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.position === "absolute") return false;
  if (
    style.display !== "block" &&
    style.display !== "list-item" &&
    style.display !== "flow-root"
  )
    return style.display !== "contents" && !style.display.startsWith("inline");
  if (style.display === "flow-root" || style.overflowY !== "visible")
    return true;
  return edgeContained(el, style, "top") && edgeContained(el, style, "bottom");
}
// Small blocks cost little to draw; skipping each one has its own bookkeeping
// (an intersection check per frame), so only blocks with some depth qualify.
const MIN_ELEMENTS = 16,
  BATCH = 400;
function finished(el) {
  if (el.querySelector(UNFINISHED)) return false;
  for (const img of el.querySelectorAll("img")) if (!img.complete) return false;
  // Reading widths are chosen while a table is drawn (table-layout.js).
  for (const table of el.querySelectorAll(".table-scroll > table"))
    if (!tableSettled(table)) return false;
  return true;
}

// Code point ranges of a face's unicode-range ("U+0-FF, U+4E??"), or null
// when it cannot be read (then the face is taken to cover everything).
export function unicodeRanges(text) {
  const ranges = [];
  for (const part of String(text || "").split(",")) {
    const m = /^\s*U\+([0-9A-F?]+)(?:-([0-9A-F]+))?\s*$/i.exec(part);
    if (!m) return null;
    const from = parseInt(m[1].replace(/\?/g, "0"), 16);
    const to = parseInt(m[2] ?? m[1].replace(/\?/g, "F"), 16);
    ranges.push([from, to]);
  }
  return ranges.length ? ranges : null;
}

// Whether faces that just loaded can change the note's layout: a face of a
// family the note is set in (`families`: its font-family stacks) or of the
// formulas, covering a character the note's text has.
export function fontsMatter(faces, { families, text }) {
  if (!faces.length) return true;
  const used = String(families).toLowerCase();
  let points = null;
  return faces.some((face) => {
    const name = String(face.family)
      .replace(/^["']|["']$/g, "")
      .toLowerCase();
    if (!name.startsWith("katex") && !used.includes(name)) return false;
    const ranges = unicodeRanges(face.unicodeRange);
    if (!ranges) return true;
    if (!points) {
      points = new Set();
      for (const c of text) points.add(c.codePointAt(0));
    }
    for (const cp of points)
      if (ranges.some(([from, to]) => cp >= from && cp <= to)) return true;
    return false;
  });
}

export function skipOffscreenBlocks(host, scroller) {
  const verdicts = new WeakMap(),
    generations = new WeakMap();
  let generation = 0,
    idle = null,
    paused = 0,
    lastScroll = 0,
    retry = 500,
    cursor = 0,
    width = -1,
    signature = "",
    // Blocks the last pass left for being near the screen.
    near = false;
  // Class changes that move nothing: the hover and focus marks of sections
  // (sections.js) and the skip itself.
  const cosmetic = (record) => {
    if (record.attributeName !== "class") return false;
    const before = new Set(
        (record.oldValue || "").split(/\s+/).filter(Boolean),
      ),
      after = new Set(record.target.classList);
    for (const name of new Set([...before, ...after]))
      if (before.has(name) !== after.has(name) && !COSMETIC.includes(name))
        return false;
    return true;
  };
  // Blocks the browser draws now (on screen or near it): their placeholder
  // size follows what is drawn (`auto`), so a change in one needs no
  // un-skip. A section body holding most of the note is one of them, and
  // un-skipping it restyled the whole note (~100 ms) for each edit.
  const drawn = new WeakSet();
  host.addEventListener(
    "contentvisibilityautostatechange",
    (event) => {
      if (event.skipped) drawn.delete(event.target);
      else drawn.add(event.target);
    },
    true,
  );
  function unskip(block) {
    drawn.delete(block);
    block.classList.remove(SKIP);
    block.style.removeProperty("contain-intrinsic-block-size");
    // A block of the note's own (a paragraph under its title) is left as
    // it was rendered, without an empty style.
    if (!block.getAttribute("style")) block.removeAttribute("style");
    verdicts.delete(block);
  }
  function unskipAll() {
    for (const block of host.querySelectorAll("." + SKIP)) unskip(block);
  }
  function schedule(delay = 0) {
    if (idle !== null) return;
    const run = () => {
      idle = window.requestIdleCallback
        ? requestIdleCallback(pass, { timeout: 4000 })
        : setTimeout(() => pass(null), 200);
    };
    if (delay) {
      idle = -1;
      setTimeout(() => {
        idle = null;
        schedule();
      }, delay);
    } else run();
  }
  function pass(deadline) {
    idle = null;
    if (!host.getClientRects().length) return;
    // Never while the reader scrolls or a jump glides: each newly skipped
    // block is a style and layout change of its own.
    const quiet = Math.max(paused, lastScroll + 300);
    if (performance.now() < quiet || navigationMoving(scroller))
      return schedule(Math.max(50, quiet - performance.now()));
    // Also while the note's other formulas are still being drawn (in idle
    // time, formula-hydration.js): a block is skipped once its own are drawn.
    // Waiting for the whole note kept everything drawn for the minute a long
    // note takes, and each batch drawn then painted the whole note again
    // (measured: 4,400 formulas, ~200 frames over 100 ms, the page busy for
    // 57 s, against 16 s). Each batch drawn schedules the next pass.
    const began = performance.now();
    const budget = Math.max(4, Math.min(12, deadline?.timeRemaining() ?? 8)),
      candidates = host.querySelectorAll(CANDIDATES),
      start = performance.now();
    // DOM checks first (no layout), within the time budget; at least a few
    // blocks per pass, so a slow machine still gets through the note.
    const found = [];
    let more = false,
      waiting = false,
      looked = 0;
    // Each pass goes on from where the last one stopped, so parts that keep
    // waiting (and a large body around them) do not hold up the rest.
    const count = candidates.length;
    if (cursor >= count) cursor = 0;
    for (let i = 0; i < count; i++) {
      const at = (cursor + i) % count,
        el = candidates[at];
      if (el.classList.contains(SKIP) || verdicts.get(el) === false) continue;
      if (
        found.length >= BATCH ||
        (looked++ >= 24 && performance.now() - start > budget)
      ) {
        more = true;
        cursor = at;
        break;
      }
      // At least so many elements (without counting them all).
      if (!el.getElementsByTagName("*")[MIN_ELEMENTS - 1]) {
        verdicts.set(el, false);
        continue;
      }
      if (finished(el)) found.push(el);
      else waiting = true;
    }
    // Blocks on or near the screen are left drawn: a block skipped on screen
    // is taken for skipped until the next frame is drawn. A click there
    // meanwhile missed the link under it (the section took it), and a reading
    // position measured meanwhile (a batch of formulas drawn above it) missed
    // its text and threw the page by thousands of pixels. They are looked at
    // again after the next batch of formulas, or once the reader has
    // scrolled.
    const drawing = Boolean(host.querySelector("[data-folio-math]")),
      view = scroller.getBoundingClientRect();
    near = false;
    // Then styles and heights (one style and layout update for the batch),
    // then the writes.
    const blocks = found.filter((el) => {
      const rect = el.getBoundingClientRect();
      // Not shown now (a folded section): judged when it is.
      if (!rect.height) return false;
      if (
        rect.bottom > view.top - view.height &&
        rect.top < view.bottom + view.height
      ) {
        if (drawing) waiting = true;
        else near = true;
        return false;
      }
      const ok = safe(el);
      verdicts.set(el, ok);
      return ok;
    });
    // The placeholder size is the content box's.
    const heights = blocks.map((el) => {
      const style = getComputedStyle(el);
      return Math.max(
        0,
        el.getBoundingClientRect().height -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom) -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth),
      );
    });
    blocks.forEach((el, i) => {
      el.style.setProperty(
        "contain-intrinsic-block-size",
        `auto ${heights[i]}px`,
      );
      el.classList.add(SKIP);
      generations.set(el, generation);
    });
    // Our own writes are not changes to the blocks.
    observer.takeRecords();
    // Stopped for time: go on at once, or, while formulas are still being
    // drawn, after a pause four times as long as this pass (at least the
    // 150 ms a batch drawn waits). Going on at once, a slow machine ran a
    // pass after nearly every batch, each one longer as more formulas were
    // drawn (looking through drawn blocks), with a frame of its own.
    if (more)
      schedule(drawing ? Math.max(150, 4 * (performance.now() - began)) : 0);
    // Parts still waiting for something that changes nothing in the page
    // (a table's widths found fitting as they are): look again, less often.
    else if (waiting) {
      retry = blocks.length ? 500 : Math.min(8000, retry * 2);
      schedule(retry);
    } else retry = 500;
  }
  // Changes inside a skipped block un-skip it (its placeholder height would be
  // stale); new or redrawn blocks are looked at in the next idle pass.
  const observer = new MutationObserver((records) => {
    let changed = false;
    for (const record of records) {
      if (record.type === "attributes" && cosmetic(record)) continue;
      changed = true;
      // Every skipped block around it, and the blocks it is in are judged
      // again (a formula drawn into one).
      for (
        let node = record.target;
        node && node !== host;
        node = node.parentNode
      ) {
        if (node.classList?.contains(SKIP) && !drawn.has(node)) unskip(node);
        verdicts.delete(node);
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        verdicts.delete(node);
        // A cached tab's blocks come back measured at an older width or size.
        for (const kept of [
          ...(node.classList.contains(SKIP) ? [node] : []),
          ...node.querySelectorAll("." + SKIP),
        ])
          if (generations.get(kept) !== generation) unskip(kept);
      }
    }
    // The un-skips just made.
    observer.takeRecords();
    if (changed) schedule(150);
  });
  observer.observe(host, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class", "style", "open", "src", "width", "height"],
  });
  // A new width, type size, face or theme re-wraps every block.
  const reset = () => {
    generation++;
    unskipAll();
    observer.takeRecords();
    paused = performance.now() + 400;
    schedule(400);
  };
  let shown = true;
  new ResizeObserver(([entry]) => {
    const next = Math.round(entry.contentRect.width);
    // Hidden (Edit mode, home page): nothing re-wraps. Shown again: carry on
    // where a pass stopped while it was hidden.
    if (!next) return void (shown = false);
    if (!shown) {
      shown = true;
      schedule();
    }
    if (next === width) return;
    const first = width < 0;
    width = next;
    if (!first) reset();
  }).observe(host);
  const root = document.documentElement;
  const rootSignature = () =>
    [...root.attributes].map((a) => a.name + "=" + a.value).join("\n");
  signature = rootSignature();
  new MutationObserver(() => {
    const next = rootSignature();
    if (next === signature) return;
    signature = next;
    reset();
  }).observe(root, { attributes: true });
  // Fonts arriving re-wrap the blocks set in them. The interface's own (the
  // labels of the format toolbar the first time it shows) bring subsets the
  // note may not use at all; a reset for those restyled the whole note. The
  // code face counts only in a note with code (its stack shares the
  // interface's Chinese face, and the text holds every formula's source).
  document.fonts?.addEventListener("loadingdone", (event) => {
    const style = getComputedStyle(host);
    const code = host.querySelector("code, pre")
      ? "," + style.getPropertyValue("--font-code")
      : "";
    if (
      fontsMatter(event.fontfaces || [], {
        families: style.fontFamily + code,
        text: host.textContent,
      })
    )
      reset();
  });
  scroller.addEventListener(
    "scroll",
    () => {
      if (isCorrection(scroller)) return;
      lastScroll = performance.now();
      // The pass waits for the scrolling to stop.
      if (near) {
        near = false;
        schedule();
      }
    },
    { passive: true },
  );
  host.addEventListener("load", () => schedule(150), true);
  schedule();
  return { reset, schedule };
}
