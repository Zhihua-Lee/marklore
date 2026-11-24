// Formulas and other drawn blocks in the editor. A formula is one unit for
// the caret and for selections: the first Backspace beside it selects it,
// the next removes it. Going into it (arrows, a click, Enter on it) turns it
// into its source text right where it is; once the caret leaves, it is a
// formula again. Raw blocks (HTML, diagrams, footnote definitions) open the
// same way, as their source.
import {
  NodeSelection,
  Selection,
  TextSelection,
  Plugin,
} from "prosemirror-state";
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
// What a selection takes whole, and a press selects or (a click) opens:
// formulas, inline and display, and inline HTML or footnote references.
const PICKED = new Set([S.math_inline, S.raw_inline, S.math_display]);

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
      if (PICKED.has(this.node.type)) return pressFormula(view, getPos, e);
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
      const typeset = () => {
        dom.replaceChildren(formulaFragmentFor(node.attrs.tex, display));
        if (dom.closest("table"))
          dom.dispatchEvent(
            new CustomEvent("folio:math-rendered", { bubbles: true }),
          );
      };
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
    // Before its last character (`]`, `>`): just past it, it would be
    // left, and drawn again at once.
    inner = pos + Math.max(1, text.length - 1);
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
// The formula (inline or display) or inline HTML drawn under a point of the
// page, or at pos: what a selection holding it whole runs between, { from,
// to }, else null. For a display formula, the nearest text on either side
// (the end of the block before it, the start of the one after), so a text
// selection holds it (TextSelection.between would move ends between blocks
// inward, past it).
function formulaUnder(view, x, y) {
  const el = document.elementFromPoint(x, y)?.closest(".rich-drawn");
  if (!el || !view.dom.contains(el)) return null;
  const pos = drawn.get(el)?.();
  return typeof pos === "number" ? formulaAt(view.state.doc, pos) : null;
}
function formulaAt(doc, pos) {
  const node = doc.nodeAt(pos);
  if (!node || !PICKED.has(node.type)) return null;
  let from = pos,
    to = pos + node.nodeSize;
  if (node.isBlock) {
    from = Selection.findFrom(doc.resolve(from), -1, true)?.$head.pos ?? from;
    to = Selection.findFrom(doc.resolve(to), 1, true)?.$head.pos ?? to;
  }
  return { from, to, block: node.isBlock };
}
// Selecting inline formulas with the mouse, per editor: the formula last
// selected whole by a double click or by a drag started on it (`unit`),
// which Shift+click extends from; whether the selection is a word a double
// click selected (`word`); the formula a click just opened, which a
// second click makes a double click on (`opened`); the formula just
// double-clicked, which a third click makes a triple click on (`picked`).
const picking = new WeakMap();
function pickingOf(view) {
  let own = picking.get(view);
  if (!own) picking.set(view, (own = {}));
  return own;
}
const stamp = (e, more) => ({
  time: Date.now(),
  x: e.clientX,
  y: e.clientY,
  ...more,
});
// A press soon after and near another: the next click of a double or
// triple click (the browser's count is lost once the formula is redrawn).
const again = (was, e) =>
  !!was &&
  Date.now() - was.time < 500 &&
  Math.abs(e.clientX - was.x) < 6 &&
  Math.abs(e.clientY - was.y) < 6;
const select = (view, selection) =>
  view.dispatch(view.state.tr.setSelection(selection).setMeta("pointer", true));
