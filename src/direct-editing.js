import { textOffset } from "./positions.js";
import { createHosts } from "./direct-hosts.js";
import { t } from "../desktop/i18n.mjs";
import "./direct-editing.css";

// Direct editing (Settings → Editing, off by default): in Edit mode the
// rendered note takes typing. Each keystroke becomes an edit of the source at
// the exact place its text came from (the preview's text runs carry their
// source offsets, see markdown.js), applied through the source editor: its
// history is the undo history, and nothing else in the file changes. There is
// no document model and no conversion back to Markdown.
//
// Diagrams, images and HTML stay whole ("islands"); they keep their pencil
// (block editing). A formula is typeset while the caret is elsewhere; with
// the caret in it (a click, an arrow key, typing it) it shows its source as
// text to type into (markdown.js, "formula-source", "math-source"). Table
// cells take typing on one line; a table's structure is the pencil's. A
// fenced code block takes typing where the page shows its text as the
// source has it (markdown.js marks those, "code-direct"); its fences are the
// pencil's.
//
// Between full renders, typing patches the text node in place and keeps the
// list of changes made since: a text run's rendered offsets map through them.
// The next render (app.js, after a short pause) replaces what changed, and the
// caret comes back to its place in the source.
//
// Each top-level block is an editing host of its own, not the whole note
// (typing costs grow with the host); moving and selecting across blocks is
// direct-hosts.js.

const ISLANDS = [
  ".formula",
  ".math-block",
  ".code-block:not(.code-direct)",
  "pre:not(.code-direct > pre)",
  ".code-toolbar",
  "button",
  "input",
  "img",
  "svg",
  ".mermaid",
  ".section-summary",
  ".block-editor",
  "hr",
].join(",");
// Blocks whose text is typed into; a new paragraph or merge is decided by them.
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,dt,dd,td,th,pre";
const leafOf = (node) =>
  (node?.nodeType === 1 ? node : node?.parentElement)?.closest(
    "[data-text-from]",
  ) || null;
// Text typed in line by line, its line breaks its own: a code block's (one
// run, highlighted inside) or a display formula's source.
const codeOf = (node) =>
  (node?.nodeType === 1 ? node : node?.parentElement)?.closest(
    "pre > code[data-text-from],.math-source > [data-text-from]",
  ) || null;
