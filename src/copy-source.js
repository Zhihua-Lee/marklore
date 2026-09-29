import { textOffset } from "./positions.js";

// Copying from the rendered note puts the Markdown behind the selection on the
// clipboard: formulas, links, emphasis and tables paste as their source rather
// than as rendered glyphs (KaTeX's visible text reads "x2" for $x^2$).
// Ctrl+Shift+C keeps a rendered copy (HTML plus clean text) for rich editors.

// Rendered units whose text does not map character by character to source:
// a boundary inside one takes the whole unit.
const atomic = ".formula[data-from], .math-block[data-from], pre[data-from]";
// Not part of the note's text.
const chrome =
  ".katex-mathml, .code-toolbar, .table-sort, .section-summary, .fold, input";
// Note text only: no control labels, no layout whitespace between blocks.
const readable = {
  acceptNode: (node) =>
    !node.data.trim() || node.parentElement?.closest(chrome + ", button")
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT,
};
const texts = (root) =>
  document.createTreeWalker(root, NodeFilter.SHOW_TEXT, readable);

function clipped(host) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!range.intersectsNode(host)) return null;
  if (!host.contains(range.startContainer)) range.setStart(host, 0);
  if (!host.contains(range.endContainer))
    range.setEnd(host, host.childNodes.length);
  return range;
}

// The text node where a boundary falls, walking into element positions:
// forwards for the start, backwards for the end.
function textPoint(host, container, offset, edge) {
  if (container.nodeType === Node.TEXT_NODE) return { node: container, offset };
  const walker = texts(host);
  const child = container.childNodes[offset];
  if (edge === "start") {
    walker.currentNode = child || container;
    const node = child?.nodeType === Node.TEXT_NODE ? child : null;
    const next = node || (child ? firstText(child) : null) || walker.nextNode();
    return next ? { node: next, offset: 0 } : null;
  }
  const before = container.childNodes[offset - 1];
  const last = before ? lastText(before) : null;
  if (last) return { node: last, offset: last.length };
  walker.currentNode = before || container;
  const previous = walker.previousNode();
  return previous ? { node: previous, offset: previous.length } : null;
}
function firstText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node;
  return texts(node).nextNode();
}
function lastText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node;
  const walker = texts(node);
  let last = null;
  while (walker.nextNode()) last = walker.currentNode;
  return last;
}

function sourceAt(host, point, edge) {
  const element = point.node.parentElement;
  const unit = element?.closest(atomic);
  if (unit && host.contains(unit))
    return Number(edge === "start" ? unit.dataset.from : unit.dataset.to);
  const leaf = element?.closest("[data-text-from]");
  if (leaf && host.contains(leaf))
    return (
      Number(leaf.dataset.textFrom) + textOffset(leaf, point.node, point.offset)
    );
  const block = element?.closest("[data-from]");
  if (!block || !host.contains(block)) return null;
  return Number(edge === "start" ? block.dataset.from : block.dataset.to);
}

// Source range [from, to) plus marker ranges to drop, or null when the
// selection has no usable mapping (then the browser's own copy applies).
export function selectedSource(host, source) {
  const range = clipped(host);
  if (!range) return null;
  const start = textPoint(
      host,
      range.startContainer,
      range.startOffset,
      "start",
    ),
    end = textPoint(host, range.endContainer, range.endOffset, "end");
  if (!start || !end) return null;
  // Inside a single code block the rendered text already is the source.
  const code = start.node.parentElement?.closest("pre[data-from]");
  if (code && code === end.node.parentElement?.closest("pre[data-from]"))
    return null;
  // A view-sorted table no longer matches the source row order.
  for (const point of [start, end])
    if (point.node.parentElement?.closest('table[data-view-sorted="true"]'))
      return null;
  let from = sourceAt(host, start, "start"),
    to = sourceAt(host, end, "end");
  if (from === null || to === null || to <= from) return null;
  // Taking a block's whole text takes its line prefix too ("## ", "- [ ] ",
  // "> ", "| "); a word at its start stays just the word.
  const block = start.node.parentElement?.closest("[data-from]:not(.formula)");
  const first = block && host.contains(block) && firstText(block),
    last = first && lastText(block);
  if (first && last) {
    const lead = first.data.length - first.data.trimStart().length,
      head = sourceAt(host, { node: first, offset: lead }, "start"),
      tail = sourceAt(host, { node: last, offset: last.length }, "end");
    if (head !== null && tail !== null && from <= head && to >= tail)
      from = Math.min(from, Number(block.dataset.from));
  }
  // Whole inline constructs keep their markers; cut ones lose them.
  const cuts = [];
  let grown = true;
  while (grown) {
    grown = false;
    for (const node of host.querySelectorAll("[data-src-from]")) {
      if (!range.intersectsNode(node)) continue;
      const outerFrom = Number(node.dataset.srcFrom),
        outerTo = Number(node.dataset.srcTo),
        innerFrom = Number(node.dataset.srcInnerFrom),
        innerTo = Number(node.dataset.srcInnerTo);
      // Images have no text of their own: any overlap takes the whole image.
      if ((from <= innerFrom && to >= innerTo) || node.tagName === "IMG") {
        if (from > outerFrom || to < outerTo) {
          from = Math.min(from, outerFrom);
          to = Math.max(to, outerTo);
          grown = true;
        }
      }
    }
  }
  for (const node of host.querySelectorAll("[data-src-from]")) {
    if (!range.intersectsNode(node)) continue;
    const innerFrom = Number(node.dataset.srcInnerFrom),
      innerTo = Number(node.dataset.srcInnerTo);
    if ((from <= innerFrom && to >= innerTo) || node.tagName === "IMG")
      continue;
    cuts.push(
      [Number(node.dataset.srcFrom), innerFrom],
      [innerTo, Number(node.dataset.srcTo)],
    );
  }
  let text = "",
    at = from;
  for (const [cutFrom, cutTo] of cuts
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])) {
    if (cutFrom > at) text += source.slice(at, cutFrom);
    at = Math.max(at, cutTo);
  }
  text += source.slice(at, to);
  return { from, to, text: text.replace(/\n+$/, "") };
}

function renderedCopy(range) {
  const holder = document.createElement("div");
  holder.append(range.cloneContents());
  for (const node of holder.querySelectorAll(chrome)) node.remove();
  const html = holder.innerHTML;
  holder.style.cssText =
    "position:fixed;left:-99999px;top:0;white-space:normal";
  document.body.append(holder);
  const text = holder.innerText;
  holder.remove();
  return { html, text };
}

export function wireSourceCopy({ host, source, skip = () => false }) {
  let rendered = false;
  host.ownerDocument.addEventListener("copy", (event) => {
    const range = clipped(host);
    if (!range || skip(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, [contenteditable], .block-editor"))
      return;
    if (rendered) {
      rendered = false;
      const { html, text } = renderedCopy(range);
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      return;
    }
    const text = source();
    const selected = typeof text === "string" && selectedSource(host, text);
    if (!selected) return;
    event.clipboardData.setData("text/plain", selected.text);
    event.preventDefault();
  });
  host.ownerDocument.addEventListener("keydown", (event) => {
    if (
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      event.code === "KeyC" &&
      clipped(host)
    ) {
      event.preventDefault();
      rendered = true;
      document.execCommand("copy");
      rendered = false;
    }
  });
}
