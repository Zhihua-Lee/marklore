import { isolateHistory, undo, redo } from "@codemirror/commands";
import { markdownEdit } from "./markdown-edits.js";
import { textOffset, findPosition } from "./positions.js";
import { wireColorButton, closeColorPicker } from "./color-picker.js";
import { icon } from "./icons.js";
import { t } from "../desktop/i18n.mjs";
import { attachLinkPicker } from "./link-picker.js";
import "./selection-tools.css";

// Blocks whose text can be formatted, and inline elements that come from
// Markdown (strong, em, links, code...) or from inline HTML in the source.
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,td,th,li,dt,dd";
const INLINE =
  "strong,em,s,del,a,code,mark,span,u,sub,sup,kbd,ins,small,b,i,.formula";
const OFF_LIMITS = "pre,button,summary,input,.block-editor,.math-block";
// What each action would nest inside itself: wrapping again is a toggle.
const SAME_KIND = {
  bold: "strong,b",
  italic: "em,i",
  strike: "s,del",
  highlight: "mark",
  color: "span[style*='color']",
};

// A mapped run of plain text. An inline code element carries a text map too,
// but it is an element with markers: it is always handled whole.
const isLeaf = (el) => el.hasAttribute("data-text-from") && !el.matches("code");
const inFormula = (el) => {
  const formula = el.closest(".formula");
  return formula && formula !== el;
};
function inlineElement(el) {
  return el.matches(INLINE) && !isLeaf(el) && !inFormula(el);
}

// Source span of the mapped text inside an element.
function innerSpan(el) {
  if (el.dataset.srcInnerFrom != null && el.dataset.srcInnerTo != null)
    return [Number(el.dataset.srcInnerFrom), Number(el.dataset.srcInnerTo)];
  let from = Infinity,
    to = -Infinity;
  // Plain text runs, and elements with known markers (code, emphasis,
  // formulas) by their outer edges.
  for (const part of el.querySelectorAll(`[data-text-from], ${INLINE}`)) {
    if (inFormula(part)) continue;
    const span = isLeaf(part)
      ? [Number(part.dataset.textFrom), Number(part.dataset.textTo)]
      : part.matches(".formula") || part.dataset.srcFrom != null
        ? outerSpan(part, "")
        : null;
    if (!span) continue;
    from = Math.min(from, span[0]);
    to = Math.max(to, span[1]);
  }
  return from < to ? [from, to] : null;
}
// Source span of an inline element, including its markers or tags.
function outerSpan(el, text) {
  if (el.matches(".formula[data-from][data-to]"))
    return [Number(el.dataset.from), Number(el.dataset.to)];
  if (el.dataset.srcFrom != null && el.dataset.srcTo != null)
    return [Number(el.dataset.srcFrom), Number(el.dataset.srcTo)];
  // Inline HTML written by the author (<mark>, <span style>, <sub>...).
  const inner = innerSpan(el);
  if (!inner) return null;
  const tag = el.tagName.toLowerCase();
  const open = text.lastIndexOf("<" + tag, inner[0]);
  const opening =
    open < 0
      ? null
      : text.slice(open).match(new RegExp(`^<${tag}\\b[^>]*>`, "i"));
  const close = text.indexOf("</" + tag, inner[1]);
  const end = close < 0 ? -1 : text.indexOf(">", close);
  if (!opening || open + opening[0].length > inner[0] || end < 0) return null;
  return [open, end + 1];
}

// The source position of a DOM point between pieces of mapped text.
function pointPosition(node, offset, end, text) {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const leaf = element?.closest("[data-text-from]");
  if (leaf)
    return Number(leaf.dataset.textFrom) + textOffset(leaf, node, offset);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  let child = node.childNodes[end ? offset - 1 : offset];
  while (child) {
    if (child.nodeType === Node.TEXT_NODE)
      return pointPosition(child, end ? child.length : 0, end, text);
    if (child.nodeType === Node.ELEMENT_NODE) {
      if (inlineElement(child)) {
        const span = outerSpan(child, text);
        if (span) return span[end ? 1 : 0];
      }
      if (isLeaf(child))
        return pointPosition(
          child,
          end ? child.childNodes.length : 0,
          end,
          text,
        );
    }
    child = end ? child.lastChild : child.firstChild;
  }
  return null;
}

// One end of the selection in the source. A point inside a link, code span,
// formula or emphasis that does not also hold the other end moves to that
// element's outer edge, so formatting never cuts through Markdown syntax.
// Formulas and code spans are always whole.
function selectionEnd(range, end, other, block, text) {
  const node = end ? range.endContainer : range.startContainer,
    offset = end ? range.endOffset : range.startOffset;
  let target = null;
  for (
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    el && el !== block && block.contains(el);
    el = el.parentElement
  ) {
    if (!inlineElement(el)) continue;
    if (el.matches(".formula,code") || !el.contains(other)) target = el;
  }
  if (target) {
    const span = outerSpan(target, text);
    if (!span) return null;
    if (end) range.setEndAfter(target);
    else range.setStartBefore(target);
    return span[end ? 1 : 0];
  }
  return pointPosition(node, offset, end, text);
}

