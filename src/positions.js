import { setSectionCollapsed } from "./sections.js";

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
export function atPoint(host, x, y) {
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
  return {
    from:
      Number(start.dataset.textFrom) +
      textOffset(start, range.startContainer, range.startOffset),
    to:
      Number(end.dataset.textFrom) +
      textOffset(end, range.endContainer, range.endOffset),
  };
}
export function visibleAnchor(host) {
  if (host.scrollTop < 2) return { from: 0, y: 0, top: true };
  const rect = host.getBoundingClientRect(),
    y = rect.top + 32;
  for (const x of [
    rect.left + 40,
    rect.left + rect.width * 0.3,
    rect.left + rect.width * 0.5,
  ]) {
    const hit = atPoint(host, x, y);
    if (hit?.exact) return { ...hit, y: 32 };
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
    if (el.classList.contains("note-section")) {
      setSectionCollapsed(el, false);
    }
  }
}
export function restoreAnchor(host, anchor, { expand = false } = {}) {
  if (!anchor || anchor.top) {
    host.scrollTop = 0;
    return;
  }
  const hit = findPosition(host, anchor.from);
  if (!hit) return;
  if (expand) unfold(hit.element);
  const rect =
    hit.range?.getBoundingClientRect() || hit.element.getBoundingClientRect();
  if (!hit.element.getClientRects().length) return;
  host.scrollTop +=
    rect.top -
    host.getBoundingClientRect().top +
    (anchor.fraction || 0) * rect.height -
    (anchor.y ?? 32);
}
