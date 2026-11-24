import { setSectionCollapsed } from "./sections.js";
import { setCodeCollapsed } from "./code-blocks.js";

export function textOffset(element, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
}
// app.js raises a transparent shield over the reader while it scrolls (hover
// hit tests are expensive); reading positions hit-test the note underneath.
function underShield(measure) {
  const shield = document.querySelector(".scroll-shield.raised");
  shield?.classList.remove("raised");
  try {
    return measure();
  } finally {
    shield?.classList.add("raised");
  }
}
// `held`: for a reading position (see pointSource).
export function atPoint(host, x, y, held = false) {
  return underShield(() => pointSource(host, x, y, held));
}
// The DOM caret position at a point of the page, or null.
export function caretAt(x, y) {
  return underShield(() => {
    const caret = document.caretPositionFromPoint?.(x, y);
    if (caret) return { node: caret.offsetNode, offset: caret.offset };
    const range = document.caretRangeFromPoint?.(x, y);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  });
}
function pointSource(host, x, y, held) {
  const caret = document.caretPositionFromPoint?.(x, y);
  const range = !caret && document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode || range?.startContainer,
    offset = caret?.offset ?? range?.startOffset;
  const leaf = node?.parentElement?.closest("[data-text-from]");
  if (leaf && host.contains(leaf)) {
    const start = Number(leaf.dataset.textFrom),
      end = Number(leaf.dataset.textTo),
      at = start + textOffset(leaf, node, offset);
    // For a reading position, a caret after the run's last character (a
    // point right of a line's end) is held by that character: the offset
    // after it belongs to no run, and restoring it measured the enclosing
    // block instead, a line or more away.
    const from = held ? Math.max(start, Math.min(end - 1, at)) : at;
    // Where that character's box starts now, measured by findPosition as it
    // is when the anchor is restored: a caret at the end of one text node
    // and at the start of the next are the same offset, but their boxes can
    // lie on different lines or beside a formula that is still growing.
    let top;
    if (held)
      top = findPosition(host, from)?.range?.getBoundingClientRect().top;
    return { from, exact: true, top };
  }
  const target = document.elementFromPoint(x, y)?.closest("[data-from]");
  if (target && host.contains(target))
    return {
      from: Number(target.dataset.from),
      to: Number(target.dataset.to),
      exact: false,
    };
  return null;
}

export function selectionSource(host) {
  const selected = window.getSelection();
  if (!selected?.rangeCount || selected.isCollapsed) return null;
  const range = selected.getRangeAt(0),
    start = range.startContainer.parentElement?.closest("[data-text-from]"),
    end = range.endContainer.parentElement?.closest("[data-text-from]");
  if (!start || !end || !host.contains(start) || !host.contains(end))
    return null;
  // A view-sorted table is not a contiguous source range across cells/rows.
  // Single-cell text editing remains precise; cross-cell source edits are unsafe.
  const sortedTable =
    start.closest('table[data-view-sorted="true"]') ||
    end.closest('table[data-view-sorted="true"]');
  if (sortedTable && start.closest("th,td") !== end.closest("th,td"))
    return null;
  return {
    from:
      Number(start.dataset.textFrom) +
      textOffset(start, range.startContainer, range.startOffset),
    to:
      Number(end.dataset.textFrom) +
      textOffset(end, range.endContainer, range.endOffset),
  };
}