// The source span of a block's own text (not that of blocks nested in it).
function blockSpan(block, text) {
  let from = Infinity,
    to = -Infinity;
  for (const part of block.querySelectorAll(`[data-text-from], ${INLINE}`)) {
    if (part.closest(BLOCKS) !== block || inFormula(part)) continue;
    const span = isLeaf(part)
      ? [Number(part.dataset.textFrom), Number(part.dataset.textTo)]
      : outerSpan(part, text);
    if (!span) continue;
    from = Math.min(from, span[0]);
    to = Math.max(to, span[1]);
  }
  return from < to ? [from, to] : null;
}

// Inside an author HTML attribute, a source map is not trustworthy.
function insideTag(text, block, from) {
  const blockFrom = Number(block.closest("[data-from]")?.dataset.from) || 0;
  const prefix = text.slice(blockFrom, from);
  const opening = prefix.lastIndexOf("<");
  return (
    opening > prefix.lastIndexOf(">") &&
    /^<\/?[A-Za-z][\w:-]*(?:\s|$)/.test(prefix.slice(opening))
  );
}

// editable(doc): the mode allows formatting from the page (Edit mode, or Read
// mode once the reader turns on its format bar).
export function previewTextSelection(
  content,
  doc,
  editable = (d) => d.mode === "edit",
) {
  const selected = window.getSelection();
  if (
    !doc ||
    !editable(doc) ||
    doc.previewText !== doc.text ||
    !selected?.rangeCount ||
    selected.isCollapsed ||
    !selected.toString().trim()
  )
    return null;
  const text = doc.text;
  const range = selected.getRangeAt(0).cloneRange();
  const element = (node) =>
    node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const startNode = range.startContainer,
    endNode = range.endContainer;
  const startBlock = element(startNode)?.closest(BLOCKS),
    endBlock = element(endNode)?.closest(BLOCKS);
  if (
    !startBlock ||
    !endBlock ||
    !content.contains(startBlock) ||
    !content.contains(endBlock) ||
    element(startNode).closest(OFF_LIMITS) ||
    element(endNode).closest(OFF_LIMITS)
  )
    return null;
  const from = selectionEnd(range, false, endNode, startBlock, text),
    to = selectionEnd(range, true, startNode, endBlock, text);
  if (from == null || to == null || to <= from) return null;

  // One segment per block: inline formatting cannot span paragraphs.
  let segments;
  if (startBlock === endBlock) segments = [{ from, to, block: startBlock }];
  else {
    segments = [];
    for (const block of content.querySelectorAll(BLOCKS)) {
      if (!range.intersectsNode(block) || block.closest(OFF_LIMITS)) continue;
      const span = blockSpan(block, text);
      if (!span) continue;
      const a = block === startBlock ? from : span[0],
        b = block === endBlock ? to : span[1];
      if (b > a) segments.push({ from: a, to: b, block });
    }
    segments.sort((x, y) => x.from - y.from);
  }
  if (!segments.length) return null;
  for (let i = 0; i < segments.length; i++) {
    const { from: a, to: b, block } = segments[i];
    if (
      text.slice(a, b).includes("\n\n") ||
      insideTag(text, block, a) ||
      (i && a < segments[i - 1].to)
    )
      return null;
  }

  // What the selection holds, and the formatting around both of its ends.
  const whole = (el) => {
    const span = document.createRange();
    span.selectNode(el);
    return (
      range.compareBoundaryPoints(Range.START_TO_START, span) <= 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, span) >= 0
    );
  };
  const inside = [...content.querySelectorAll(INLINE)].filter(
    (el) => !inFormula(el) && range.intersectsNode(el) && whole(el),
  );
  const around = [];
  for (
    let el = range.commonAncestorContainer;
    el && el !== content;
    el = el.parentNode
  )
    if (el.nodeType === Node.ELEMENT_NODE && inlineElement(el)) around.push(el);
  return {
    from: segments[0].from,
    to: segments.at(-1).to,
    segments,
    range,
    inside,
    around,
    multi: segments.length > 1,
    hasMath: inside.some((el) => el.matches(".formula")),
    hasLink:
      inside.some((el) => el.matches("a")) ||
      around.some((el) => el.matches("a")),
    hasMarkup: inside.length > 0,
    doc,
    text,
  };
}

