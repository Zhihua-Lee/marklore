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
// pending diagram) and has been laid out, and its measured height is its
// placeholder height, so the note keeps exactly its layout: jumps, reading
// positions and the scrollbar see the same geometry. The DOM is unchanged, so
// find-in-note and selection still reach every block.
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
const CANDIDATES = ".section-body, .prose > :not(.note-section)";
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

export function skipOffscreenBlocks(host, scroller) {
  const verdicts = new WeakMap(),
    generations = new WeakMap();
  let generation = 0,
    idle = null,
    paused = 0,
    lastScroll = 0,
    width = -1,
    signature = "";
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
  function unskip(block) {
    block.classList.remove(SKIP);
    block.style.removeProperty("contain-intrinsic-block-size");
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
    // Not while formulas are still being drawn: each pass measures the note,
    // and between drawing batches that is a whole layout each time. The last
    // formula drawn (a change in the note) schedules the next pass.
    if (host.querySelector("[data-folio-math]")) return;
    const budget = Math.max(4, Math.min(12, deadline?.timeRemaining() ?? 8)),
      candidates = host.querySelectorAll(CANDIDATES),
      start = performance.now();
    // DOM checks first (no layout), within the time budget; at least a few
    // blocks per pass, so a slow machine still gets through the note.
    const found = [];
    let more = false,
      looked = 0;
    for (const el of candidates) {
      if (el.classList.contains(SKIP) || verdicts.get(el) === false) continue;
      if (
        found.length >= BATCH ||
        (looked++ >= 24 && performance.now() - start > budget)
      ) {
        more = true;
        break;
      }
      if (el.getElementsByTagName("*").length < MIN_ELEMENTS) {
        verdicts.set(el, false);
        continue;
      }
      if (finished(el)) found.push(el);
    }
    // Then styles and heights (one style and layout update for the batch),
    // then the writes.
    const blocks = found.filter((el) => {
      // Not shown now (a folded section): judged when it is.
      if (!el.getBoundingClientRect().height) return false;
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
    if (more) schedule();
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
        if (node.classList?.contains(SKIP)) unskip(node);
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
  document.fonts?.addEventListener("loadingdone", reset);
  scroller.addEventListener(
    "scroll",
    () => {
      if (!isCorrection(scroller)) lastScroll = performance.now();
    },
    { passive: true },
  );
  host.addEventListener("load", () => schedule(150), true);
  schedule();
  return { reset, schedule };
}
