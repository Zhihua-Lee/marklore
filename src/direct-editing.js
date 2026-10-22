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
// Formulas, diagrams, images and HTML stay whole ("islands"); they keep
// their pencil (block editing). Table cells take typing on one line; a
// table's structure is the pencil's. A fenced code block takes typing where
// the page shows its text as the source has it (markdown.js marks those,
// "code-direct"); its fences are the pencil's.
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
// The text of a code block taking typing (one run, highlighted inside).
const codeOf = (node) =>
  (node?.nodeType === 1 ? node : node?.parentElement)?.closest(
    "pre > code[data-text-from]",
  ) || null;
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
    codeOf(leaf) ? leaf.textContent.replace(/\n$/, "") : leaf.textContent;
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
  // A block's text runs and inline formulas, in order.
  const isFormula = (el) => el.classList.contains("formula");
  function unitsOf(block) {
    return [
      ...block.querySelectorAll(
        "[data-text-from],.formula[data-from][data-to]",
      ),
    ].filter(
      (el) =>
        el.closest(BLOCKS) === block &&
        (isFormula(el) ? !el.parentElement.closest(ISLANDS) : usable(el)),
    );
  }
  const unitStart = (el) =>
    isFormula(el) ? now(el, el.dataset.from) : leafStart(el);
  const unitEnd = (el) =>
    isFormula(el) ? now(el, el.dataset.to) : leafEnd(el);
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

  // Typed text at a collapsed caret inside a run: patch the run in place.
  function typeInto(leaf, node, offset, text) {
    const from = leafStart(leaf),
      at = from + (empty(leaf) ? 0 : offsetIn(leaf, node, offset));
    commit({ from: at, insert: text }, at + text.length, "input.type", true);
    starts.set(leaf, { pos: from, version: changes.length });
    // A space at a run's edge would collapse, and the browser would then
    // type the next key elsewhere: show it as a no-break space, as the
    // browser does when it types one. (Code keeps its spaces.)
    const edge =
      !codeOf(leaf) &&
      (empty(leaf) || node.nodeType !== 3 || offset === node.length || !offset);
    const shown = edge ? text.replace(/^ | $/g, " ") : text;
    if (empty(leaf)) {
      leaf.classList.remove("direct-empty");
      if (!leaf.classList.length) leaf.removeAttribute("class");
      leaf.textContent = shown;
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
  let markupTimer = 0;
  function markupTyped(leaf, text) {
    clearTimeout(markupTimer);
    if (!/[$`)*_~=]/.test(text) || codeOf(leaf)) return;
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
    for (const node of nodes)
      if (node.nodeType === 1)
        for (const el of node.querySelectorAll(
          "strong,em,s,del,mark,ins,code,a,img,.formula",
        ))
          if (!el.parentElement.closest(".formula"))
            list.push(el.tagName + (isFormula(el) ? ".f" : ""));
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
      if (end > start) list.push({ from: start, to: end });
    }
    list.sort((x, y) => x.from - y.from);
    return list.length ? list : [{ from: a, to: b }];
  }

  // Enter: a new paragraph, list item or quote line at the caret.
  function newBlock(pos) {
    const text = view.state.doc.toString(),
      lineStart = text.lastIndexOf("\n", pos - 1) + 1,
      line = text.slice(
        lineStart,
        text.indexOf("\n", pos) < 0 ? undefined : text.indexOf("\n", pos),
      );
    // Spaces after the caret would start the new block: they go.
    const to =
      pos + /^[ \t]*/.exec(text.slice(pos, lineStart + line.length))[0].length;
    const item = line.match(/^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/);
    if (item) {
      // An empty item ends the list.
      if (
        lineStart + item[0].length >= pos &&
        !line.slice(item[0].length).trim()
      )
        return {
          change: { from: lineStart, to: lineStart + item[0].length },
          caret: lineStart,
        };
      const marker = item[3] ? String(Number(item[3]) + 1) + item[4] : item[2];
      const insert =
        "\n" + item[1] + marker + item[5] + (item[6] ? "[ ] " : "");
      return { change: { from: pos, to, insert }, caret: pos + insert.length };
    }
    const quote = line.match(/^(\s*(?:>\s?)+)/);
    if (quote) {
      const insert = "\n" + quote[1].trimEnd() + "\n" + quote[1];
      return { change: { from: pos, to, insert }, caret: pos + insert.length };
    }
    return { change: { from: pos, to, insert: "\n\n" }, caret: pos + 2 };
  }

  // Backspace at the start of a block: first its marker (# , - , > ) goes,
  // then the block joins the one before. Delete at the end joins the next.
  function joinBackward(leaf) {
    const block = leaf.closest(BLOCKS),
      runs = leaves(block);
    if (runs[0] !== leaf) return null;
    const pos = leafStart(leaf),
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
    const previous = previousRun(block);
    if (!previous) return null;
    const end = leafEnd(previous),
      gap = text.slice(end, pos);
    if (
      !/^\s*(?:(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|(?:>\s?)+)\s*)*$/.test(
        gap,
      )
    )
      return null;
    return {
      change: { from: end, to: pos },
      caret: end,
      around: [previous, leaf],
    };
  }
  function joinForward(leaf) {
    const block = leaf.closest(BLOCKS),
      runs = leaves(block);
    if (runs.at(-1) !== leaf) return null;
    const pos = leafEnd(leaf),
      next = nextRun(block);
    if (!next) return null;
    const start = leafStart(next),
      gap = view.state.doc.sliceString(pos, start);
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
      (block) => !block.closest(ISLANDS) && leaves(block).length,
    );
  }
  function previousRun(block) {
    const all = blocksOf(),
      at = all.indexOf(block);
    return at > 0 ? leaves(all[at - 1]).at(-1) : null;
  }
  function nextRun(block) {
    const all = blocksOf(),
      at = all.indexOf(block);
    return at >= 0 && at + 1 < all.length ? leaves(all[at + 1])[0] : null;
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
      if (between.toString() !== "") return null;
      const from = now(el, el.dataset.from ?? el.dataset.srcFrom),
        to = now(el, el.dataset.to ?? el.dataset.srcTo);
      return { change: { from, to }, caret: from, around: [el] };
    }
    return null;
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
          (!positioned(node) ||
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
    const from = now(first, first.dataset.from, -1),
      to = Math.min(view.state.doc.length, now(last, last.dataset.to, 1));
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
        return report?.(t("表格单元格里不能换行；改表格结构请用铅笔"));
      }
      const data =
        event.data ?? event.dataTransfer?.getData("text/plain") ?? null;
      if (data !== null && /[|\r\n]/.test(data) && type.startsWith("insert")) {
        event.preventDefault();
        const at = sourceAt(range.startContainer, range.startOffset);
        if (at === null || !collapsed) return refuse();
        const insert = data.replace(/\r?\n|\r/g, " ").replace(/\|/g, "\\|");
        return structural(
          {
            change: { from: at, insert },
            caret: at + insert.length,
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
        const line = view.state.doc.lineAt(at);
        const insert =
          "\n" + /^[ \t]*/.exec(view.state.doc.sliceString(line.from, at))[0];
        return typeInCode(code, range, insert);
      }
      if (
        collapsed &&
        type.startsWith("delete") &&
        at === (type.endsWith("Backward") ? leafStart(code) : leafEnd(code))
      )
        return event.preventDefault();
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
      native = {
        leaf: run,
        from,
        change: {
          from: from + offsetIn(run, target.startContainer, target.startOffset),
          to: from + offsetIn(run, target.startContainer, target.endOffset),
        },
      };
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
    }
    // Backspace right after a formula, or Delete right before one, takes the
    // whole formula (it is one thing on the page, like a character).
    if (
      collapsed &&
      (type === "deleteContentBackward" || type === "deleteContentForward")
    ) {
      const formula = formulaNextTo(range, type === "deleteContentForward");
      if (formula) return structural(formula, "delete");
    }
    // At a cell's edge there is nothing to join.
    if (collapsed && cell && type.startsWith("delete")) return;
    if (collapsed && type === "deleteContentBackward" && usable(leaf)) {
      const join = joinBackward(leaf);
      return join ? structural(join, "delete") : refuse();
    }
    if (collapsed && type === "deleteContentForward" && usable(leaf)) {
      const join = joinForward(leaf);
      return join ? structural(join, "delete") : refuse();
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
    let edits = reach
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
  function onCompositionStart() {
    if (!on) return;
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
    if (!on || !composition) return;
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
      if (empty(leaf)) return refresh();
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
      const anchor = sourceAt(range.startContainer, range.startOffset),
        head = sourceAt(range.endContainer, range.endOffset);
      if (anchor === null || head === null) return;
      const main = view.state.selection.main;
      if (main.anchor === anchor && main.head === head) return;
      view.dispatch({ selection: { anchor, head } });
    });
  }

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
    const range = selectedRange(),
      code = range && codeOf(range.startContainer);
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
      hosts.mark();
      if (doc && doc.previewText === doc.text) {
        changes = [];
        starts = new WeakMap();
        fresh = new WeakMap();
      }
      markIslands();
      const forced = restore;
      restore = false;
      settle(forced);
    },
  };

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
    const focused =
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
    const anchor =
        pointAt(main.anchor, scope) ||
        afterInline(main.anchor, scope) ||
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
    const run = emptyRun(pos);
    best.after(run);
    patched?.(run);
    return { node: run.firstChild, offset: 0 };
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
      if (now(block, block.dataset.to) <= pos) before = block;
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