// A formula drawn in the reading view, inline or display.
const DRAWN = ".formula[data-from], .math-block[data-from]";
// A selection's end at a point in `formula` takes in some of it.
export function holds(formula, node, offset, end) {
  const part = document.createRange();
  part.selectNodeContents(formula);
  if (end) part.setEnd(node, offset);
  else part.setStart(node, offset);
  return part.toString() !== "";
}
// The mapped place nearest to a DOM point, looking into the selection (on
// from a start, back from an end): a character of a run of mapped text, or a
// formula, whole. A point between elements (the edge of a paragraph, a
// paragraph selected by triple click, the gap beside a display formula)
// lands on the text or formula next to it. `skip` leaves out what matches
// it (and what is in it). Null when nothing mapped is that way in `host`.
//   { node, offset }: in a text node of a mapped run;
//   { formula }: a formula;
//   { block }: a code block reached from outside it, taken whole (its
//   fences too).
export function mappedPoint(host, node, offset, end, skip = null) {
  const element = (n) =>
    n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
  const take = (n, edge, beside = false) => {
    const el = element(n);
    if (!el || !host.contains(el) || (skip && el.closest(skip))) return null;
    const formula = el.closest(DRAWN);
    if (formula && host.contains(formula)) return { formula };
    const block = beside && el.closest("pre[data-from][data-to]");
    if (block && host.contains(block)) return { block };
    if (n.nodeType !== Node.TEXT_NODE || !n.length) return null;
    const leaf = el.closest("[data-text-from]");
    if (!leaf || !host.contains(leaf)) return null;
    return { node: n, offset: edge ?? (end ? n.length : 0) };
  };
  // Where it is. A point in a formula that holds none of it on the
  // selection's side (an end at its very start, as a triple click leaves
  // it) is beside it.
  const here = take(node, node.nodeType === Node.TEXT_NODE ? offset : null);
  if (here?.formula && !holds(here.formula, node, offset, end)) {
    const parent = here.formula.parentNode;
    return mappedPoint(
      host,
      parent,
      [...parent.childNodes].indexOf(here.formula) + (end ? 0 : 1),
      end,
      skip,
    );
  }
  if (here && (here.formula || node.nodeType === Node.TEXT_NODE)) return here;
  const walker = document.createTreeWalker(
    host,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let first;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    walker.currentNode = node;
    first = end ? walker.previousNode() : walker.nextNode();
  } else if (end) {
    // The last node before the point: the deepest last one of the child
    // before it.
    let child = node.childNodes[offset - 1];
    if (child) {
      while (child.lastChild) child = child.lastChild;
      first = child;
    } else {
      walker.currentNode = node;
      first = walker.previousNode();
    }
  } else {
    first = node.childNodes[offset];
    if (!first) {
      let last = node;
      while (last.lastChild) last = last.lastChild;
      walker.currentNode = last;
      first = walker.nextNode();
    }
  }
  if (!first) return null;
  walker.currentNode = first;
  for (let n = first; n; n = end ? walker.previousNode() : walker.nextNode()) {
    const found = take(n, undefined, true);
    if (found) return found;
  }
  return null;
}
// The source offset of a selection's end: a formula is taken whole, and a
// code block the end is beside.
function mappedOffset(host, node, offset, end) {
  const point = mappedPoint(host, node, offset, end);
  if (!point) return null;
  const whole = point.formula ?? point.block;
  if (whole) return Number(whole.dataset[end ? "to" : "from"]);
  const leaf = point.node.parentElement.closest("[data-text-from]");
  return (
    Number(leaf.dataset.textFrom) + textOffset(leaf, point.node, point.offset)
  );
}
// The selection in the source, for a mark: as selectionSource, and also
// where an end is in a formula or between elements (an end in a formula
// takes the whole formula). With the note's `text`, without the spaces and
// line breaks at its ends (a display formula or code block taken whole
// ends with its line break), as Edit mode's selection.
export function selectionSpan(host, text = null) {
  const selected = window.getSelection();
  if (!selected?.rangeCount || selected.isCollapsed) return null;
  const range = selected.getRangeAt(0);
  if (
    !host.contains(range.startContainer) ||
    !host.contains(range.endContainer)
  )
    return null;
  const cell = (node) =>
    (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(
      "th,td",
    );
  const sorted = (node) =>
    cell(node)?.closest('table[data-view-sorted="true"]');
  if (
    (sorted(range.startContainer) || sorted(range.endContainer)) &&
    cell(range.startContainer) !== cell(range.endContainer)
  )
    return null;
  const from = mappedOffset(
      host,
      range.startContainer,
      range.startOffset,
      false,
    ),
    to = mappedOffset(host, range.endContainer, range.endOffset, true);
  if (from == null || to == null || to <= from) return null;
  if (text == null) return { from, to };
  const part = text.slice(from, to);
  const a = from + part.length - part.trimStart().length,
    b = to - part.length + part.trimEnd().length;
  return b > a ? { from: a, to: b } : null;
}
// Windows word selection may include the following space, even across an inline
// formatting boundary. Keep a double-click inside its actual text leaf so source
// replacement cannot accidentally consume a closing **, link target or HTML tag.
export function constrainWordSelection(host, hit) {
  if (!hit?.exact) return;
  const selected = selectionSource(host),
    leaf = findPosition(host, hit.from)?.element;
  if (
    !selected ||
    !leaf?.hasAttribute("data-text-from") ||
    leaf.childNodes.length !== 1 ||
    leaf.firstChild.nodeType !== Node.TEXT_NODE
  )
    return;
  const base = Number(leaf.dataset.textFrom),
    text = leaf.textContent;
  let start = Math.max(0, selected.from - base),
    end = Math.min(text.length, selected.to - base);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start) return;
  const range = document.createRange();
  range.setStart(leaf.firstChild, start);
  range.setEnd(leaf.firstChild, end);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}
