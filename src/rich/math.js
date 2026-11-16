// Formulas and other drawn blocks in the editor. A formula is one unit for
// the caret and for selections: the first Backspace beside it selects it,
// the next removes it. Going into it (arrows, a click, Enter on it) turns it
// into its source text right where it is; once the caret leaves, it is a
// formula again. Raw blocks (HTML, diagrams, footnote definitions) open the
// same way, as their source.
import { NodeSelection, TextSelection, Plugin } from "prosemirror-state";
import { formulaFragmentFor, renderMarkdown } from "../markdown.js";
import { renderDiagrams } from "../diagrams.js";
import { composing, settled } from "../composing.js";
import { t } from "../../desktop/i18n.mjs";
import { schema, parseBlocks } from "./markdown.js";

const S = schema.nodes;
// A display formula or raw block open for editing is a code block marked
// by its params.
const OPEN_MATH = "$$";
export const OPEN_RAW = "\u0000raw:";

// When a whole note is put into the editor, formulas are typeset when they
// come near the screen (a long note holds thousands); until then they show
// their TeX. A formula drawn again by an edit (its paragraph was changed
// around it) is typeset at once: its TeX never shows. Never while an input method
// composes (see composing.js): changing the page around a composition can
// end it halfway through the pinyin; they wait for it to end.
const pending = new WeakMap();
const later = new Set();
function typesetLater(dom) {
  if (!later.size) settled().then(() => requestAnimationFrame(flushLater));
  later.add(dom);
}
function flushLater() {
  if (composing()) {
    settled().then(() => requestAnimationFrame(flushLater));
    return;
  }
  for (const dom of [...later]) {
    later.delete(dom);
    const typeset = pending.get(dom);
    pending.delete(dom);
    waiting.delete(dom);
    if (typeset && dom.isConnected) typeset();
  }
}
// While run() puts a whole note in.
let whole = false;
export function wholeNote(run) {
  whole = true;
  try {
    return run();
  } finally {
    whole = false;
  }
}
let watcher = null;
export function watchFormulas(root) {
  watcher?.disconnect();
  watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watcher.unobserve(entry.target);
        if (composing()) {
          typesetLater(entry.target);
          continue;
        }
        const typeset = pending.get(entry.target);
        pending.delete(entry.target);
        typeset?.();
      }
    },
    { root, rootMargin: "1200px 0px" },
  );
}
// The rest are typeset in idle time, a few at a time, so the watch soon
// has nothing left to check on each frame.
let backfill = 0;
function scheduleBackfill() {
  if (backfill) return;
  backfill = requestIdleCallback((deadline) => {
    backfill = 0;
    if (composing()) {
      settled().then(scheduleBackfill);
      return;
    }
    for (const dom of [...waiting]) {
      if (deadline.timeRemaining() < 4) break;
      const typeset = pending.get(dom);
      waiting.delete(dom);
      if (!typeset || !dom.isConnected) continue;
      watcher?.unobserve(dom);
      pending.delete(dom);
      typeset();
    }
    if (waiting.size) scheduleBackfill();
  });
}
const waiting = new Set();
// Where each drawn node is (its node view's getPos), by its element.
const drawn = new WeakMap();

export class DrawnView {
  constructor(node, view, getPos, options) {
    this.node = node;
    this.options = options;
    const inline = node.type === S.math_inline || node.type === S.raw_inline;
    this.dom = document.createElement(inline ? "span" : "div");
    this.dom.contentEditable = "false";
    drawn.set(this.dom, getPos);
    this.draw(node, options);
    this.dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pos = getPos();
      if (typeof pos === "number") open(view, pos, -1);
    });
  }
  // The same node again (its place moved): keep what is drawn.
  update(node) {
    if (node.type !== this.node.type) return false;
    const same = Object.keys(node.attrs).every(
      (k) => node.attrs[k] === this.node.attrs[k],
    );
    this.node = node;
    if (!same) this.draw(node, this.options);
    return true;
  }
  destroy() {
    watcher?.unobserve(this.dom);
    pending.delete(this.dom);
    waiting.delete(this.dom);
    later.delete(this.dom);
  }
  draw(node, { fileId, theme }) {
    const { dom } = this;
    if (node.type === S.math_inline || node.type === S.math_display) {
      const display = node.type === S.math_display;
      dom.className = display ? "math-block rich-drawn" : "formula rich-drawn";
      const typeset = () =>
        dom.replaceChildren(formulaFragmentFor(node.attrs.tex, display));
      if (!watcher || (!whole && !composing())) return typeset();
      const wait = document.createElement("span");
      wait.className = "math-pending";
      wait.textContent = node.attrs.tex;
      dom.replaceChildren(wait);
      pending.set(dom, typeset);
      waiting.add(dom);
      scheduleBackfill();
      watcher.observe(dom);
    } else if (node.type === S.raw_inline) {
      dom.className = "raw-inline rich-drawn";
      dom.dataset.kind = node.attrs.kind;
      dom.title = t("点击编辑源码");
      if (node.attrs.kind === "anchor") {
        // A link target: a small mark, its name on hover.
        const id = /\b(?:id|name)\s*=\s*["']?([^"'\s>]+)/i.exec(
          node.attrs.source,
        )?.[1];
        dom.textContent = "#";
        dom.title = t("锚点 {id}", { id: id || "" });
      } else
        dom.textContent =
          node.attrs.kind === "footnote"
            ? node.attrs.source.slice(1, -1)
            : node.attrs.source;
    } else {
      const { kind, source } = node.attrs;
      dom.className = "raw-block rich-drawn";
      dom.dataset.kind = kind;
      if (kind === "diagram") {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.className = "language-mermaid";
        code.textContent = source.replace(
          /^[`~]{3,}[^\n]*\n|\n[`~]{3,}\s*$/g,
          "",
        );
        pre.append(code);
        dom.replaceChildren(pre);
        renderDiagrams(dom, theme);
      } else if (kind === "html") {
        dom.innerHTML = renderMarkdown(source, fileId).html;
      } else {
        const pre = document.createElement("pre");
        pre.textContent = source;
        dom.replaceChildren(pre);
      }
      dom.title = t("点击编辑源码");
    }
  }
  selectNode() {
    this.dom.classList.add("rich-picked");
  }
  deselectNode() {
    this.dom.classList.remove("rich-picked");
  }
  stopEvent() {
    return false;
  }
  ignoreMutation() {
    return true;
  }
}