// The change for one segment. Wrapping in a formatting the text already has
// in part removes the inner copies first; a selection inside an element of
// the same kind (part of a bold run, then Bold) acts on that whole element.
function segmentEdit(s, segment, action, options) {
  const { text } = s;
  let { from, to } = segment;
  const kind = SAME_KIND[action];
  if (kind && !s.multi) {
    const own = s.around.find((el) => el.matches(kind));
    const span = own && innerSpan(own);
    if (span) [from, to] = span;
  }
  let body = text.slice(from, to);
  if (kind && action !== "highlight" && action !== "color") {
    const cuts = [];
    for (const el of s.inside) {
      if (!el.matches(kind) || el.dataset.srcFrom == null) continue;
      const outer = [Number(el.dataset.srcFrom), Number(el.dataset.srcTo)],
        inner = innerSpan(el);
      if (!inner || outer[0] < from || outer[1] > to) continue;
      if (outer[0] === from && outer[1] === to) continue; // whole: toggles off
      cuts.push([outer[0], inner[0]], [inner[1], outer[1]]);
    }
    if (cuts.length)
      body = [...body]
        .filter((_, i) => !cuts.some(([a, b]) => from + i >= a && from + i < b))
        .join("");
  }
  const virtual = text.slice(0, from) + body + text.slice(to);
  const result = markdownEdit(virtual, from, from + body.length, action, {
    ...options,
    inlineRange: true,
  });
  const shift = to - from - body.length,
    change = result.changes;
  return {
    change: {
      from: change.from,
      to: change.to >= from + body.length ? change.to + shift : change.to,
      insert: change.insert,
    },
    selection: result.selection,
  };
}