export function visibleAnchor(host) {
  return underShield(() => readingAnchor(host));
}
function readingAnchor(host) {
  if (host.scrollTop < 2) return { from: 0, y: 0, top: true };
  const rect = host.getBoundingClientRect(),
    y = rect.top + 32;
  let visibleBlock = null;
  for (const x of [
    rect.left + 40,
    rect.left + rect.width * 0.3,
    rect.left + rect.width * 0.5,
  ]) {
    const hit = atPoint(host, x, y, true);
    // The character keeps its place: its box's top, not the probe's height
    // (up to a line below it), goes back to where it is now.
    if (hit?.exact) {
      const { top, ...anchor } = hit;
      return { ...anchor, y: top === undefined ? 32 : top - rect.top };
    }
    const hitEl = document.elementFromPoint(x, y);
    const block = hitEl?.closest("[data-from]");
    // Container elements such as .ix-list, ul/ol/blockquote, or the child rail
    // around nested .ix-item entries carry an outer data-from for reconciliation;
    // when y lands in their inter-row gap, fall through to firstBelow().
    if (
      block &&
      host.contains(block) &&
      !block.classList.contains("ix-list") &&
      !(block.classList.contains("ix-item") && !hitEl.closest(".ix-row")) &&
      !(block.matches?.("ul, ol, blockquote") && hitEl === block)
    )
      visibleBlock = block;
  }
  if (visibleBlock?.getClientRects().length) {
    const box = visibleBlock.getBoundingClientRect();
    return {
      from: Number(visibleBlock.dataset.from),
      y: 32,
      fraction: Math.max(
        0,
        Math.min(1, (y - box.top) / Math.max(1, box.height)),
      ),
    };
  }
  const found = firstBelow(host, y);
  if (!found) return { from: 0, y: 0, top: true };
  const { el, r } = found;
  const fraction = Math.max(
    0,
    Math.min(1, (y - r.top) / Math.max(1, r.height)),
  );
  return { from: Number(el.dataset.from), fraction, y: 32 };
}
// The first shown block (data-from) in page order reaching below `y`, or the
// last one shown when none does: the reading line fell between blocks.
// Found from the top down by halving each level's children, so only blocks
// on the way are measured: measuring every block from the top of the note
// laid out every part skipped off screen (offscreen-blocks.js), most of a
// long note.
function firstBelow(host, y) {
  const shown = (el) => el.getClientRects().length > 0;
  function within(parent) {
    const kids = parent.children;
    // Children in flow lie in page order: the first whose bottom is below y.
    // Children not shown (folded, hidden) are passed over.
    let lo = 0,
      hi = kids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      let at = mid;
      while (at < hi && !shown(kids[at])) at++;
      if (at === hi) hi = mid;
      else if (kids[at].getBoundingClientRect().bottom > y) hi = mid;
      else lo = at + 1;
    }
    for (let i = lo; i < kids.length; i++) {
      const el = kids[i];
      if (!shown(el)) continue;
      if (el.matches?.(DRAWN)) return { el, r: el.getBoundingClientRect() };
      if (el.classList?.contains("ix-item")) {
        const row = el.querySelector(":scope > .ix-row");
        if (row && shown(row) && row.getBoundingClientRect().bottom > y)
          return { el, r: el.getBoundingClientRect() };
      }
      // A block is the anchor itself; only an index view's list and an entry
      // whose row is above the reading line are looked into, since the line
      // falls in the gaps between their rows.
      if (
        el.hasAttribute("data-from") &&
        !el.classList.contains("ix-list") &&
        !el.classList.contains("ix-item")
      )
        return { el, r: el.getBoundingClientRect() };
      const inner = within(el);
      if (inner) return inner;
      if (el.hasAttribute("data-from"))
        return { el, r: el.getBoundingClientRect() };
    }
    return null;
  }
  const hit = within(host);
  if (hit) return hit;
  const last = lastBlock(host);
  return last ? { el: last, r: last.getBoundingClientRect() } : null;
}
// The last shown block (data-from) in page order within el, el too, or null.
function lastBlock(el) {
  for (let i = el.children.length - 1; i >= 0; i--) {
    const kid = el.children[i];
    if (!kid.getClientRects().length) continue;
    const found = lastBlock(kid);
    if (found) return found;
  }
  return el.hasAttribute("data-from") ? el : null;
}
// Whether el lies inside a formula the renderer drew (data-from on it): its
// many elements have no position in the note.
function inDrawn(host, el) {
  const formula = el.parentElement?.closest(
    ".formula[data-from], .math-block[data-from]",
  );
  return Boolean(formula && host.contains(formula));
}
// The places of `host` (elements with `attribute`) in page order, none
// inside a drawn formula. A selector query: walking a long note's tens of
// thousands of elements in script took 100 ms and more.
function* placesWith(host, attribute) {
  for (const el of host.querySelectorAll(`[${attribute}]`))
    if (!inDrawn(host, el)) yield el;
}
export function findPosition(host, from) {
  let leaf = null;
  for (const el of host.querySelectorAll("[data-text-from]"))
    if (
      Number(el.getAttribute("data-text-from")) <= from &&
      Number(el.getAttribute("data-text-to")) > from &&
      !inDrawn(host, el)
    ) {
      leaf = el;
      break;
    }
  if (leaf) {
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
    let remaining = from - Number(leaf.dataset.textFrom),
      node,
      last = null;
    // The character at that offset: the start of the next text node rather
    // than the (empty) end of the one before it.
    while ((node = walker.nextNode())) {
      if (remaining < node.length) {
        const r = document.createRange();
        r.setStart(node, remaining);
        r.setEnd(node, remaining + 1);
        return { element: leaf, range: r };
      }
      remaining -= node.length;
      last = node;
    }
    if (last && remaining === 0) {
      const r = document.createRange();
      r.setStart(last, last.length);
      return { element: leaf, range: r };
    }
  }
  let best = null,
    last = null;
  for (const el of placesWith(host, "data-from")) {
    const start = Number(el.dataset.from),
      end = Number(el.dataset.to);
    if (start <= from) last = el;
    if (
      start <= from &&
      from < end &&
      (!best ||
        end - start < Number(best.dataset.to) - Number(best.dataset.from))
    )
      best = el;
  }
  best ??= last;
  return best ? { element: best } : null;
}
export function unfold(element) {
  for (let el = element; el; el = el.parentElement) {
    if (el.tagName === "DETAILS") el.open = true;
    if (el.classList.contains("code-block")) setCodeCollapsed(el, false);
    if (el.classList.contains("note-section")) {
      setSectionCollapsed(el, false);
    }
  }
}
function anchorHit(host, anchor) {
  const target =
    anchor.targetId && host.querySelector("#" + CSS.escape(anchor.targetId));
  return target ? { element: target } : findPosition(host, anchor.from);
}
// How far below the top of `host` the anchor's position is now: passed back as
// the anchor's `y`, the place stays where it is on screen (null if hidden).
export function anchorOffset(host, anchor) {
  const top = anchorTop(host, { ...anchor, y: 0, top: false }, false);
  return top === null ? null : top - host.scrollTop;
}
function anchorTop(host, anchor, expand) {
  if (!anchor || anchor.top) return 0;
  const hit = anchorHit(host, anchor);
  if (!hit) return null;
  if (expand) unfold(hit.element);
  const rect =
    hit.range?.getBoundingClientRect() || hit.element.getBoundingClientRect();
  if (!hit.element.getClientRects().length) return null;
  return (
    host.scrollTop +
    rect.top -
    host.getBoundingClientRect().top +
    (anchor.fraction || 0) * rect.height -
    (anchor.y ?? 32)
  );
}

