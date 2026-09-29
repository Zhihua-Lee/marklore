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
export function atPoint(host, x, y) {
  return underShield(() => pointSource(host, x, y));
}
function pointSource(host, x, y) {
  const caret = document.caretPositionFromPoint?.(x, y);
  const range = !caret && document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode || range?.startContainer,
    offset = caret?.offset ?? range?.startOffset;
  const leaf = node?.parentElement?.closest("[data-text-from]");
  if (leaf && host.contains(leaf))
    return {
      from: Number(leaf.dataset.textFrom) + textOffset(leaf, node, offset),
      exact: true,
    };
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
    const hit = atPoint(host, x, y);
    if (hit?.exact) return { ...hit, y: 32 };
    const block = document.elementFromPoint(x, y)?.closest("[data-from]");
    if (block && host.contains(block)) visibleBlock = block;
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
  let el = null,
    r = null;
  // Stop at the first visible block crossing the viewport anchor. Filtering the
  // whole document first measured every block on each session/scroll capture.
  for (const candidate of host.querySelectorAll("[data-from]")) {
    if (!candidate.getClientRects().length) continue;
    el = candidate;
    r = candidate.getBoundingClientRect();
    if (r.bottom > y) break;
  }
  if (!el) return { from: 0, y: 0, top: true };
  const fraction = Math.max(
    0,
    Math.min(1, (y - r.top) / Math.max(1, r.height)),
  );
  return { from: Number(el.dataset.from), fraction, y: 32 };
}
export function findPosition(host, from) {
  const leaves = [...host.querySelectorAll("[data-text-from]")];
  const leaf = leaves.find(
    (el) =>
      Number(el.dataset.textFrom) <= from && Number(el.dataset.textTo) > from,
  );
  if (leaf) {
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
    let remaining = from - Number(leaf.dataset.textFrom),
      node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) {
        const r = document.createRange();
        r.setStart(node, remaining);
        r.setEnd(node, Math.min(node.length, remaining + 1));
        return { element: leaf, range: r };
      }
      remaining -= node.length;
    }
  }
  let best = null;
  for (const el of host.querySelectorAll("[data-from]")) {
    const start = Number(el.dataset.from),
      end = Number(el.dataset.to);
    if (
      start <= from &&
      from < end &&
      (!best ||
        end - start < Number(best.dataset.to) - Number(best.dataset.from))
    )
      best = el;
  }
  if (!best)
    best = [...host.querySelectorAll("[data-from]")]
      .filter((el) => Number(el.dataset.from) <= from)
      .at(-1);
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
function prepareDestination(host, anchor) {
  if (!anchor || anchor.top) return;
  const element = anchorHit(host, anchor)?.element;
  if (!element?.getClientRects().length) return;
  // Growth above the current screen (upward jumps) must not move what is shown.
  const keep = visibleAnchor(host);
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
  const held = anchorTop(host, keep, false);
  if (held !== null && !keep.top)
    host.scrollTo({ behavior: "instant", top: held });
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
  navigations.get(host)?.stop();
  // Unfold first (it changes layout), prepare the destination, then measure.
  if (anchorTop(host, anchor, expand) === null) return;
  prepareDestination(host, anchor);
  const top = anchorTop(host, anchor, false);
  if (top === null) return;
  const view = host.ownerDocument.defaultView;
  const smooth = behavior === "smooth";
  const navigation = { anchor, moving: smooth, expected: null, corrections: 0 };
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

export function restoreAnchor(
  host,
  anchor,
  { expand = false, behavior = "instant" } = {},
) {
  const navigation = navigations.get(host);
  if (navigation) return retarget(host, navigation);
  if (!anchor || anchor.top) {
    host.scrollTop = 0;
    return;
  }
  const top = anchorTop(host, anchor, expand);
  if (top !== null) host.scrollTo({ behavior, top });
}
