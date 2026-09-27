import { isolateHistory, undo, redo } from "@codemirror/commands";
import { markdownEdit } from "./markdown-edits.js";
import { selectionSource, findPosition } from "./positions.js";
import { wireColorButton, closeColorPicker } from "./color-picker.js";
import { icon } from "./icons.js";
import "./selection-tools.css";

// Only edit a verbatim, contiguous text range. A navigation approximation must
// never become an editing range (math, HTML entities and partial markup differ).
export function previewTextSelection(content, doc) {
  const selected = window.getSelection();
  if (
    !doc ||
    doc.mode !== "edit" ||
    doc.previewText !== doc.text ||
    !selected?.rangeCount ||
    selected.isCollapsed
  )
    return null;
  const range = selected.getRangeAt(0);
  const start = range.startContainer.parentElement;
  const end = range.endContainer.parentElement;
  const blocked = "code,pre,.formula,.katex,a,button,summary,.block-editor";
  const block = start?.closest("p,h1,h2,h3,h4,h5,h6,td,th,li");
  if (
    !block ||
    !content.contains(block) ||
    !block.contains(end) ||
    start.closest(blocked) ||
    end.closest(blocked)
  )
    return null;
  const source = selectionSource(content);
  if (
    !source ||
    source.to <= source.from ||
    !selected.toString().trim() ||
    doc.text.slice(source.from, source.to) !== range.toString()
  )
    return null;
  // Legacy source maps can be approximate around author HTML attributes.
  const prefix = doc.text.slice(0, source.from);
  if (prefix.lastIndexOf("<") > prefix.lastIndexOf(">")) return null;
  return { ...source, range: range.cloneRange(), doc, text: doc.text };
}

export function createSelectionTools({
  content,
  reader,
  view,
  getDocument,
  blocked,
  render,
  report,
}) {
  const bar = document.createElement("div");
  bar.className = "selection-tools";
  bar.hidden = true;
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "选中文字格式");
  const actions = [
    ["bold", "加粗", "<b>B</b>"],
    ["italic", "斜体", "<i>I</i>"],
    ["strike", "删除线", "<s>S</s>"],
    ["highlight", "高亮", icon("highlight")],
    ["color", "文字颜色", icon("textColor")],
    ["link", "链接", icon("link")],
    ["inline", "行内代码", "&lt;/&gt;"],
  ];
  bar.innerHTML = `<div class="selection-actions">${actions.map(([action, label, body]) => `<button type="button" data-selection-action="${action}" aria-label="${label}" title="${label}">${body}</button>`).join("")}</div><form hidden><input name="url" aria-label="链接地址" placeholder="https://… 或 note.md" required><button type="submit" aria-label="应用链接">${icon("link")}</button></form>`;
  document.body.append(bar);
  let snapshot = null,
    dragging = false,
    timer = 0;
  const form = bar.querySelector("form");
  function hide() {
    clearTimeout(timer);
    if (bar.querySelector('[aria-expanded="true"]')) closeColorPicker();
    bar.hidden = true;
    snapshot = null;
    form.hidden = true;
  }
  function valid(s) {
    return (
      s &&
      s.doc === getDocument() &&
      s.doc.mode === "edit" &&
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
    snapshot = previewTextSelection(content, getDocument());
    if (!snapshot) return hide();
    position();
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 90);
  }
  function reselect(from, to) {
    const first = findPosition(content, from),
      last = findPosition(content, to - 1);
    if (!first?.range || !last?.range) return;
    const range = document.createRange();
    range.setStart(first.range.startContainer, first.range.startOffset);
    range.setEnd(last.range.endContainer, last.range.endOffset);
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
      const change = markdownEdit(s.text, s.from, s.to, action, options);
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
      getDocument()?.mode === "edit" &&
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