// One in-flight navigation per scroller. Lazy formulas and tables pause while it
// moves (see navigationMoving), so the path keeps its measured height and the
// target stays valid. Once it lands, their layout-preserving restores keep the
// target in place instead of pinning whatever block is at the viewport top.
const navigations = new WeakMap();
export function navigationMoving(host) {
  return navigations.get(host)?.moving === true;
}
// Before a jump moves, lazy formulas (content) on its path and table widths
// (layout) at its destination render synchronously, so the smooth scroll passes
// finished content and the target is measured against its final layout. Idle
// backfill normally has done this already (a few ms). Right after opening, the
// formula work is capped, nearest the destination first, so the click stays
// responsive; path tables keep native widths (never raw source) until idle.
// Listeners get viewport-coordinate ranges plus the destination's position.
const PREPARE_CONTENT_MS = 120;
function prepareDestination(host, anchor, smooth) {
  if (!anchor || anchor.top) return;
  const element = anchorHit(host, anchor)?.element;
  if (!element?.getClientRects().length) return;
  // Growth above the current screen (upward jumps) must not move what is
  // shown while a glide sets off. An instant jump shows only its landing,
  // measured after this.
  const keep = smooth ? visibleAnchor(host) : null;
  for (const phase of ["content", "layout"]) {
    const view = host.getBoundingClientRect(),
      top = element.getBoundingClientRect().top,
      height = host.clientHeight;
    const around = { top: top - height, bottom: top + 2 * height };
    element.dispatchEvent(
      new CustomEvent("folio:prepare-" + phase, {
        bubbles: true,
        detail:
          phase === "content"
            ? {
                top: Math.min(view.top, around.top),
                bottom: Math.max(view.bottom, around.bottom),
                target: top,
                budgetMs: PREPARE_CONTENT_MS,
              }
            : around,
      }),
    );
  }
  if (!keep || keep.top) return;
  const held = anchorTop(host, keep, false);
  if (held !== null) host.scrollTo({ behavior: "instant", top: held });
}
function place(host, navigation, top) {
  host.scrollTo({ behavior: "instant", top });
  navigation.expected = host.scrollTop;
}
function retarget(host, navigation) {
  // Re-aiming a smooth scroll restarts its easing; the landing check corrects it.
  if (navigation.moving) return;
  const top = anchorTop(host, navigation.anchor, false);
  if (top !== null) place(host, navigation, top);
}