// Turn the drawn node at pos into its source, the caret at its start (side
// 1) or end (side -1).
export function open(view, pos, side) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  const tr = view.state.tr;
  let inner;
  if (node.type === S.math_inline) {
    const text = node.attrs.raw;
    tr.replaceWith(
      pos,
      pos + 1,
      schema.text(text, [schema.marks.math_src.create()]),
    );
    inner = side > 0 ? pos + leadOf(text) : pos + text.length - closeOf(text);
  } else if (node.type === S.math_display || node.type === S.raw_block) {
    const parts =
      node.type === S.math_display
        ? displayParts(node.attrs.raw)
        : { lead: "", text: node.attrs.source, tail: "" };
    const { text } = parts;
    const block = S.code_block.create(
      {
        params:
          node.type === S.math_display ? OPEN_MATH : OPEN_RAW + node.attrs.kind,
        lead: parts.lead,
        tail: parts.tail,
      },
      text ? schema.text(text) : null,
    );
    tr.replaceWith(pos, pos + node.nodeSize, block);
    inner = side > 0 ? pos + 1 : pos + 1 + text.length;
  } else if (node.type === S.raw_inline) {
    const text = node.attrs.source;
    tr.replaceWith(
      pos,
      pos + 1,
      schema.text(text, [schema.marks.math_src.create()]),
    );
    inner = pos + text.length;
  } else return false;
  tr.setSelection(TextSelection.create(tr.doc, inner));
  view.dispatch(tr.setMeta("addToHistory", false).setMeta("rich-open", true));
  view.focus();
  return true;
}
// A display formula's source as its delimiters (`$$` or `\[` lines) and
// the TeX between them: open for editing, only the TeX is text.
export function displayParts(raw) {
  const m =
    /^(\$\$|\\\[)([ \t]*\r?\n)?([\s\S]*?)(\r?\n[ \t]*)?(\$\$|\\\])$/.exec(raw);
  if (!m || (m[1] === "$$") !== (m[5] === "$$"))
    return { lead: "", text: raw, tail: "" };
  return { lead: m[1] + (m[2] || ""), text: m[3], tail: (m[4] || "") + m[5] };
}
// A new display formula, open for typing (`$$` lines around it).
export const openMathBlock = (text = "") =>
  S.code_block.create(
    { params: OPEN_MATH, lead: "$$\n", tail: "\n$$" },
    text ? schema.text(text) : null,
  );
const leadOf = (raw) => (raw.startsWith("$$") || raw.startsWith("\\(") ? 2 : 1);
const closeOf = (raw) => (raw.endsWith("$$") || raw.endsWith("\\)") ? 2 : 1);

