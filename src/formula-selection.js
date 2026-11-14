// A formula is selected, copied and formatted whole, so it is shown selected
// whole: one flat box in the selection colour (style.css) instead of the
// browser's selection painted glyph by glyph (KaTeX's boxes of every height,
// with gaps). CSS cannot tell which formulas a selection crosses, so the
// formulas it crosses carry an attribute while it does.
//
// The attribute is the page's own: the preview cache does not count it
// (render-cache.js), and copies leave it out (copy-source.js).
export const FORMULAS = ".formula, .math-block";
export const SELECTED = "data-selected-whole";

// The range takes in some of the formula's content, not only reaches its edge.
function crosses(range, formula) {
  const inner = formula.ownerDocument.createRange();
  inner.selectNodeContents(formula);
  return (
    range.compareBoundaryPoints(Range.START_TO_END, inner) > 0 &&
    range.compareBoundaryPoints(Range.END_TO_START, inner) < 0
  );
}

// The child of `parent` holding `node`.
function childOf(parent, node) {
  while (node.parentNode !== parent) node = node.parentNode;
  return node;
}

// The formulas in `node` the range crosses. Only the children between the
// range's ends are looked at: the ones wholly inside are taken with all their
// formulas, the (at most two) at the ends are looked into the same way. A
// short selection in a long note looks at a few nodes, not at the note.
function gather(node, range, out) {
  if (node.matches(FORMULAS)) {
    if (crosses(range, node)) out.add(node);
    return;
  }
  const { startContainer, startOffset, endContainer, endOffset } = range;
  let first = node.firstChild,
    last = node.lastChild,
    firstPart = false,
    lastPart = false;
  if (startContainer === node) first = node.childNodes[startOffset];
  else if (node.contains(startContainer)) {
    first = childOf(node, startContainer);
    firstPart = true;
  }
  if (endContainer === node) last = node.childNodes[endOffset - 1];
  else if (node.contains(endContainer)) {
    last = childOf(node, endContainer);
    lastPart = true;
  }
  if (!first || !last) return;
  for (let child = first; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      if ((child === first && firstPart) || (child === last && lastPart))
        gather(child, range, out);
      else if (child.matches(FORMULAS)) out.add(child);
      else
        for (const formula of child.querySelectorAll(FORMULAS))
          out.add(formula);
    }
    if (child === last) break;
  }
}

export function formulasIn(range) {
  const out = new Set();
  if (range.collapsed) return out;
  let root = range.commonAncestorContainer;
  if (root.nodeType !== 1) root = root.parentElement;
  if (!root) return out;
  gather(root.closest(FORMULAS) || root, range, out);
  return out;
}

export function trackFormulaSelection(doc = document) {
  const view = doc.defaultView;
  let marked = new Set(),
    frame = 0;
  function update() {
    frame = 0;
    const selection = doc.getSelection(),
      next = new Set();
    if (selection && !selection.isCollapsed)
      for (let i = 0; i < selection.rangeCount; i++)
        for (const formula of formulasIn(selection.getRangeAt(i)))
          next.add(formula);
    for (const formula of marked)
      if (!next.has(formula)) formula.removeAttribute(SELECTED);
    for (const formula of next)
      if (!marked.has(formula)) formula.setAttribute(SELECTED, "");
    marked = next;
  }
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(update);
  };
  doc.addEventListener("selectionchange", schedule);
  return {
    update,
    destroy() {
      doc.removeEventListener("selectionchange", schedule);
      if (frame) view.cancelAnimationFrame(frame);
      for (const formula of marked) formula.removeAttribute(SELECTED);
      marked = new Set();
    },
  };
}