export function navigateToAnchor(
  host,
  anchor,
  { expand = false, behavior = "instant" } = {},
) {
  const smooth = behavior === "smooth";
  const under = navigations.get(host);
  // The same position asked for again while it is being held (a mode
  // switch lands before its first frame and again after it): the
  // navigation under way already re-aims as the page settles.
  if (
    under?.anchor === anchor &&
    !smooth &&
    !under.moving &&
    (under.expanded || !expand) &&
    under.expected !== null &&
    Math.abs(host.scrollTop - under.expected) <= 2
  )
    return;
  under?.stop();
  // Unfold first (it changes layout), prepare the destination, then measure.
  if (anchorTop(host, anchor, expand) === null) return;
  prepareDestination(host, anchor, smooth);
  const top = anchorTop(host, anchor, false);
  if (top === null) return;
  const view = host.ownerDocument.defaultView;
  const navigation = {
    anchor,
    moving: smooth,
    expanded: expand,
    expected: null,
    corrections: 0,
  };
  let quiet = null;
  const moved = () =>
    navigation.expected !== null &&
    Math.abs(host.scrollTop - navigation.expected) > 2;
  const settle = () => {
    if (navigations.get(host) !== navigation) return;
    // Anything else that scrolled after landing (code, scrollbar, anchoring) wins.
    if (!navigation.moving && moved()) return navigation.stop();
    navigation.moving = false;
    delete host.dataset.navigating;
    const next = anchorTop(host, anchor, false);
    if (next === null) return navigation.stop();
    const goal = Math.max(
      0,
      Math.min(host.scrollHeight - host.clientHeight, next),
    );
    if (Math.abs(goal - host.scrollTop) > 2 && navigation.corrections++ < 8) {
      place(host, navigation, goal);
      view.requestAnimationFrame(() => view.requestAnimationFrame(settle));
      return;
    }
    navigation.expected = host.scrollTop;
    // Stay armed briefly so late formula batches or table widths still re-aim.
    clearTimeout(quiet);
    quiet = setTimeout(() => navigation.stop(), 500);
  };
  // A scrollend can arrive while the glide is still running (e.g. after the
  // destination hold above); land only once the position has stopped changing.
  const onEnd = () => {
    if (!navigation.moving) return settle();
    const at = host.scrollTop;
    view.requestAnimationFrame(() =>
      view.requestAnimationFrame(() => {
        if (host.scrollTop === at) settle();
      }),
    );
  };
  const cancel = () => navigation.stop();
  const onScroll = () => {
    if (!navigation.moving && moved()) navigation.stop();
  };
  const inputs = ["wheel", "pointerdown", "touchstart", "keydown"];
  navigation.stop = () => {
    clearTimeout(quiet);
    clearTimeout(navigation.timeout);
    if (navigations.get(host) === navigation) delete host.dataset.navigating;
    host.removeEventListener("scrollend", onEnd);
    host.removeEventListener("scroll", onScroll);
    for (const name of inputs)
      host.ownerDocument.removeEventListener(name, cancel, true);
    if (navigations.get(host) === navigation) navigations.delete(host);
  };
  navigations.set(host, navigation);
  // Placeholder styling for not-yet-rendered formulas while gliding (CSS).
  if (smooth) host.dataset.navigating = "";
  host.addEventListener("scrollend", onEnd);
  host.addEventListener("scroll", onScroll, { passive: true });
  // A user gesture takes over; never fight manual scrolling.
  for (const name of inputs)
    host.ownerDocument.addEventListener(name, cancel, {
      capture: true,
      passive: true,
    });
  navigation.timeout = setTimeout(() => navigation.stop(), 6000);
  const before = host.scrollTop;
  if (smooth) host.scrollTo({ behavior, top });
  else place(host, navigation, top);
  // Instant or no-op scrolls may not produce a scrollend; verify on the next frames.
  if (
    !smooth ||
    (Math.abs(host.scrollTop - before) < 1 && Math.abs(top - before) < 1)
  )
    view.requestAnimationFrame(() => view.requestAnimationFrame(settle));
}

// Where the last instant reading-position correction left each scroller.
// Idle backfills pause while the reader scrolls; their own corrections (a
// formula above the reading line grew) must not count as scrolling, or a
// backfill deep in a long note waits 250 ms after every batch.
const corrections = new WeakMap();
export function isCorrection(host) {
  const at = corrections.get(host);
  return at !== undefined && Math.abs(host.scrollTop - at) < 1;
}
export function restoreAnchor(
  host,
  anchor,
  { expand = false, behavior = "instant" } = {},
) {
  const navigation = navigations.get(host);
  // Scrolled by something else since it landed, before that scroll's event
  // stopped the navigation: that place wins, as in settle.
  if (
    navigation &&
    !navigation.moving &&
    navigation.expected !== null &&
    Math.abs(host.scrollTop - navigation.expected) > 2
  )
    navigation.stop();
  else if (navigation) return retarget(host, navigation);
  if (!anchor || anchor.top) {
    host.scrollTop = 0;
    return;
  }
  const top = anchorTop(host, anchor, expand);
  if (top === null) return;
  host.scrollTo({ behavior, top });
  if (behavior === "instant") corrections.set(host, host.scrollTop);
}