// The selection from `unit` (a formula selected whole, or a point) to
// lo..hi (a formula, or a point), holding both whole.
function spanning(doc, unit, lo, hi) {
  let anchor = unit.from,
    head = hi;
  if (hi <= unit.from) [anchor, head] = [unit.to, lo];
  else if (lo < unit.to)
    [anchor, head] = [Math.min(unit.from, lo), Math.max(unit.to, hi)];
  return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
}
// What a point of the page reaches: the formula under it, else the
// position there.
function reach(view, x, y) {
  const at = formulaUnder(view, x, y);
  if (at !== null) return [at.from, at.to];
  const hit = view.posAtCoords({ left: x, top: y });
  return hit ? [hit.pos, hit.pos] : null;
}
// While a drag started on a formula is held beyond the top or bottom of
// the pane, the pane scrolls (as the browser does for its own drags) and
// the selection follows: `follow(x, y)` again at each step. Stopped by the
// returned function.
function autoscroll(view, follow) {
  const scroller = view.dom.closest("#rich-reader") || view.dom.parentElement;
  let last = null,
    timer = 0;
  const step = () => {
    timer = 0;
    if (!last || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const over =
      last.y < box.top + 8
        ? last.y - box.top - 8
        : last.y > box.bottom - 8
          ? last.y - box.bottom + 8
          : 0;
    if (!over) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.max(-40, Math.min(40, over));
    if (scroller.scrollTop === before) return;
    follow(last.x, Math.max(box.top + 2, Math.min(box.bottom - 2, last.y)));
    timer = setTimeout(step, 30);
  };
  return {
    at(x, y) {
      last = { x, y };
      if (!timer) timer = setTimeout(step, 30);
    },
    stop() {
      clearTimeout(timer);
      last = null;
    },
  };
}
// A press on a drawn formula, inline or display, or on inline HTML. A
// click opens it for editing (once the button is up); a drag started on it
// selects it whole and on to where the mouse goes; Shift+click extends the
// selection over it. An inline one is selected whole by a double click
// (Enter then opens it), and a triple click selects its paragraph.
function pressFormula(view, getPos, e) {
  const pos = getPos();
  if (typeof pos !== "number") return;
  const own = pickingOf(view);
  const { doc } = view.state;
  const it = formulaAt(doc, pos);
  if (!it) return;
  if (!view.hasFocus()) view.focus();
  if (!it.block && (e.detail >= 3 || again(own.picked, e))) {
    own.picked = null;
    const $pos = doc.resolve(pos);
    return select(view, TextSelection.create(doc, $pos.start(), $pos.end()));
  }
  if (e.shiftKey) {
    // From a formula or a word selected whole by a double click, the
    // selection keeps it (as the browser keeps a word); else it runs on
    // from its anchor.
    const { anchor, from, to } = view.state.selection;
    const unit =
      own.unit && (anchor === own.unit.from || anchor === own.unit.to)
        ? own.unit
        : own.word && from < to
          ? { from, to }
          : { from: anchor, to: anchor };
    return select(view, spanning(doc, unit, it.from, it.to));
  }
  if (e.detail === 2 && !it.block) {
    select(view, TextSelection.create(doc, pos, pos + 1));
    return pick(view, e);
  }
  own.unit = null;
  own.word = false;
  const unit = { from: it.from, to: it.to };
  let dragging = false;
  const follow = (x, y) => {
    const to = reach(view, x, y);
    if (to) select(view, spanning(view.state.doc, unit, ...to));
  };
  const scrolling = autoscroll(view, follow);
  const move = (m) => {
    if (!(m.buttons & 1)) return up(m);
    if (
      !dragging &&
      Math.abs(m.clientX - e.clientX) <= 4 &&
      Math.abs(m.clientY - e.clientY) <= 4
    )
      return;
    dragging = true;
    follow(m.clientX, m.clientY);
    scrolling.at(m.clientX, m.clientY);
  };
  const up = (u) => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    scrolling.stop();
    if (dragging) {
      own.unit = unit;
      return;
    }
    const at = getPos();
    if (typeof at !== "number") return;
    own.opened = stamp(u, { pos: at });
    open(view, at, -1);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}
// The selection is now the formula selected whole: remembered for Shift+click
// and a triple click.
function pick(view, e) {
  const own = pickingOf(view);
  const { from, to } = view.state.selection;
  own.unit = { from, to };
  own.picked = stamp(e);
}
// The source of a formula opened at pos (math_src text), as a range.
function sourceAt(doc, pos) {
  let to = pos;
  while (to < doc.content.size) {
    const node = doc.nodeAt(to);
    if (!node?.isText || !schema.marks.math_src.isInSet(node.marks)) break;
    to += node.nodeSize;
  }
  return to > pos ? { from: pos, to } : null;
}
// A formula is selected whole: a drag (or a Shift+click) let go of over an
// inline formula ends past it, on the far side from where it started, as
// Read mode takes a formula an end of the selection is in. The browser
// would end it at the formula's nearer edge, often before it. A Shift+click
// from a formula selected whole extends from its far side. A double click
// on a formula (its first click opened it) selects it whole, closed again.
export const formulaEnds = new Plugin({
  props: {
    handleDOMEvents: {
      mousedown(view, e) {
        const own = pickingOf(view);
        const was = own.opened;
        own.opened = null;
        if (e.button !== 0 || e.shiftKey || !again(was, e)) return false;
        const source = sourceAt(view.state.doc, was.pos);
        if (!source) return false;
        e.preventDefault();
        // Selected whole, its source is left: it is drawn again (closer).
        select(
          view,
          TextSelection.create(view.state.doc, source.from, source.to),
        );
        pick(view, e);
        return true;
      },
    },
  },
  view(view) {
    let down = null;
    const press = (e) => {
      // A press on a formula, or the second of a double click on one, is
      // handled above (pressFormula, mousedown).
      if (e.button !== 0 || e.defaultPrevented) return (down = null);
      down = { shift: e.shiftKey };
      // Heard after the editor's own handler for the release, which this
      // press has just set up.
      view.root.removeEventListener("mouseup", release);
      view.root.addEventListener("mouseup", release);
      const own = pickingOf(view);
      own.picked = null;
      if (e.shiftKey) return;
      own.unit = null;
      own.word = e.detail === 2;
    };
    const release = (e) => {
      view.root.removeEventListener("mouseup", release);
      const was = down;
      down = null;
      if (!was || view.isDestroyed || !view.hasFocus() || view.composing)
        return;
      // Settled at once, from the selection the browser made (by a drag's
      // last move, by a Shift+click), read now. Newer Chromium tells of it
      // (`selectionchange`), and runs a timer set here, only after its next
      // frame, after a key pressed by then: that key took the selection as
      // the browser left it (a mark for the AI without the formula).
      view.domObserver.forceFlush();
      view.domObserver.flush();
      settle(was, e.clientX, e.clientY);
    };
    const settle = (was, x, y) => {
      const sel = view.state.selection;
      if (!(sel instanceof TextSelection) || sel.empty) return;
      let { anchor, head } = sel;
      const { unit } = pickingOf(view);
      if (was.shift && unit) {
        if (anchor === unit.from && head < unit.from) anchor = unit.to;
        else if (anchor === unit.to && head > unit.to) anchor = unit.from;
      }
      const at = formulaUnder(view, x, y);
      if (at !== null) head = at.from >= anchor ? at.to : at.from;
      if (anchor === sel.anchor && head === sel.head) return;
      // A display formula with no text past it: as the browser left it.
      if (!view.state.doc.resolve(head).parent.inlineContent) return;
      select(view, TextSelection.create(view.state.doc, anchor, head));
    };
    view.dom.addEventListener("mousedown", press);
    return {
      destroy() {
        view.dom.removeEventListener("mousedown", press);
        view.root.removeEventListener("mouseup", release);
      },
    };
  },
});

// Enter on a selected formula or raw block opens it, also on an inline
// formula or inline HTML selected whole with the mouse.
export const openSelected = (state, dispatch, view) => {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return open(view, sel.from, -1);
  const type = state.doc.nodeAt(sel.from)?.type;
  if (
    sel instanceof TextSelection &&
    sel.to - sel.from === 1 &&
    (type === S.math_inline || type === S.raw_inline)
  )
    return open(view, sel.from, -1);
  return false;
};
// Shift+Left from a formula a double click selected whole (its anchor
// before it): the selection runs on leftward from its far side, keeping it,
// as the browser does from a double-clicked word.
export const flipPicked = (state, dispatch, view) => {
  const { unit } = pickingOf(view);
  const sel = state.selection;
  if (
    !unit ||
    !(sel instanceof TextSelection) ||
    sel.anchor !== unit.from ||
    sel.head !== unit.to
  )
    return false;
  view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, unit.to, unit.from)),
  );
  // The browser then moves the head on by one character.
  return false;
};