// Where the paragraph holding a source position starts: after the last blank
// line or block boundary before it, or at the note's start.
function paragraphStart(text, pos) {
  let at = text.lastIndexOf("\n", pos - 1);
  while (at >= 0) {
    const prev = text.lastIndexOf("\n", at - 1) + 1,
      line = text.slice(prev, at);
    if (
      !line.trim() ||
      /^\s*(?:#{1,6}\s|`{3,}|~{3,}|(?:[-*_]\s*){3,}\s*$)/.test(line)
    )
      return at + 1;
    at = prev - 1;
  }
  return 0;
}
// Whether a fenced code block is open at a line start: an opening fence
// before it without its closing one.
function inFence(text, lineStart) {
  let open = null;
  for (const [line, marks] of text
    .slice(0, lineStart)
    .matchAll(/^ {0,3}(`{3,}|~{3,}).*$/gm)) {
    if (!open) open = marks;
    else if (
      marks[0] === open[0] &&
      marks.length >= open.length &&
      line.trim() === marks
    )
      open = null;
  }
  return open !== null;
}
// The text node and offset at a character offset of a run.
function textPoint(leaf, offset) {
  const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
  let last = null;
  while (walker.nextNode()) {
    last = walker.currentNode;
    if (offset <= last.length) return { node: last, offset };
    offset -= last.length;
  }
  return last
    ? { node: last, offset: last.length }
    : { node: leaf, offset: leaf.childNodes.length };
}

export function createDirectEditor({
  content,
  view,
  getDocument,
  enabled,
  renderNow,
  report,
  // Typing patched this part of the page (the render cache must know).
  patched,
  // Renders the source from..to in place of these blocks (app.js); returns
  // the new nodes, or null when only a full render will do. `accept` may
  // decline them; `prepare` sees them before they enter the page.
  renderBlocks,
}) {
  let changes = [],
    starts = new WeakMap(),
    // Blocks rendered on their own after a structural edit: their positions
    // hold from this many changes on, not from the last full render.
    fresh = new WeakMap(),
    composition = null,
    on = false;
  const usable = (leaf) =>
    leaf && content.contains(leaf) && !leaf.parentElement.closest(ISLANDS);
  const hosts = createHosts({
    content,
    scroller: content.closest("#reader") || content.parentElement,
    islands: ISLANDS,
    active: () => on && !composition,
    keys: (event) => onKey(event),
    // A click below a last block that is not a paragraph (a table, a code
    // block, a list): an empty paragraph after it takes the caret. The source
    // changes only when something is typed there (typeInto).
    appendBlock: () => {
      const end = view.state.doc.length;
      let run = content.querySelector("p[data-append] > .direct-empty");
      if (!run) {
        const paragraph = document.createElement("p");
        paragraph.className = "direct-empty-block";
        paragraph.dataset.append = "";
        paragraph.append((run = emptyRun(end)));
        // In the innermost section the note ends in.
        let parent = content;
        while (parent.lastElementChild?.classList.contains("note-section")) {
          const body = parent.lastElementChild.querySelector(
            ":scope > .section-body",
          );
          if (!body) break;
          parent = body;
        }
        parent.append(paragraph);
        patched?.(paragraph);
      }
      view.dispatch({ selection: { anchor: end } });
      const host = hosts.hostOf(run) || hosts.adopt(run);
      if (host && document.activeElement !== host)
        host.focus({ preventScroll: true });
      caretTo(run.firstChild, 0);
      return true;
    },
  });
  // The block that last had the caret: a render that replaces it leaves the
  // focus on the page's body, and the caret is put back all the same.
  let lastHost = null;
  content.addEventListener("focusin", (event) => {
    lastHost = hosts.hostOf(event.target) || lastHost;
  });

  // Source offset of a text run's start, now.
  function mapped(pos, from = 0, assoc = 1) {
    for (let i = from; i < changes.length; i++)
      pos = changes[i].mapPos(pos, assoc);
    return pos;
  }
  // The top-level block holding an element: a child of the note or of a
  // section's body.
  function topOf(node) {
    for (
      let el = node?.nodeType === 1 ? node : node?.parentElement;
      el && el !== content;
      el = el.parentElement
    ) {
      const parent = el.parentElement;
      if (parent === content || parent?.classList.contains("section-body"))
        return el;
    }
    return null;
  }
  const versionOf = (el) => fresh.get(topOf(el)) ?? 0;
  // A position an element carries (data-from and the like), now.
  const now = (el, value, assoc = 1) =>
    mapped(Number(value), versionOf(el), assoc);
  function leafStart(leaf) {
    const own = starts.get(leaf);
    return own
      ? mapped(own.pos, own.version)
      : now(leaf, leaf.dataset.textFrom);
  }
  // A run's text; a code block's last line break is its closing fence's.
  const textOf = (leaf) =>
    leaf.matches("pre > code")
      ? leaf.textContent.replace(/\n$/, "")
      : leaf.textContent;
  // The offset in a run's text of a DOM point inside it.
  const offsetIn = (leaf, node, offset) =>
    Math.min(textOffset(leaf, node, offset), textOf(leaf).length);
  const leafEnd = (leaf) => leafStart(leaf) + textOf(leaf).length;
  const empty = (leaf) => leaf.classList.contains("direct-empty");

  // The text runs of a block, in order, outside islands.
  function leaves(block) {
    return [...block.querySelectorAll("[data-text-from]")].filter(
      (leaf) => leaf.closest(BLOCKS) === block && usable(leaf),
    );
  }
  // The source offset of a DOM point, or null where the page cannot say
  // (inside an island, in author HTML, between blocks).
  function sourceAt(node, offset) {
    const leaf = leafOf(node);
    if (leaf)
      return usable(leaf)
        ? leafStart(leaf) + (empty(leaf) ? 0 : offsetIn(leaf, node, offset))
        : null;
    const element = node.nodeType === 1 ? node : node.parentElement,
      block = element?.closest(BLOCKS);
    // In an escape ("\*", one character on the page): before or after it.
    const escape = element?.closest(".md-escape[data-src-from]");
    if (escape && content.contains(escape)) {
      const range = document.createRange();
      range.selectNodeContents(escape);
      range.setEnd(node, offset);
      return range.toString()
        ? now(escape, escape.dataset.srcTo)
        : now(escape, escape.dataset.srcFrom);
    }
    if (!block || !content.contains(block)) return null;
    const units = unitsOf(block);
    const point = document.createRange();
    point.setStart(node, offset);
    // The nearest run or formula after the point, else the last one before.
    for (const unit of units) {
      const range = document.createRange();
      range.selectNode(unit);
      if (range.compareBoundaryPoints(Range.START_TO_START, point) >= 0)
        return unitStart(unit);
    }
    return units.length ? unitEnd(units.at(-1)) : null;
  }
  // A block's text runs, inline formulas and escapes, in order.
  const isFormula = (el) => el.classList.contains("formula");
  const isEscape = (el) => el.classList.contains("md-escape");
  function unitsOf(block) {
    return [
      ...block.querySelectorAll(
        "[data-text-from],.formula[data-from][data-to],.md-escape[data-src-from]",
      ),
    ].filter(
      (el) =>
        el.closest(BLOCKS) === block &&
        (isFormula(el) || isEscape(el)
          ? !el.parentElement.closest(ISLANDS)
          : usable(el)),
    );
  }
  const unitStart = (el) =>
    isFormula(el)
      ? now(el, el.dataset.from)
      : isEscape(el)
        ? now(el, el.dataset.srcFrom)
        : leafStart(el);
  const unitEnd = (el) =>
    isFormula(el)
      ? now(el, el.dataset.to)
      : isEscape(el)
        ? now(el, el.dataset.srcTo)
        : leafEnd(el);
  // Elements matching a selector in the note, or only in some of its blocks
  // (those just rendered: a long note has thousands of runs to look at).
  const within = (selector, scope) =>
    scope
      ? scope.flatMap((node) =>
          node.nodeType === 1
            ? [
                ...(node.matches(selector) ? [node] : []),
                ...node.querySelectorAll(selector),
              ]
            : [],
        )
      : content.querySelectorAll(selector);
  // A DOM point for a source offset, after a render.
  function pointAt(pos, scope) {
    let best = null;
    for (const leaf of within("[data-text-from]", scope)) {
      if (!usable(leaf)) continue;
      const from = leafStart(leaf),
        to = from + (empty(leaf) ? 0 : textOf(leaf).length);
      if (pos < from || pos > to) continue;
      // Prefer the run that starts here over the one that ends here.
      if (!best || from === pos) best = { leaf, offset: pos - from };
      if (from === pos) break;
    }
    if (!best) return null;
    return empty(best.leaf)
      ? { node: best.leaf.firstChild || best.leaf, offset: 0 }
      : textPoint(best.leaf, best.offset);
  }

  // Apply a change and remember it for mapping the runs not yet re-rendered.
  // patch: the page already shows it (typed into a run), so no render yet.
  let patching = false;
  function commit(change, caret, userEvent, patch = false) {
    patching = patch;
    const transaction = view.state.update({
      changes: change,
      selection: typeof caret === "number" ? { anchor: caret } : caret,
      userEvent,
    });
    try {
      view.dispatch(transaction);
    } finally {
      patching = false;
    }
    changes.push(transaction.changes);
  }
  // After patching the page, a run must hold exactly its source; otherwise
  // render at once (the caret comes back from the source).
  function verify(leaf) {
    patched?.(leaf);
    const from = leafStart(leaf),
      text = empty(leaf) ? "" : textOf(leaf);
    // A space typed at the end of a run shows as a no-break space.
    const plain = (value) => value.replace(/\u00a0/g, " ");
    if (
      plain(view.state.doc.sliceString(from, from + text.length)) !==
      plain(text)
    )
      return refresh();
    return true;
  }
  // Render at once; the caret comes back from the source editor's selection.
  let restore = false;
  function refresh() {
    for (const block of content.querySelectorAll(".direct-empty-block"))
      if (
        !block.closest("blockquote") ||
        block.parentElement.children.length > 1
      )
        block.remove();
    restore = true;
    renderNow();
    return false;
  }
  function selectedRange() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) return null;
    return range;
  }
  function caretTo(node, offset) {
    const selection = window.getSelection();
    selection.collapse(node, offset);
  }

  function unmarkEmpty(leaf) {
    leaf.classList.remove("direct-empty");
    if (!leaf.classList.length) leaf.removeAttribute("class");
    const block = leaf.closest(".direct-empty-block");
    if (block) {
      block.classList.remove("direct-empty-block");
      if (!block.classList.length) block.removeAttribute("class");
    }
  }
  // Typed text at a collapsed caret inside a run: patch the run in place.
  function typeInto(leaf, node, offset, text) {
    let from = leafStart(leaf),
      at = from + (empty(leaf) ? 0 : offsetIn(leaf, node, offset));
    // The paragraph a click below the last block made (appendBlock): its
    // text starts after a blank line, so a table or list does not take it.
    const tail =
        empty(leaf) && leaf.closest("p[data-append]") && at > 0
          ? view.state.doc.sliceString(Math.max(0, at - 2), at)
          : "\n\n",
      lead = tail === "\n\n" ? "" : tail.endsWith("\n") ? "\n" : "\n\n",
      needsFenceNewline =
        empty(leaf) &&
        leaf.matches("pre > code") &&
        view.state.doc.sliceString(at, at + 1) !== "\n";
    commit(
      {
        from: at,
        insert: lead + text + (needsFenceNewline ? "\n" : ""),
      },
      at + lead.length + text.length,
      "input.type",
      true,
    );
    from += lead.length;
    starts.set(leaf, { pos: from, version: changes.length });
    // A space at a run's edge would collapse, and the browser would then
    // type the next key elsewhere: show it as a no-break space, as the
    // browser does when it types one. (Code keeps its spaces.)
    const edge =
      !codeOf(leaf) &&
      (empty(leaf) || node.nodeType !== 3 || offset === node.length || !offset);
    const shown = edge ? text.replace(/^ | $/g, " ") : text;
    if (empty(leaf)) {
      unmarkEmpty(leaf);
      leaf.textContent = shown + (needsFenceNewline ? "\n" : "");
      caretTo(leaf.firstChild, shown.length);
    } else {
      node.insertData(offset, shown);
      caretTo(node, offset + shown.length);
    }
    if (verify(leaf)) markupTyped(leaf, text);
  }
  // Text typed in a code block over a range or between its highlighted
  // parts: through the source, the block rendered again.
  function typeInCode(code, range, insert) {
    if (range.collapsed && range.startContainer.nodeType === 3)
      return typeInto(code, range.startContainer, range.startOffset, insert);
    const edits = range.collapsed
      ? [{ from: sourceAt(range.startContainer, range.startOffset) }]
      : rangeChanges(range);
    if (!edits || edits[0].from === null) return refuse();
    const all = edits.map((edit) => ({ ...edit }));
    all[0].insert = insert;
    structural(
      { change: all, caret: all[0].from + insert.length, around: [code] },
      "input",
    );
  }
  // Tab in a code block indents the lines of the selection (Shift+Tab takes
  // an indent away), by the unit the block's lines use.
  function indentCode(code, range, outdent) {
    const doc = view.state.doc,
      text = code.textContent;
    const unit = /^\t/m.test(text)
      ? "\t"
      : /^ {2}\S/m.test(text)
        ? "  "
        : "    ";
    if (!outdent && range.collapsed) return typeInCode(code, range, unit);
    const from = sourceAt(range.startContainer, range.startOffset),
      to = sourceAt(range.endContainer, range.endOffset);
    if (from === null || to === null) return;
    const first = doc.lineAt(from).number;
    let last = doc.lineAt(to).number;
    // A selection ending at a line's start leaves that line.
    if (last > first && doc.line(last).from === to) last--;
    const list = [];
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      if (!outdent) list.push({ from: line.from, insert: unit });
      else {
        const lead = /^(?:\t| {1,4})/.exec(line.text)?.[0] || "";
        const take =
          unit === "\t" || lead === "\t" ? lead : lead.slice(0, unit.length);
        if (take) list.push({ from: line.from, to: line.from + take.length });
      }
    }
    if (!list.length) return;
    const set = view.state.changes(list);
    structural(
      {
        change: list,
        caret: {
          anchor: set.mapPos(from, 1),
          head: set.mapPos(to, range.collapsed ? 1 : -1),
        },
        around: [code],
      },
      outdent ? "delete" : "input",
    );
  }
  // Typing or deleting inside a run's text is left to the browser, which
  // keeps the caret without a forced layout (setting the selection from
  // script costs ~15 ms in a long note); the source follows on "input".
  let native = null;
  function onInput() {
    const pending = native;
    native = null;
    if (!pending) return;
    const { leaf, from, change } = pending;
    commit(
      change,
      change.from + (change.insert?.length ?? 0),
      change.insert ? "input.type" : "delete",
      true,
    );
    starts.set(leaf, { pos: from, version: changes.length });
    unmarkEmpty(leaf);
    // The browser typed into another run than the one the caret was in
    // (it moves the caret off collapsed spaces): the page no longer shows
    // the source, so render it.
    if (leafOf(window.getSelection().anchorNode) !== leaf) return refresh();
    if (verify(leaf) && change.insert) markupTyped(leaf, change.insert);
  }
  // A typed character may close inline markup: a formula's "$", a code
  // span's backtick, a link's ")", emphasis. Render the block at once (for
  // "*", "_", "~" and "=" after a short pause, so "**" is not shown as
  // emphasis on the way), and keep the page as it is when nothing new formed.
  // Inside a formula still being typed (an odd "$" before the caret on its
  // line), "*" and "_" are the formula's, not emphasis.
  let markupTimer = 0;
  function inOpenFormula(pos) {
    const line = view.state.doc.lineAt(pos);
    const before = view.state.doc
      .sliceString(line.from, pos)
      .replace(/\\\$/g, "");
    return (before.match(/\$/g) || []).length % 2 === 1;
  }
  function markupTyped(leaf, text) {
    clearTimeout(markupTimer);
    if (codeOf(leaf)) return;
    const head = view.state.selection.main.head,
      line = view.state.doc.lineAt(head);
    if (text === " " && leaf.closest(BLOCKS)?.tagName === "P") {
      if (
        /^ {0,3}(?:#{1,6}|[-*+]|\d+[.)]|>|[-*+]\s+\[[ xX]\]) $/.test(
          view.state.doc.sliceString(line.from, head),
        )
      )
        return void refresh();
    }
    if (text === "$" && line.text.trim() === "$$") {
      const docText = view.state.doc.toString(),
        paraStart = paragraphStart(docText, line.from);
      if (
        paraStart < line.from &&
        /^\s*\$\$/.test(docText.slice(paraStart, line.from))
      )
        return void refresh();
    }
    if (!/[$`)*_~=]/.test(text)) return;
    if (!/[$`)]/.test(text) && inOpenFormula(head)) return;
    const restyle = () => {
      if (!on || composition || !leaf.isConnected) return;
      const olds = blocksAround([leaf]);
      if (olds) redraw(olds, (nodes) => shape(nodes) !== shape(olds));
    };
    if (/[$`)]/.test(text)) restyle();
    else markupTimer = setTimeout(restyle, 250);
  }
  // The inline elements of some nodes, outside formulas' own markup.
  function shape(nodes) {
    const list = [];
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(".math-block,.math-source")) list.push("MATH");
      for (const el of node.querySelectorAll(
        "strong,em,s,del,mark,ins,code,a,img,.formula,.math-block,.math-source",
      ))
        if (!el.parentElement.closest(".formula")) {
          const from = Number(el.dataset.srcFrom ?? el.dataset.from),
            to = Number(el.dataset.srcTo ?? el.dataset.to),
            span =
              Number.isFinite(from) && Number.isFinite(to)
                ? ":" + (to - from)
                : "";
          list.push(el.tagName + (isFormula(el) ? ".f" : "") + span);
        }
    }
    return list.join(",");
  }

  // A range that covers more than one run: delete the text of each run, and
  // whole inline elements (emphasis, links, code, formulas) inside it; markup
  // around a partly selected element stays. Across blocks, what lies between
  // the first and the last block goes too.
  function rangeChanges(range) {
    const startBlock = (
      range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement
    ).closest(BLOCKS);
    const endBlock = (
      range.endContainer.nodeType === 1
        ? range.endContainer
        : range.endContainer.parentElement
    ).closest(BLOCKS);
    const a = sourceAt(range.startContainer, range.startOffset),
      b = sourceAt(range.endContainer, range.endOffset);
    if (a === null || b === null || b < a) return null;
    if (startBlock !== endBlock) return [{ from: a, to: b }];
    const list = [];
    const covered = (el) => {
      const whole = document.createRange();
      whole.selectNode(el);
      return (
        range.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0
      );
    };
    const wholes = [
      ...(startBlock?.querySelectorAll(
        ".formula,[data-src-from][data-src-to],:not(pre) > code[data-text-from]",
      ) || []),
    ].filter((el) => range.intersectsNode(el) && covered(el));
    const outer = wholes.filter(
      (el) => !wholes.some((other) => other !== el && other.contains(el)),
    );
    for (const el of outer) {
      const from = Number(el.dataset.srcFrom ?? el.dataset.from),
        to = Number(el.dataset.srcTo ?? el.dataset.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
      list.push({ from: now(el, from), to: now(el, to) });
    }
    for (const leaf of startBlock ? leaves(startBlock) : []) {
      if (!range.intersectsNode(leaf) || outer.some((el) => el.contains(leaf)))
        continue;
      const whole = document.createRange();
      whole.selectNodeContents(leaf);
      const start =
        range.compareBoundaryPoints(Range.START_TO_START, whole) > 0
          ? sourceAt(range.startContainer, range.startOffset)
          : leafStart(leaf);
      const end =
        range.compareBoundaryPoints(Range.END_TO_END, whole) < 0
          ? sourceAt(range.endContainer, range.endOffset)
          : leafEnd(leaf);
      if (end > start) {
        const whole = wholeInline(leaf, { from: start, to: end });
        list.push(
          whole
            ? {
                from: now(whole, whole.dataset.srcFrom),
                to: now(whole, whole.dataset.srcTo),
              }
            : { from: start, to: end },
        );
      }
    }
    list.sort((x, y) => x.from - y.from);
    return list.length ? list : [{ from: a, to: b }];
  }

  // Enter: a new paragraph, list item or quote line at the caret.
  function newBlock(pos) {
    const text = view.state.doc.toString(),
      lineStart = text.lastIndexOf("\n", pos - 1) + 1,
      lineEnd =
        text.indexOf("\n", pos) < 0 ? text.length : text.indexOf("\n", pos),
      line = text.slice(lineStart, lineEnd);
    // Spaces after the caret would start the new block: they go.
    const to = pos + /^[ \t]*/.exec(text.slice(pos, lineEnd))[0].length;
    const paraStart = paragraphStart(text, pos),
      paraBefore = text.slice(paraStart, pos).replace(/\\\$/g, "");
    if (
      /^\s*\$\$/.test(paraBefore) &&
      (paraBefore.match(/\$\$/g) || []).length % 2 === 1
    )
      return { change: { from: pos, to, insert: "\n" }, caret: pos + 1 };
    // In a code block the page does not show as one yet (its fence was just
    // typed): a line break, spaces kept.
    if (inFence(text, lineStart))
      return { change: { from: pos, insert: "\n" }, caret: pos + 1 };
    const fence = line.match(/^(\s*)(`{3,}|~{3,})[^`~]*$/);
    if (fence && pos === lineEnd) {
      const close = "\n" + fence[1] + fence[2];
      return {
        change: { from: pos, to, insert: "\n" + close },
        caret: pos + 1,
      };
    }
    const heading = line.match(/^(\s*#{1,6}\s+)/);
    if (heading && pos <= lineStart + heading[1].length) {
      if (line.slice(heading[1].length).trim())
        return {
          change: { from: lineStart, to: lineStart, insert: "\n\n" },
          caret: lineStart,
        };
      return {
        change: { from: lineStart, to: lineEnd, insert: "" },
        caret: lineStart,
      };
    }
    const item = line.match(/^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/);
    if (item) {
      // An empty item ends the list: a blank line after it, or what is typed
      // next would continue the item above (a lazy continuation line).
      if (
        lineStart + item[0].length >= pos &&
        !line.slice(item[0].length).trim()
      )
        return {
          change: {
            from: lineStart,
            to: lineEnd,
            insert: "\n",
          },
          caret: lineStart + 1,
        };
      const marker = item[3] ? String(Number(item[3]) + 1) + item[4] : item[2];
      const insert =
        "\n" + item[1] + marker + item[5] + (item[6] ? "[ ] " : "");
      return { change: { from: pos, to, insert }, caret: pos + insert.length };
    }
    const quote = line.match(/^(\s*(?:>\s?)+)/);
    if (quote) {
      if (
        lineStart + quote[0].length >= pos &&
        !line.slice(quote[0].length).trim()
      ) {
        const prevStart =
            lineStart > 0 ? text.lastIndexOf("\n", lineStart - 2) + 1 : 0,
          prevLine = lineStart > 0 ? text.slice(prevStart, lineStart - 1) : "",
          from = /^\s*(?:>\s?)+$/.test(prevLine) ? prevStart : lineStart;
        return {
          change: { from, to: lineEnd, insert: "\n" },
          caret: from + 1,
        };
      }
      const insert = "\n" + quote[1].trimEnd() + "\n" + quote[1];
      return { change: { from: pos, to, insert }, caret: pos + insert.length };
    }
    if (!line.trim())
      return { change: { from: pos, to: pos, insert: "" }, caret: pos };
    // At a paragraph's start: an empty paragraph above, the caret in it (blank
    // lines alone would show nothing). At a later line's start the paragraph
    // splits there.
    if (pos === paraStart && line.trim())
      return { change: { from: pos, to, insert: "\n\n" }, caret: pos };
    if (pos === lineStart && pos > paraStart)
      return { change: { from: pos, to, insert: "\n" }, caret: pos + 1 };
    if (to === lineEnd && text[lineEnd] === "\n" && text[lineEnd + 1] !== "\n")
      return {
        change: { from: pos, to: lineEnd + 1, insert: "\n\n" },
        caret: pos + 2,
      };
    return { change: { from: pos, to, insert: "\n\n" }, caret: pos + 2 };
  }

  function outerStart(unit) {
    const block = unit.closest(BLOCKS);
    let from = unitStart(unit);
    for (let el = unit; el && el !== block; el = el.parentElement)
      if (el.dataset.srcFrom !== undefined)
        from = Math.min(from, now(el, el.dataset.srcFrom));
    return from;
  }
  function outerEnd(unit) {
    const block = unit.closest(BLOCKS);
    let to = unitEnd(unit);
    for (let el = unit; el && el !== block; el = el.parentElement)
      if (el.dataset.srcTo !== undefined)
        to = Math.max(to, now(el, el.dataset.srcTo));
    return to;
  }
  // Backspace at the start of a block: first its marker (# , - , > ) goes,
  // then the block joins the one before. Delete at the end joins the next.
  function joinBackward(leaf) {
    const block = leaf.closest(BLOCKS),
      units = unitsOf(block);
    if (units[0] !== leaf) return null;
    const pos = outerStart(leaf),
      text = view.state.doc.toString(),
      lineStart = text.lastIndexOf("\n", pos - 1) + 1,
      prefix = text.slice(lineStart, pos);
    if (
      prefix &&
      /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|(?:>\s?)+)$/.test(
        prefix,
      )
    )
      return {
        change: { from: lineStart, to: pos },
        caret: lineStart,
        around: [leaf],
      };
    if (
      block.classList.contains("direct-empty-block") &&
      pos === 0 &&
      text.startsWith("\n\n")
    )
      return { change: { from: 0, to: 2 }, caret: 0 };
    const prevTop = topOf(block)?.previousElementSibling;
    if (prevTop?.matches("hr[data-edit-from]")) {
      const start = now(prevTop, prevTop.dataset.editFrom, -1);
      return { change: { from: start, to: pos }, caret: start };
    }
    const previous = previousUnit(block);
    if (previous) {
      const end = outerEnd(previous),
        gap = text.slice(end, pos);
      if (
        /^\s*(?:(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|(?:>\s?)+)\s*)*$/.test(
          gap,
        )
      )
        return {
          change: { from: end, to: pos },
          caret: end,
          around: [previous, leaf],
        };
    }
    if (
      block.classList.contains("direct-empty-block") &&
      pos > 0 &&
      text[pos - 1] === "\n"
    ) {
      const from = pos > 1 && text[pos - 2] === "\n" ? pos - 2 : pos - 1;
      return { change: { from, to: pos }, caret: from };
    }
    return null;
  }
  function joinForward(leaf) {
    const block = leaf.closest(BLOCKS),
      units = unitsOf(block);
    if (units.at(-1) !== leaf) return null;
    const pos = outerEnd(leaf),
      text = view.state.doc.toString();
    if (block.classList.contains("direct-empty-block") && text[pos] === "\n") {
      const to = text[pos + 1] === "\n" ? pos + 2 : pos + 1;
      return { change: { from: pos, to }, caret: pos };
    }
    const nextTop = topOf(block)?.nextElementSibling;
    if (nextTop?.matches("hr[data-edit-from]")) {
      const end = now(nextTop, nextTop.dataset.editTo, 1);
      return { change: { from: pos, to: end }, caret: pos };
    }
    const next = nextUnit(block);
    if (!next) return null;
    const start = outerStart(next),
      gap = text.slice(pos, start);
    if (
      !/^\s*(?:(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|(?:>\s?)+)\s*)*$/.test(
        gap,
      )
    )
      return null;
    return {
      change: { from: pos, to: start },
      caret: pos,
      around: [leaf, next],
    };
  }
  function blocksOf() {
    return [...content.querySelectorAll(BLOCKS)].filter(
      (block) => !block.closest(ISLANDS) && unitsOf(block).length,
    );
  }
  function previousUnit(block) {
    const all = blocksOf(),
      at = all.indexOf(block);
    return at > 0 ? unitsOf(all[at - 1]).at(-1) : null;
  }
  function nextUnit(block) {
    const all = blocksOf(),
      at = all.indexOf(block);
    return at >= 0 && at + 1 < all.length ? unitsOf(all[at + 1])[0] : null;
  }

  // The inline formula touching the caret on one side, with nothing typed
  // in between; its source span is the change.
  function formulaNextTo(range, forward) {
    const node = range.startContainer,
      block = (node.nodeType === 1 ? node : node.parentElement)?.closest(
        BLOCKS,
      );
    if (!block) return null;
    // Formulas, and escapes ("\|"): one character on the page, several in
    // the source.
    const formulas = [
      ...block.querySelectorAll(".formula[data-from][data-to],.md-escape"),
    ].filter((el) => el.closest(BLOCKS) === block);
    const caret = document.createRange();
    caret.setStart(node, range.startOffset);
    for (const el of forward ? formulas : formulas.reverse()) {
      const at = [...el.parentNode.childNodes].indexOf(el);
      // Only a formula on the right side of the caret.
      if (
        forward
          ? caret.comparePoint(el.parentNode, at) < 0
          : caret.comparePoint(el.parentNode, at + 1) > 0
      )
        continue;
      const between = document.createRange();
      if (forward) {
        between.setStart(node, range.startOffset);
        between.setEndBefore(el);
      } else {
        between.setStartAfter(el);
        between.setEnd(node, range.startOffset);
      }
      if (between.toString().replace(/​/g, "") !== "") return null;
      const from = now(el, el.dataset.from ?? el.dataset.srcFrom),
        to = now(el, el.dataset.to ?? el.dataset.srcTo);
      return { change: { from, to }, caret: from, around: [el] };
    }
    return null;
  }
  // How long a formula's opening and closing delimiters are in its source
  // ("$", "$$", "\(", "\[", an environment's \begin{…}).
  function delimiters(from, to) {
    const text = view.state.doc.sliceString(from, to).trimEnd();
    return {
      open:
        /^(?:\$\$|\$|\\\(|\\\[|\\begin\{[^}]*\})/.exec(text)?.[0].length ?? 0,
      close:
        /(?:\$\$|\$|\\\)|\\\]|\\end\{[^}]*\})$/.exec(text)?.[0].length ?? 0,
    };
  }
  // The inline element (emphasis, code span, link) a deletion empties, the
  // outermost when they nest.
  function wholeInline(run, { from, to }) {
    if (codeOf(run) || from !== leafStart(run) || to !== leafEnd(run))
      return null;
    let whole = null;
    for (let el = run; el && !el.matches(BLOCKS); el = el.parentElement)
      if (
        el.dataset.srcFrom !== undefined &&
        el.dataset.srcTo !== undefined &&
        el.textContent === run.textContent
      )
        whole = el;
    return whole;
  }
  // Open a formula: its source takes the caret at `pos` (the render shows
  // the formula holding the caret as text, markdown.js).
  let wanted = null;
  function enter(formula, pos) {
    const from = now(formula, formula.dataset.from);
    // (A display formula's range runs to the next line.)
    const text = view.state.doc
      .sliceString(from, now(formula, formula.dataset.to))
      .trimEnd();
    wanted = { from, to: from + text.length };
    view.dispatch({ selection: { anchor: pos } });
    const olds = blocksAround([formula]);
    if (!olds || !redraw(olds)) refresh();
    wanted = null;
  }
  // An open formula's source runs, and whether the caret is in one.
  const sources = () =>
    content.querySelectorAll(".formula-source,.math-source > [data-text-from]");
  const holds = (run, { anchor, head } = view.state.selection.main) => {
    const from = leafStart(run),
      to = leafEnd(run);
    return (from < anchor && anchor < to) || (from < head && head < to);
  };
  // The caret left an open formula: typeset it again.
  function closeFormulas() {
    for (const run of sources()) {
      if (holds(run)) continue;
      const olds = blocksAround([run]);
      if (!olds || !redraw(olds)) refresh();
      return;
    }
  }
  // At a block's last (first) text, inside emphasis, a code span or a link
  // that ends (starts) the block: the outermost such element. The caret
  // steps out of it with an arrow key, to type after (before) it.
  function inlineEdge(range, forward) {
    const leaf = leafOf(range.startContainer);
    if (!range.collapsed || !usable(leaf) || empty(leaf) || codeOf(leaf))
      return null;
    const block = leaf.closest(BLOCKS),
      units = unitsOf(block).filter((u) => !empty(u));
    if ((forward ? units.at(-1) : units[0]) !== leaf) return null;
    const at = sourceAt(range.startContainer, range.startOffset);
    if (at !== (forward ? leafEnd(leaf) : leafStart(leaf))) return null;
    let outer = null;
    for (let el = leaf; el && el !== block; el = el.parentElement)
      if (el.dataset.srcFrom !== undefined && el.dataset.srcTo !== undefined)
        outer = el;
    return outer;
  }
  // Keys for formulas and inline edges (direct-hosts.js asks first).
  function onKey(event) {
    if (
      !on ||
      composition ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    )
      return false;
    const range = selectedRange();
    if (!range?.collapsed) return false;
    const forward = event.key === "ArrowRight";
    // Into a formula next to the caret, past its delimiter.
    const formula = formulaNextTo(range, forward);
    if (formula && isFormula(formula.around[0])) {
      const { from, to } = formula.change,
        marks = delimiters(from, to);
      event.preventDefault();
      enter(formula.around[0], forward ? from + marks.open : to - marks.close);
      return true;
    }
    const outer = inlineEdge(range, forward);
    if (!outer) return false;
    event.preventDefault();
    const pos = now(
      outer,
      forward ? outer.dataset.srcTo : outer.dataset.srcFrom,
    );
    view.dispatch({ selection: { anchor: pos } });
    const point = forward ? afterInline(pos) : beforeInline(pos);
    if (point) caretTo(point.node, point.offset);
    return true;
  }
  // A structural edit (a new block, a join, a removed formula): only the
  // blocks around it are rendered again, at once; the full render waits for
  // a pause in typing, as typing in a run does.
  function structural({ change, caret, around }, userEvent) {
    clearTimeout(markupTimer);
    const olds = around && blocksAround(around);
    commit(change, caret, userEvent, Boolean(olds));
    if (!olds || !redraw(olds)) refresh();
  }
  // The top-level blocks spanning some nodes, with what lies between them;
  // null when they are not siblings or a heading is among them (a heading
  // also opens a section, which only a full render builds).
  function blocksAround(nodes) {
    const tops = nodes.map(topOf);
    if (tops.some((top) => !top || top.parentNode !== tops[0].parentNode))
      return null;
    const siblings = [...tops[0].parentNode.childNodes],
      at = tops.map((top) => siblings.indexOf(top));
    const span = siblings.slice(Math.min(...at), Math.max(...at) + 1);
    if (
      span.some(
        (node) =>
          node.nodeType === 1 &&
          (!(positioned(node) || leaves(node).length) ||
            node.matches(".note-section,h1,h2,h3,h4,h5,h6")),
      )
    )
      return null;
    return span;
  }
  // The element carrying a top-level block's source range (a table's sits
  // inside its scroll box, a code block's under its toolbar).
  const positioned = (top) =>
    top.dataset.from !== undefined
      ? top
      : [top.firstElementChild, top.querySelector(":scope > pre")].find(
          (el) => el?.dataset.from !== undefined,
        ) || null;
  // Render these blocks again from the source; `accept` may decline the
  // result (it changes nothing). Returns whether the page was updated.
  function redraw(olds, accept) {
    const blocks = olds.filter((node) => node.nodeType === 1);
    const first = positioned(blocks[0]),
      last = positioned(blocks.at(-1));
    const from = first
        ? now(first, first.dataset.from, -1)
        : leafStart(leaves(blocks[0])[0]),
      to = Math.min(
        view.state.doc.length,
        last
          ? now(last, last.dataset.to, 1)
          : leafEnd(leaves(blocks.at(-1)).at(-1)),
      );
    if (!(from <= to)) return false;
    // Islands are marked while the nodes are detached: setting
    // contenteditable in the page makes the browser restyle at once.
    const nodes = renderBlocks?.(olds, from, to, {
      accept,
      prepare: (nodes) => {
        markIslands(nodes);
        hosts.mark(nodes);
      },
    });
    if (!nodes) return false;
    for (const node of nodes)
      if (node.nodeType === 1) fresh.set(node, changes.length);
    markEmpty(nodes);
    hosts.mark(nodes);
    settle(true, nodes);
    return true;
  }
  function refuse() {
    report?.(t("这里不能直接编辑：公式、代码和表格结构请用铅笔就地编辑"));
  }
  const cellOf = (node) =>
    (node?.nodeType === 1 ? node : node?.parentElement)?.closest("td,th");

  function onBeforeInput(event) {
    if (!on || composition) return;
    if (event.target.closest?.(".block-editor")) return;
    const type = event.inputType;
    if (type === "insertCompositionText") return;
    const range = selectedRange();
    const collapsed = range?.collapsed;
    const leaf = range && leafOf(range.startContainer);
    const target = event.getTargetRanges?.()[0];
    native = null;
    clearTimeout(markupTimer);
    // In a table cell, text stays on one line and a "|" is written escaped;
    // the table's structure is the pencil's.
    const cell = range && cellOf(range.startContainer);
    if (cell) {
      if (!collapsed && cellOf(range.endContainer) !== cell) {
        event.preventDefault();
        return refuse();
      }
      if (/^insert(?:Paragraph|LineBreak)$/.test(type)) {
        event.preventDefault();
        if (collapsed) {
          const row = cell.parentElement,
            col = [...row.children].indexOf(cell),
            nextRow =
              row.nextElementSibling ||
              row.parentElement.nextElementSibling?.firstElementChild,
            below = nextRow?.children[col],
            target = below && leaves(below)[0];
          if (target) {
            const host = hosts.hostOf(target);
            if (host && document.activeElement !== host)
              host.focus({ preventScroll: true });
            const point = empty(target)
              ? { node: target.firstChild || target, offset: 0 }
              : textPoint(target, 0);
            caretTo(point.node, point.offset);
          }
        }
        return;
      }
      const data =
        event.data ?? event.dataTransfer?.getData("text/plain") ?? null;
      if (data !== null && /[|\r\n]/.test(data) && type.startsWith("insert")) {
        event.preventDefault();
        const edits = collapsed
          ? [{ from: sourceAt(range.startContainer, range.startOffset) }]
          : rangeChanges(range);
        if (!edits || edits[0].from === null) return refuse();
        const insert = data.replace(/\r?\n|\r/g, " ").replace(/\|/g, "\\|");
        const all = edits.map((e) => ({ ...e }));
        all[0].insert = insert;
        return structural(
          {
            change: all,
            caret: all[0].from + insert.length,
            around: [cell],
          },
          "input.type",
        );
      }
    }
    // A code block's fences are the pencil's: a selection reaching past
    // them is refused, nothing joins across them, and a line break keeps
    // the line's indentation.
    const code = range && codeOf(range.startContainer);
    if (range && codeOf(range.endContainer) !== code) {
      event.preventDefault();
      return report?.(t("选区跨出了代码块；代码块的开头和结尾请用铅笔修改"));
    }
    if (code) {
      const at = sourceAt(range.startContainer, range.startOffset);
      if (/^insert(?:Paragraph|LineBreak)$/.test(type)) {
        event.preventDefault();
        if (
          collapsed &&
          code.parentElement.classList.contains("math-source") &&
          (at === leafStart(code) || at === leafEnd(code))
        ) {
          const before = at === leafStart(code);
          commit(
            { from: at, insert: "\n\n" },
            before ? at : at + 2,
            "input",
            false,
          );
          return refresh();
        }
        const line = view.state.doc.lineAt(at);
        const insert =
          "\n" + /^[ \t]*/.exec(view.state.doc.sliceString(line.from, at))[0];
        return typeInCode(code, range, insert);
      }
      if (
        collapsed &&
        type.startsWith("delete") &&
        at === (type.endsWith("Backward") ? leafStart(code) : leafEnd(code))
      ) {
        event.preventDefault();
        if (!textOf(code) && code.matches("pre > code")) {
          const frame = code.closest(".code-block[data-edit-from]");
          if (frame) {
            const start = now(frame, frame.dataset.editFrom, -1),
              end = now(frame, frame.dataset.editTo, 1);
            commit({ from: start, to: end }, start, "delete", false);
            return refresh();
          }
        }
        return;
      }
    }
    const heading = leaf?.closest("h1,h2,h3,h4,h5");
    if (
      type === "insertText" &&
      collapsed &&
      event.data === "#" &&
      heading &&
      leaves(heading)[0] === leaf &&
      sourceAt(range.startContainer, range.startOffset) === leafStart(leaf)
    ) {
      const pos = leafStart(leaf),
        line = view.state.doc.lineAt(pos),
        prefix = /^( {0,3}#{1,5})[ \t]+$/.exec(
          view.state.doc.sliceString(line.from, pos),
        );
      if (prefix) {
        event.preventDefault();
        commit(
          { from: line.from + prefix[1].length, insert: "#" },
          pos + 1,
          "input.type",
          false,
        );
        return refresh();
      }
    }
    if (
      type === "insertText" &&
      collapsed &&
      event.data &&
      range.startContainer.nodeType === 3 &&
      usable(leaf) &&
      !empty(leaf)
    ) {
      const from = leafStart(leaf),
        at = from + offsetIn(leaf, range.startContainer, range.startOffset);
      native = { leaf, from, change: { from: at, insert: event.data } };
      return;
    }
    if (
      type.startsWith("delete") &&
      target &&
      target.startContainer === target.endContainer &&
      target.startContainer.nodeType === 3 &&
      target.endOffset > target.startOffset &&
      usable(leafOf(target.startContainer)) &&
      !empty(leafOf(target.startContainer))
    ) {
      const run = leafOf(target.startContainer),
        from = leafStart(run);
      const change = {
        from: from + offsetIn(run, target.startContainer, target.startOffset),
        to: from + offsetIn(run, target.startContainer, target.endOffset),
      };
      // The last of an inline element's text takes its markers with it:
      // "****" left alone reads as a rule, "``" as text.
      const whole = wholeInline(run, change);
      if (whole) {
        event.preventDefault();
        const start = now(whole, whole.dataset.srcFrom);
        return structural(
          {
            change: { from: start, to: now(whole, whole.dataset.srcTo) },
            caret: start,
            around: [whole],
          },
          "delete",
        );
      }
      if (change.from === from && change.to === leafEnd(run)) {
        if (run.matches("pre > code")) {
          event.preventDefault();
          commit(change, from, "delete", true);
          run.textContent = "\n";
          starts.set(run, { pos: from, version: changes.length });
          caretTo(run.firstChild, 0);
          patched?.(run);
          return;
        }
        if (!codeOf(run)) {
          event.preventDefault();
          if (run.classList.contains("formula-source"))
            return structural({ change, caret: from, around: [run] }, "delete");
          commit(change, from, "delete", true);
          run.classList.add("direct-empty");
          run.dataset.textFrom = String(from);
          run.dataset.textTo = String(from);
          run.textContent = "​";
          starts.set(run, { pos: from, version: changes.length });
          caretTo(run.firstChild, 0);
          patched?.(run);
          return;
        }
      }
      native = { leaf: run, from, change };
      return;
    }
    event.preventDefault();
    if (!range) return refuse();
    // Plain typing at a caret inside a run.
    if (
      (type === "insertText" || type === "insertReplacementText") &&
      collapsed &&
      usable(leaf)
    ) {
      const text =
        event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
      if (!text) return;
      if (range.startContainer.nodeType === 3 || empty(leaf))
        return typeInto(leaf, range.startContainer, range.startOffset, text);
      if (leaf.matches("pre > code") && leaf.firstChild?.nodeType === 3)
        return typeInto(leaf, leaf.firstChild, 0, text);
    }
    // Backspace right after a formula takes its closing "$" (Delete before
    // one, its opening "$"): the formula shows as the source it now is, to
    // edit. An escape ("\*") goes whole, as the one character it shows.
    if (
      collapsed &&
      (type === "deleteContentBackward" || type === "deleteContentForward")
    ) {
      const forward = type === "deleteContentForward",
        formula = formulaNextTo(range, forward);
      if (formula && isFormula(formula.around[0])) {
        const { from, to } = formula.change,
          marks = delimiters(from, to);
        return structural(
          {
            change: forward
              ? { from, to: from + marks.open }
              : { from: to - marks.close, to },
            caret: forward ? from : to - marks.close,
            around: formula.around,
          },
          "delete",
        );
      }
      if (formula) return structural(formula, "delete");
      if (usable(leaf) && empty(leaf)) {
        const sibling = forward
          ? leaf.nextElementSibling
          : leaf.previousElementSibling;
        if (
          sibling &&
          (forward ? sibling.dataset.srcFrom : sibling.dataset.srcTo) !==
            undefined
        ) {
          const edge = now(
            sibling,
            forward ? sibling.dataset.srcFrom : sibling.dataset.srcTo,
          );
          return structural(
            {
              change: forward
                ? { from: edge, to: edge + 1 }
                : { from: edge - 1, to: edge },
              caret: forward ? edge : edge - 1,
              around: [sibling],
            },
            "delete",
          );
        }
      }
    }
    // At a cell's edge there is nothing to join.
    if (collapsed && cell && type.startsWith("delete")) {
      const units = unitsOf(cell),
        at = sourceAt(range.startContainer, range.startOffset);
      if (
        !units.length ||
        (type === "deleteContentBackward" &&
          units[0] === leaf &&
          (empty(leaf) || at === leafStart(leaf))) ||
        (type === "deleteContentForward" &&
          units.at(-1) === leaf &&
          (empty(leaf) || at === leafEnd(leaf)))
      )
        return;
    }
    if (
      collapsed &&
      (type === "deleteContentBackward" || type === "deleteContentForward") &&
      usable(leaf)
    ) {
      const block = leaf.closest(BLOCKS),
        units = block ? unitsOf(block) : [],
        at = sourceAt(range.startContainer, range.startOffset);
      if (
        type === "deleteContentBackward" &&
        units[0] === leaf &&
        (empty(leaf) || at === leafStart(leaf))
      ) {
        const join = joinBackward(leaf);
        if (join) return structural(join, "delete");
        if (at === 0 || outerStart(leaf) === 0) {
          if (at > 0)
            return structural(
              {
                change: { from: at - 1, to: at },
                caret: at - 1,
                around: [leaf],
              },
              "delete",
            );
          return;
        }
        return refuse();
      }
      if (
        type === "deleteContentForward" &&
        units.at(-1) === leaf &&
        (empty(leaf) || at === leafEnd(leaf))
      ) {
        const join = joinForward(leaf);
        if (join) return structural(join, "delete");
        const docEnd = view.state.doc.length;
        if (at === docEnd || outerEnd(leaf) === docEnd) {
          if (at < docEnd)
            return structural(
              { change: { from: at, to: at + 1 }, caret: at, around: [leaf] },
              "delete",
            );
          return;
        }
        return refuse();
      }
    }
    // Everything else rebuilds from the source. A deletion the browser would
    // make over more than one text node (a word across bold) is its range.
    const reach =
      collapsed && target && !target.collapsed && type.startsWith("delete")
        ? document.createRange()
        : null;
    if (reach) {
      reach.setStart(target.startContainer, target.startOffset);
      reach.setEnd(target.endContainer, target.endOffset);
    }
    const edits = reach
      ? rangeChanges(reach)
      : collapsed
        ? []
        : rangeChanges(range);
    if (edits === null) return refuse();
    const at = !edits.length
      ? sourceAt(range.startContainer, range.startOffset)
      : edits[0].from;
    if (at === null) return refuse();
    const around = [range.startContainer, range.endContainer];
    if (type === "insertParagraph") {
      if (edits.length) commit(edits, at, "delete", true);
      const next = newBlock(edits.length ? changes.at(-1).mapPos(at) : at);
      return structural({ ...next, around }, "input");
    }
    let insert = "";
    if (type === "insertLineBreak") insert = "  \n";
    else if (type.startsWith("insert"))
      insert = (
        event.data ??
        event.dataTransfer?.getData("text/plain") ??
        ""
      ).replace(/\r\n?/g, "\n");
    else if (!type.startsWith("delete")) return;
    if (!edits.length && !insert) return;
    const all = edits.length ? edits.map((e) => ({ ...e })) : [];
    if (insert) {
      if (all.length) all[0].insert = insert;
      else all.push({ from: at, insert });
    }
    structural(
      { change: all, caret: at + insert.length, around },
      type.startsWith("delete") ? "delete" : "input",
    );
  }

  // Input methods compose in the page; the result goes to the source when
  // the composition ends. Renders wait until then.
  function onCompositionStart(event) {
    if (!on || event.target.closest?.(".block-editor")) return;
    const range = selectedRange();
    const from = range && sourceAt(range.startContainer, range.startOffset),
      to = range && sourceAt(range.endContainer, range.endOffset);
    const leaf = range && leafOf(range.startContainer);
    composition =
      from === null || to === null || !range
        ? { lost: true }
        : {
            from,
            to,
            leaf: usable(leaf) && range.collapsed ? leaf : null,
            start: usable(leaf) ? leafStart(leaf) : null,
          };
  }
  function onCompositionEnd(event) {
    if (!on || !composition || event.target.closest?.(".block-editor")) return;
    const state = composition;
    composition = null;
    if (state.lost) return refresh();
    const text = event.data || "";
    commit(
      { from: state.from, to: state.to, insert: text },
      state.from + text.length,
      "input.type.compose",
      Boolean(state.leaf),
    );
    const leaf = leafOf(window.getSelection().anchorNode);
    if (state.leaf && leaf === state.leaf && state.start !== null) {
      starts.set(leaf, { pos: state.start, version: changes.length });
      // The composed text went in beside the empty run's placeholder
      // character: take that out (the caret moves with the text).
      if (empty(leaf)) {
        unmarkEmpty(leaf);
        const node = leaf.firstChild,
          at = node?.nodeType === 3 ? node.data.indexOf("​") : -1;
        if (at >= 0) node.deleteData(at, 1);
      }
      verify(leaf);
    } else refresh();
  }
  // The source editor keeps the caret: it is where a render brings it back.
  let syncing = 0;
  function onSelectionChange() {
    if (!on || composition) return;
    cancelAnimationFrame(syncing);
    // Read the selection when the frame comes: typing may have moved it.
    syncing = requestAnimationFrame(() => {
      const range = !composition && selectedRange();
      if (!range) return;
      const startEl =
        range.startContainer.nodeType === 1
          ? range.startContainer
          : range.startContainer.parentElement;
      if (startEl?.closest(".block-editor")) return;
      for (const block of content.querySelectorAll(".direct-empty-block"))
        if (
          !block.contains(range.startContainer) &&
          (!block.closest("blockquote") ||
            block.parentElement.children.length > 1) &&
          content.querySelectorAll(BLOCKS).length > 1
        )
          block.remove();
      const anchor = sourceAt(range.startContainer, range.startOffset),
        head = sourceAt(range.endContainer, range.endOffset);
      if (anchor === null || head === null) return;
      const main = view.state.selection.main;
      if (main.anchor !== anchor || main.head !== head)
        view.dispatch({ selection: { anchor, head } });
      closeFormulas();
    });
  }
  content.addEventListener("mousedown", (event) => {
    if (!on || composition || event.button) return;
    const formula = event.target.closest?.(
      ".formula[data-from][data-to],.math-block[data-from][data-to]",
    );
    if (
      formula &&
      content.contains(formula) &&
      !formula.parentElement.closest(".formula,.block-editor")
    )
      event.preventDefault();
  });
  // A click on a formula opens it, the caret before its closing delimiter.
  content.addEventListener("click", (event) => {
    if (!on || composition || event.button) return;
    const formula = event.target.closest?.(
      ".formula[data-from][data-to],.math-block[data-from][data-to]",
    );
    if (
      !formula ||
      !content.contains(formula) ||
      formula.parentElement.closest(".formula,.block-editor")
    )
      return;
    event.preventDefault();
    const from = now(formula, formula.dataset.from),
      text = view.state.doc
        .sliceString(from, now(formula, formula.dataset.to))
        .trimEnd(),
      to = from + text.length;
    let pos = to - delimiters(from, to).close;
    if (text[pos - from - 1] === "\n") pos--;
    enter(formula, pos);
  });

  content.addEventListener("beforeinput", onBeforeInput);
  content.addEventListener("input", onInput);
  content.addEventListener("compositionstart", onCompositionStart);
  content.addEventListener("compositionend", onCompositionEnd);
  document.addEventListener("selectionchange", onSelectionChange);
  content.addEventListener("drop", (event) => {
    if (on) event.preventDefault();
  });
  content.addEventListener("keydown", (event) => {
    if (
      !on ||
      composition ||
      event.key !== "Tab" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return;
    const range = selectedRange();
    if (!range) return;
    const cell = cellOf(range.startContainer);
    if (cell && cellOf(range.endContainer) === cell) {
      const cells = [
          ...(cell.closest("table")?.querySelectorAll("th,td") || []),
        ],
        next = cells[cells.indexOf(cell) + (event.shiftKey ? -1 : 1)],
        target = next && leaves(next).at(-1);
      if (target) {
        event.preventDefault();
        const host = hosts.hostOf(target);
        if (host && document.activeElement !== host)
          host.focus({ preventScroll: true });
        const point = empty(target)
          ? { node: target.firstChild || target, offset: 0 }
          : textPoint(target, textOf(target).length);
        caretTo(point.node, point.offset);
      }
      return;
    }
    const code = codeOf(range.startContainer);
    if (!code || codeOf(range.endContainer) !== code) return;
    event.preventDefault();
    indentCode(code, range, event.shiftKey);
  });
  // Over several blocks the browser copies only the first block's part (each
  // block is a host of its own). The source copy (copy-source.js) usually
  // writes the clipboard; otherwise the selected text is. A cut copies the
  // whole selection, then removes it from the source.
  const spanning = (range) =>
    range &&
    !range.collapsed &&
    hosts.hostOf(range.startContainer) !== hosts.hostOf(range.endContainer);
  window.addEventListener("copy", (event) => {
    const range = on && !event.defaultPrevented && selectedRange();
    if (!spanning(range)) return;
    event.clipboardData.setData("text/plain", range.toString());
    event.preventDefault();
  });
  content.addEventListener("cut", (event) => {
    const range = on && !composition && selectedRange();
    if (!spanning(range)) return;
    event.preventDefault();
    if (codeOf(range.startContainer) !== codeOf(range.endContainer))
      return report?.(t("选区跨出了代码块；代码块的开头和结尾请用铅笔修改"));
    document.execCommand("copy");
    const edits = rangeChanges(range);
    if (edits === null) return refuse();
    structural(
      {
        change: edits,
        caret: edits[0].from,
        around: [range.startContainer, range.endContainer],
      },
      "delete.cut",
    );
  });

  return {
    get patching() {
      return patching;
    },
    get composing() {
      return Boolean(composition);
    },
    get active() {
      return on;
    },
    // The caret's place in the source while the page has it (renders open
    // the formula around it), else null.
    caret() {
      return on && (wanted || content.contains(document.activeElement))
        ? view.state.selection.main.head
        : null;
    },
    // The formula to show open ("from:to"): the one being opened, or the
    // open one the caret is in. A render that showed another renders again.
    opened() {
      if (!on) return null;
      if (wanted) return wanted.from + ":" + wanted.to;
      if (!content.contains(document.activeElement)) return null;
      for (const run of sources())
        if (holds(run)) return leafStart(run) + ":" + leafEnd(run);
      return null;
    },
    // Called by app.js after every render, mode change and settings change.
    rendered() {
      const doc = getDocument();
      const next = Boolean(enabled(doc));
      if (next !== on) {
        on = next;
        if (!on) hosts.unmark();
        content.classList.toggle("direct-editing", on);
      }
      if (!on) return;
      if (doc && doc.previewText === doc.text) {
        changes = [];
        starts = new WeakMap();
        fresh = new WeakMap();
      }
      const head = view.state.selection.main.head;
      for (const block of content.querySelectorAll(".direct-empty-block")) {
        const run = block.querySelector(".direct-empty");
        const other = [...content.querySelectorAll("[data-text-from]")].some(
          (el) =>
            !block.contains(el) &&
            usable(el) &&
            leafStart(el) <= head &&
            head <= leafEnd(el),
        );
        if (!run || leafStart(run) !== head || other) block.remove();
      }
      markEmpty();
      hosts.mark();
      markIslands();
      const forced = restore;
      restore = false;
      settle(forced);
    },
    focus() {
      if (!on) return false;
      settle(true);
      const host = content.querySelector("[data-direct-host]");
      if (!host) return false;
      if (!content.contains(document.activeElement))
        host.focus({ preventScroll: true });
      if (!selectedRange()) {
        const point = pointAt(view.state.selection.main.head) || pointAt(0);
        if (point) caretTo(point.node, point.offset);
      }
      return true;
    },
  };

  function markEmpty(scope) {
    if (!scope && !content.querySelector(BLOCKS)) {
      const paragraph = document.createElement("p");
      paragraph.className = "direct-empty-block";
      paragraph.append(emptyRun(view.state.doc.length));
      content.append(paragraph);
    }
    for (const block of within(
      "h1,h2,h3,h4,h5,h6,li,blockquote,td,th",
      scope,
    )) {
      // A table cell keeps its own text position (the row has data-from).
      const cell = block.matches("td,th"),
        at = cell ? block.dataset.cellFrom : block.dataset.from;
      if (
        at === undefined ||
        block.parentElement?.closest(ISLANDS) ||
        block.querySelector(BLOCKS) ||
        unitsOf(block).length
      )
        continue;
      const from = now(block, at);
      if (cell) {
        block.append(emptyRun(Math.min(view.state.doc.length, from)));
        continue;
      }
      const line = view.state.doc.lineAt(Math.min(from, view.state.doc.length)),
        prefix =
          /^\s*(?:#{1,6}[ \t]*|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+|(?:>[ \t]?)+)/.exec(
            line.text.slice(Math.max(0, from - line.from)),
          )?.[0].length ?? 0,
        run = emptyRun(Math.min(view.state.doc.length, from + prefix));
      if (block.tagName === "BLOCKQUOTE") {
        const paragraph = document.createElement("p");
        paragraph.className = "direct-empty-block";
        paragraph.append(run);
        block.append(paragraph);
      } else {
        const summary = block.querySelector(":scope > .section-summary");
        if (summary) summary.before(run);
        else block.append(run);
      }
    }
    for (const code of within("pre > code[data-text-from]", scope))
      if (usable(code) && !code.textContent) {
        const pos = now(code, code.dataset.textFrom);
        code.classList.add("direct-empty");
        code.textContent = "​";
        starts.set(code, { pos, version: changes.length });
      }
    const head = view.state.selection.main.head;
    for (const p of within("p.math-open[data-to]", scope)) {
      const last = leaves(p).at(-1),
        end = now(p, p.dataset.to);
      if (
        last &&
        head === end &&
        end > leafEnd(last) &&
        view.state.doc.sliceString(end - 1, end) === "\n"
      )
        p.append("\n", emptyRun(end));
    }
    for (const br of within("br", scope)) {
      const block = br.closest(BLOCKS);
      if (
        block &&
        !br.parentElement.closest(ISLANDS) &&
        !br.nextElementSibling &&
        !br.nextSibling?.textContent.trim()
      ) {
        const last = leaves(block).at(-1);
        if (last) {
          const line = view.state.doc.lineAt(leafEnd(last));
          if (line.to < view.state.doc.length) br.after(emptyRun(line.to + 1));
        }
      }
    }
  }
  function markIslands(scope) {
    for (const island of within(ISLANDS, scope))
      if (
        island.getAttribute("contenteditable") !== "false" &&
        !island.parentElement?.closest(ISLANDS)
      )
        island.setAttribute("contenteditable", "false");
  }
  // A render replaced the run holding the caret: put it back. `scope`: the
  // blocks just rendered, where the caret's place is.
  function settle(forced, scope) {
    // (A formula clicked open: the click left the focus where it was.)
    const focused =
      wanted !== null ||
      content.contains(document.activeElement) ||
      (document.activeElement === document.body &&
        lastHost !== null &&
        !lastHost.isConnected);
    const selection = window.getSelection(),
      main = view.state.selection.main;
    // When the run holding the caret is replaced, the browser leaves the
    // caret between blocks (it looked like the start of the paragraph, and
    // typing went astray). The caret stays only if it is still on text at
    // the place the source editor has.
    const node = selection.anchorNode,
      kept =
        node?.isConnected &&
        content.contains(node) &&
        usable(leafOf(node)) &&
        sourceAt(node, selection.anchorOffset) === main.anchor &&
        sourceAt(selection.focusNode, selection.focusOffset) === main.head;
    if (!focused || (kept && !forced)) return;
    // A new empty place to type only where no block holds the position: a
    // caret inside a paragraph (by a formula, on a marker) stays in it.
    const anchor =
        pointAt(main.anchor, scope) ||
        afterInline(main.anchor, scope) ||
        beforeInline(main.anchor, scope) ||
        (scope && pointAt(main.anchor)) ||
        nearest(main.anchor) ||
        placeholder(main.anchor, scope),
      head = main.head === main.anchor ? anchor : pointAt(main.head);
    if (!anchor || !head) return;
    const host = hosts.hostOf(anchor.node) || hosts.adopt(anchor.node);
    if (host && document.activeElement !== host)
      host.focus({ preventScroll: true });
    selection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      head.node,
      head.offset,
    );
  }

  // An empty run at a source position: it takes the first keystroke there.
  function emptyRun(pos) {
    const run = document.createElement("span");
    run.className = "direct-empty";
    run.dataset.textFrom = String(pos);
    run.dataset.textTo = String(pos);
    run.textContent = "​";
    starts.set(run, { pos, version: changes.length });
    return run;
  }
  // Just after a formula, emphasis, code or link that ends where the caret
  // is, with no text after it yet (a formula's closing "$" was typed last).
  function afterInline(pos, scope) {
    let best = null;
    for (const el of within(".formula[data-to],[data-src-to]", scope)) {
      if (el.parentElement.closest(ISLANDS) || !el.closest(BLOCKS)) continue;
      const end = isFormula(el)
        ? now(el, el.dataset.to)
        : now(el, el.dataset.srcTo);
      // The outermost of nested ones: the last that ends here.
      if (end === pos) best = el;
    }
    if (!best) return null;
    const next = best.nextSibling;
    if (next?.nodeType === 1 && empty(next))
      return { node: next.firstChild || next, offset: 0 };
    const run = emptyRun(pos);
    best.after(run);
    patched?.(run);
    return { node: run.firstChild, offset: 0 };
  }
  // Just before one that starts where the caret is, with no text before it.
  function beforeInline(pos, scope) {
    for (const el of within(
      ".formula[data-from],[data-src-from]:not(.md-escape)",
      scope,
    )) {
      if (el.parentElement.closest(ISLANDS) || !el.closest(BLOCKS)) continue;
      const start = isFormula(el)
        ? now(el, el.dataset.from)
        : now(el, el.dataset.srcFrom);
      // The outermost of nested ones: the first that starts here.
      if (start !== pos) continue;
      const prev = el.previousSibling;
      if (prev?.nodeType === 1 && empty(prev))
        return { node: prev.firstChild || prev, offset: 0 };
      const run = emptyRun(pos);
      el.before(run);
      patched?.(run);
      return { node: run.firstChild, offset: 0 };
    }
    return null;
  }
  // A position inside a block that no text run holds (in a formula, on a
  // marker): the nearest place in that block's text. Not when a list item
  // or quote with no text yet holds it (placeholder's case).
  function nearest(pos) {
    let block = null;
    for (const el of content.querySelectorAll("[data-from]"))
      if (
        !el.matches(".formula,code") &&
        !el.parentElement.closest(ISLANDS) &&
        now(el, el.dataset.from) <= pos &&
        pos < now(el, el.dataset.to)
      )
        block = el;
    const units = block?.matches(BLOCKS) ? unitsOf(block) : [];
    if (!units.length) return null;
    // On a line of the block's text (a list item's range runs on over the
    // blank lines after it).
    const line = (at) => view.state.doc.lineAt(at).number;
    if (
      line(pos) < line(unitStart(units[0])) ||
      line(pos) > line(unitEnd(units.at(-1)))
    )
      return null;
    let best = null,
      gap = Infinity;
    for (const unit of units)
      for (const end of [false, true]) {
        const distance = Math.abs(
          (end ? unitEnd(unit) : unitStart(unit)) - pos,
        );
        if (distance < gap) [gap, best] = [distance, { unit, end }];
      }
    const { unit, end } = best;
    if (!isFormula(unit) && !isEscape(unit))
      return empty(unit)
        ? { node: unit.firstChild || unit, offset: 0 }
        : textPoint(unit, end ? textOf(unit).length : 0);
    const at = [...unit.parentNode.childNodes].indexOf(unit);
    return { node: unit.parentNode, offset: end ? at + 1 : at };
  }
  // A caret where the source has no text yet (a new empty paragraph or list
  // item): an empty run there takes the first keystroke.
  function placeholder(pos, scope) {
    // Never inside a table: a paragraph there would be typed into the row.
    for (const table of within("table[data-from]", scope))
      if (
        now(table, table.dataset.from) < pos &&
        pos < now(table, table.dataset.to)
      )
        return null;
    const run = emptyRun(pos);
    const item = [...within("li[data-from]", scope)].find(
      (li) =>
        now(li, li.dataset.from) <= pos &&
        pos <= now(li, li.dataset.to) &&
        !leaves(li).length,
    );
    if (item) {
      item.append(run);
      patched?.(run);
      return { node: run.firstChild, offset: 0 };
    }
    // Inside the quote that holds the position (a new quote line), else at
    // the top level; after the last block before it, a formula included.
    let host = null;
    for (const quote of within("blockquote[data-from]", scope))
      if (
        now(quote, quote.dataset.from) <= pos &&
        pos <= now(quote, quote.dataset.to) &&
        !quote.parentElement.closest(ISLANDS)
      )
        host = quote;
    let before = null;
    for (const block of host || !scope
      ? (host || content).querySelectorAll("[data-from]")
      : within("[data-from]", scope)) {
      if (
        block.parentElement.closest(ISLANDS) ||
        block.parentElement.closest("[data-from]") !== host
      )
        continue;
      const end = block.classList.contains("math-block")
        ? now(block, block.dataset.from) +
          view.state.doc
            .sliceString(
              now(block, block.dataset.from),
              now(block, block.dataset.to),
            )
            .trimEnd().length
        : now(block, block.dataset.to);
      if (end <= pos) before = block;
    }
    // Not after the blocks just rendered: look through the whole note.
    if (!before && !host && scope) return placeholder(pos);
    const paragraph = document.createElement("p");
    paragraph.className = "direct-empty-block";
    paragraph.append(run);
    // After a heading: first in its section's body.
    const body =
      before?.parentElement.classList.contains("note-section") &&
      before.parentElement.querySelector(":scope > .section-body");
    if (body) body.prepend(paragraph);
    else if (before) before.after(paragraph);
    else (host || content).prepend(paragraph);
    patched?.(paragraph);
    return { node: run.firstChild, offset: 0 };
  }
}
