import { isolateHistory, undo, redo } from "@codemirror/commands";
import { markdownEdit } from "./markdown-edits.js";
import { textOffset, findPosition } from "./positions.js";
import { wireColorButton, closeColorPicker } from "./color-picker.js";
import { icon } from "./icons.js";
import { t } from "../desktop/i18n.mjs";
import "./selection-tools.css";

// Inline formulas are atomic source spans, never reverse-converted from glyphs.
function boundary(node, offset, end) {
  let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const formula = element?.closest(".formula[data-from][data-to]");
  if (formula)
    return { position: Number(formula.dataset[end ? "to" : "from"]), formula };
  const leaf = element?.closest("[data-text-from]");
  if (leaf)
    return {
      position: Number(leaf.dataset.textFrom) + textOffset(leaf, node, offset),
    };
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  let child = node.childNodes[end ? offset - 1 : offset];
  while (child) {
    if (child.nodeType === Node.TEXT_NODE)
      return boundary(child, end ? child.length : 0, end);
    if (child.matches?.(".formula,[data-text-from]"))
      return boundary(child, end ? child.childNodes.length : 0, end);
    child = end ? child.lastChild : child.firstChild;
  }
  return null;
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
    selected.isCollapsed
  )
    return null;
  const range = selected.getRangeAt(0).cloneRange();
  const start =
    range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement;
  const end =
    range.endContainer.nodeType === 1
      ? range.endContainer
      : range.endContainer.parentElement;
  const blocked = "code,pre,a,button,summary,.block-editor";
  const block = start?.closest("p,h1,h2,h3,h4,h5,h6,td,th,li");
  if (
    !block ||
    !content.contains(block) ||
    !block.contains(end) ||
    start.closest(blocked) ||
    end.closest(blocked)
  )
    return null;
  const first = boundary(range.startContainer, range.startOffset, false);
  const last = boundary(range.endContainer, range.endOffset, true);
  const source = first && last && { from: first.position, to: last.position };
  if (!source || source.to <= source.from || !selected.toString().trim())
    return null;
  if (first.formula) range.setStartBefore(first.formula);
  if (last.formula) range.setEndAfter(last.formula);
  let cursor = source.from,
    expected = "",
    hasMath = false;
  for (const formula of block.querySelectorAll(
    ".formula[data-from][data-to]",
  )) {
    if (!range.intersectsNode(formula)) continue;
    const from = Number(formula.dataset.from),
      to = Number(formula.dataset.to);
    if (to <= source.from || from >= source.to) continue;
    const raw = doc.text.slice(from, to);
    if (
      from < cursor ||
      to > source.to ||
      !/^(?:\$[\s\S]+\$|\\\([\s\S]+\\\))$/.test(raw)
    )
      return null;
    expected += doc.text.slice(cursor, from) + formula.textContent;
    cursor = to;
    hasMath = true;
  }
  expected += doc.text.slice(cursor, source.to);
  if (expected !== range.toString()) return null;
  // Legacy source maps can be approximate around author HTML attributes.
  const blockFrom = Number(block.closest("[data-from]")?.dataset.from) || 0;
  const prefix = doc.text.slice(blockFrom, source.from);
  const opening = prefix.lastIndexOf("<");
  if (
    opening > prefix.lastIndexOf(">") &&
    /^<\/?[A-Za-z][\w:-]*(?:\s|$)/.test(prefix.slice(opening))
  )
    return null;
  return { ...source, range, hasMath, doc, text: doc.text };
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
      button.disabled = snapshot.hasMath;
      button.title = snapshot.hasMath
        ? t("含公式的选区请使用文字样式或颜色工具")
        : button.getAttribute("aria-label");
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
    try {
      const change = markdownEdit(s.text, s.from, s.to, action, {
        ...options,
        inlineRange: true,
      });
      hide();
      view.dispatch({
        ...change,
        annotations: isolateHistory.of("full"),
        userEvent: "input.format",
      });
      s.doc.pane = "preview";
      render();
      reselect(change.selection.anchor, change.selection.head);
    } catch (error) {
      report(error.message);
    }
  }
  function execute(action) {
    if (snapshot?.hasMath && ["inline", "link"].includes(action)) return;
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