// Once the caret has left an open formula or block, it is drawn again (or
// stays text where its delimiters were removed).
// What the note defines (footnotes, link references), for reading a piece
// of it again; set by the editor.
let envOf = () => ({});
export const readingWith = (fn) => (envOf = fn);
export const closer = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some((tr) => tr.docChanged || tr.selectionSet)) return null;
    const { from, to } = state.selection;
    const runs = [];
    state.doc.descendants((node, pos) => {
      if (node.type === S.code_block && isOpen(node)) {
        // Inside it (not before or after it, as a gap cursor can be).
        if (!(from > pos && to < pos + node.nodeSize))
          runs.push({ kind: "block", pos, node });
        return false;
      }
      if (node.isText && schema.marks.math_src.isInSet(node.marks)) {
        const last = runs.at(-1);
        if (last?.kind === "inline" && last.to === pos)
          last.to += node.nodeSize;
        else runs.push({ kind: "inline", from: pos, to: pos + node.nodeSize });
      }
      return true;
    });
    if (!runs.length) return null;
    const tr = state.tr;
    for (const run of runs.reverse()) {
      if (run.kind === "block") {
        const { lead, tail, params } = run.node.attrs;
        const text = lead + run.node.textContent + tail;
        let made;
        if (params.startsWith(OPEN_RAW))
          made = [
            S.raw_block.create({
              source: text,
              kind: params.slice(OPEN_RAW.length),
            }),
          ];
        else made = parseBlocks(text);
        if (!made.length) made = [S.paragraph.create()];
        tr.replaceWith(run.pos, run.pos + run.node.nodeSize, made);
        continue;
      }
      // Still open while the caret is between its delimiters; just past
      // the closing one (End, a click after it) it has been left.
      if (from > run.from && from < run.to && to <= run.to) continue;
      const text = state.doc.textBetween(run.from, run.to);
      const node = inlineFrom(text);
      if (node) tr.replaceWith(run.from, run.to, node);
      else tr.removeMark(run.from, run.to, schema.marks.math_src);
    }
    return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
  },
});
const isOpen = (node) =>
  node.attrs.params === OPEN_MATH || node.attrs.params.startsWith(OPEN_RAW);
// Text that reads as exactly one formula or one raw inline piece.
function inlineFrom(text) {
  // With the note's own definitions: a footnote reference reads as one
  // only where its footnote is known.
  const blocks = parseBlocks(text, envOf());
  if (blocks.length !== 1 || blocks[0].type !== S.paragraph) return null;
  const para = blocks[0];
  if (para.childCount !== 1) return null;
  const only = para.firstChild;
  return only.type === S.math_inline || only.type === S.raw_inline
    ? only
    : null;
}

const beside = (state, dir) => {
  const { $cursor } = state.selection;
  if (!$cursor) return null;
  const node = dir < 0 ? $cursor.nodeBefore : $cursor.nodeAfter;
  if (!node || (node.type !== S.math_inline && node.type !== S.raw_inline))
    return null;
  return { node, pos: dir < 0 ? $cursor.pos - node.nodeSize : $cursor.pos };
};
// Arrows step into a formula's source.
export const stepIn = (dir) => (state, dispatch, view) => {
  const hit = beside(state, dir);
  if (!hit || hit.node.type !== S.math_inline) return false;
  return open(view, hit.pos, -dir);
};
// Backspace/Delete beside a formula select it whole; the next press removes it.
export const grab = (dir) => (state, dispatch) => {
  const hit = beside(state, dir);
  if (!hit) return false;
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, hit.pos)));
  return true;
};
// The inline formula drawn under a point of the page: its position, else
// null.
export function formulaUnder(view, x, y) {
  const el = document.elementFromPoint(x, y)?.closest(".formula.rich-drawn");
  if (!el || !view.dom.contains(el)) return null;
  const pos = drawn.get(el)?.();
  return typeof pos === "number" &&
    view.state.doc.nodeAt(pos)?.type === S.math_inline
    ? pos
    : null;
}
// A formula is selected whole: a drag (or a Shift+click) let go of over an
// inline formula ends past it, on the far side from where it started, as
// Read mode takes a formula an end of the selection is in. The browser
// would end it at the formula's nearer edge, often before it.
export const formulaEnds = new Plugin({
  view(view) {
    let down = null;
    const press = (e) => {
      // A press on a formula itself is the formula's own (DrawnView).
      down =
        e.button === 0 && !e.defaultPrevented ? { shift: e.shiftKey } : null;
    };
    const release = (e) => {
      const was = down;
      down = null;
      if (!was || !view.hasFocus()) return;
      const sel = view.state.selection;
      if (!(sel instanceof TextSelection) || sel.empty) return;
      const at = formulaUnder(view, e.clientX, e.clientY);
      if (at === null) return;
      const { anchor } = sel;
      const head = at >= anchor ? at + 1 : at;
      if (head === sel.head) return;
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, anchor, head))
          .setMeta("pointer", true),
      );
    };
    view.dom.addEventListener("mousedown", press);
    document.addEventListener("mouseup", release);
    return {
      destroy() {
        view.dom.removeEventListener("mousedown", press);
        document.removeEventListener("mouseup", release);
      },
    };
  },
});

// Enter on a selected formula or raw block opens it.
export const openSelected = (state, dispatch, view) => {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection)) return false;
  return open(view, sel.from, -1);
};