export function createSelectionTools({
  content,
  reader,
  view,
  getDocument,
  blocked,
  render,
  report,
  editable = (doc) => doc.mode === "edit",
  getLinkTargets = null,
}) {
  const bar = document.createElement("div");
  bar.className = "selection-tools";
  bar.hidden = true;
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t("选中文字格式"));
  const actions = [
    ["bold", t("加粗"), "<b>B</b>"],
    ["italic", t("斜体"), "<i>I</i>"],
    ["strike", t("删除线"), "<s>S</s>"],
    ["highlight", t("高亮"), icon("highlight")],
    ["color", t("文字颜色"), icon("textColor")],
    ["link", t("链接"), icon("link")],
    ["inline", t("行内代码"), "&lt;/&gt;"],
  ];
  bar.innerHTML = `<div class="selection-actions">${actions.map(([action, label, body]) => `<button type="button" data-selection-action="${action}" aria-label="${label}" title="${label}">${body}</button>`).join("")}</div><form hidden><input name="url" aria-label="${t("链接地址")}" placeholder="${t("https://… 或 note.md")}" required><button type="submit" aria-label="${t("应用链接")}">${icon("link")}</button></form>`;
  document.body.append(bar);
  let snapshot = null,
    dragging = false,
    timer = 0;
  const form = bar.querySelector("form");
  function hide() {
    clearTimeout(timer);
    if (bar.hidden && !snapshot) return;
    if (bar.querySelector('[aria-expanded="true"]')) closeColorPicker();
    bar.hidden = true;
    snapshot = null;
    form.hidden = true;
  }
  function valid(s) {
    return (
      s &&
      s.doc === getDocument() &&
      editable(s.doc) &&
      s.text === s.doc.text &&
      s.text === view.state.doc.toString() &&
      !blocked() &&
      s.range.startContainer.isConnected
    );
  }
  function position() {
    if (!valid(snapshot)) return hide();
    const rects = [...snapshot.range.getClientRects()];
    const viewport = reader.getBoundingClientRect();
    const r = rects.find(
      (rect) => rect.bottom > viewport.top && rect.top < viewport.bottom,
    );
    if (!r) return hide();
    bar.hidden = false;
    const left = Math.max(8, viewport.left + 6);
    const right = Math.min(innerWidth - 8, viewport.right - 6);
    bar.style.maxWidth = Math.max(160, right - left) + "px";
    bar.style.left =
      Math.max(left, Math.min(r.left, right - bar.offsetWidth)) + "px";
    const above = r.top - bar.offsetHeight - 8;
    bar.style.top =
      Math.max(
        viewport.top + 4,
        Math.min(
          innerHeight - bar.offsetHeight - 8,
          above >= viewport.top + 4 ? above : r.bottom + 8,
        ),
      ) + "px";
  }
  // Why a link or code span cannot wrap this selection, if it cannot.
  function unavailable(action, s) {
    if (action === "link") {
      if (s.multi) return t("跨段落的选区不能加链接");
      if (s.hasLink) return t("选区中已有链接");
      if (s.hasMath) return t("含公式的选区请使用文字样式或颜色工具");
    }
    if (action === "inline") {
      if (s.multi) return t("跨段落的选区不能转为行内代码");
      if (s.hasMarkup) return t("含格式的选区不能转为行内代码");
    }
    return "";
  }
  function refresh() {
    if (
      dragging ||
      bar.contains(document.activeElement) ||
      bar.querySelector('[aria-expanded="true"]')
    )
      return;
    if (blocked() || document.querySelector("dialog[open]")) return hide();
    snapshot = previewTextSelection(content, getDocument(), editable);
    if (!snapshot) return hide();
    for (const action of ["inline", "link"]) {
      const button = bar.querySelector(`[data-selection-action="${action}"]`);
      const reason = unavailable(action, snapshot);
      button.disabled = Boolean(reason);
      button.title = reason || button.getAttribute("aria-label");
    }
    position();
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 90);
  }
  function reselect(from, to) {
    const first = findPosition(content, from),
      last = findPosition(content, to - 1);
    if (
      (!first?.range && !first?.element.matches(".formula")) ||
      (!last?.range && !last?.element.matches(".formula"))
    )
      return;
    const range = document.createRange();
    if (first.range)
      range.setStart(first.range.startContainer, first.range.startOffset);
    else range.setStartBefore(first.element);
    if (last.range) range.setEnd(last.range.endContainer, last.range.endOffset);
    else range.setEndAfter(last.element);
    const selected = window.getSelection();
    reader.focus({ preventScroll: true });
    selected.removeAllRanges();
    selected.addRange(range);
    refresh();
  }
  function apply(action, options = {}, s = snapshot) {
    if (!valid(s)) {
      hide();
      return;
    }
    if (unavailable(action, s)) return;
    try {
      // Every block's change from the same text: one step to undo.
      const edits = s.segments.map((segment) =>
        segmentEdit(s, segment, action, options),
      );
      let shift = 0;
      for (const edit of edits.slice(0, -1))
        shift +=
          edit.change.insert.length - (edit.change.to - edit.change.from);
      const anchor = edits[0].selection.anchor,
        head = edits.at(-1).selection.head + shift;
      hide();
      view.dispatch({
        changes: edits.map((edit) => edit.change),
        selection: { anchor, head },
        annotations: isolateHistory.of("full"),
        userEvent: "input.format",
      });
      s.doc.pane = "preview";
      render();
      reselect(anchor, head);
    } catch (error) {
      report(error.message);
    }
  }
  function execute(action) {
    if (snapshot && unavailable(action, snapshot)) return;
    if (action === "link") {
      form.hidden = !form.hidden;
      form.reset();
      position();
      if (!form.hidden) form.elements.url.focus({ preventScroll: true });
    } else apply(action);
  }
  bar.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selection-action]");
    if (button) execute(button.dataset.selectionAction);
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    apply("link", { url: form.elements.url.value });
  };
  // Choosing a note's anchor (or a note twice) links the selection at once.
  if (getLinkTargets)
    attachLinkPicker(form.elements.url, {
      getTargets: () => getLinkTargets(getDocument()),
      onPick: (pick) => {
        if (pick.final) apply("link", { url: pick.href });
      },
    });
  for (const action of ["highlight", "color"]) {
    wireColorButton(
      bar.querySelector(`[data-selection-action="${action}"]`),
      action,
      () => {
        const s = snapshot;
        if (!valid(s)) return null;
        return { apply: (options) => apply(action, options, s), focus() {} };
      },
    );
  }
  document.addEventListener("selectionchange", refresh);
  document.addEventListener("pointerdown", (event) => {
    if (
      bar.contains(event.target) ||
      event.target.closest(".text-color-picker")
    )
      return;
    hide();
    dragging = content.contains(event.target);
  });
  document.addEventListener("pointerup", () => {
    const selecting = dragging;
    dragging = false;
    if (selecting) schedule();
  });
  document.addEventListener("pointercancel", () => {
    dragging = false;
    hide();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !bar.hidden &&
      !event.target.closest(".text-color-picker")
    ) {
      event.preventDefault();
      const focused = bar.contains(document.activeElement);
      hide();
      window.getSelection()?.removeAllRanges();
      if (focused) reader.focus({ preventScroll: true });
      return;
    }
    if (
      event.target.closest("input,textarea,.cm-editor") ||
      !reader.contains(event.target)
    )
      return;
    if (event.altKey && event.key === "F10" && !bar.hidden) {
      event.preventDefault();
      bar.querySelector("button").focus();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (
      getDocument() &&
      editable(getDocument()) &&
      !blocked() &&
      ["z", "y"].includes(key)
    ) {
      event.preventDefault();
      hide();
      (key === "y" || event.shiftKey ? redo : undo)(view);
      render();
      reader.focus({ preventScroll: true });
      return;
    }
    const action = { b: "bold", i: "italic", e: "inline", k: "link" }[key];
    if (action && valid(snapshot)) {
      event.preventDefault();
      execute(action);
    }
  });
  reader.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  return { hide };
}
