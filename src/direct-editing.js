import { textOffset } from "./positions.js";
import { t } from "../desktop/i18n.mjs";
import "./direct-editing.css";

// Direct editing (Settings → Editing, off by default): in Edit mode the
// rendered note takes typing. Each keystroke becomes an edit of the source at
// the exact place its text came from (the preview's text runs carry their
// source offsets, see markdown.js), applied through the source editor: its
// history is the undo history, and nothing else in the file changes. There is
// no document model and no conversion back to Markdown.
//
// Formulas, code, tables, diagrams, images and HTML stay whole ("islands");
// they keep their pencil (block editing).
//
// Between full renders, typing patches the text node in place and keeps the
// list of changes made since: a text run's rendered offsets map through them.
// The next render (app.js, after a short pause) replaces what changed, and the
// caret comes back to its place in the source.

const ISLANDS = [
  ".formula",
  ".math-block",
  ".code-block",
  "pre",
  ".table-scroll",
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
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,dt,dd";
const leafOf = (node) =>
  (node?.nodeType === 1 ? node : node?.parentElement)?.closest(
    "[data-text-from]",
  ) || null;

export function createDirectEditor({
  content,
  view,
  getDocument,
  enabled,
  renderNow,
  report,
  // Typing patched this part of the page (the render cache must know).
  patched,
}) {
  let changes = [],
    starts = new WeakMap(),
    composition = null,
    on = false;
  const usable = (leaf) =>
    leaf && content.contains(leaf) && !leaf.parentElement.closest(ISLANDS);

  // Source offset of a text run's start, now.
  function mapped(pos, from = 0, assoc = 1) {
    for (let i = from; i < changes.length; i++)
      pos = changes[i].mapPos(pos, assoc);
    return pos;
  }
  function leafStart(leaf) {
    const own = starts.get(leaf);
    return own
      ? mapped(own.pos, own.version)
      : mapped(Number(leaf.dataset.textFrom));
  }
  const leafEnd = (leaf) => leafStart(leaf) + leaf.textContent.length;
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
        ? leafStart(leaf) + (empty(leaf) ? 0 : textOffset(leaf, node, offset))
        : null;
    const element = node.nodeType === 1 ? node : node.parentElement,
      block = element?.closest(BLOCKS);
    if (!block || !content.contains(block)) return null;
    const runs = leaves(block);
    const point = document.createRange();
    point.setStart(node, offset);
    // The nearest run after the point, else the last one before it.
    for (const leaf of runs) {
      const range = document.createRange();
      range.selectNodeContents(leaf);
      if (range.compareBoundaryPoints(Range.START_TO_START, point) >= 0)
        return leafStart(leaf);
    }
    return runs.length ? leafEnd(runs.at(-1)) : null;
  }
  // A DOM point for a source offset, after a render.
  function pointAt(pos) {
    let best = null;
    for (const leaf of content.querySelectorAll("[data-text-from]")) {
      if (!usable(leaf)) continue;
      const from = leafStart(leaf),
        to = from + (empty(leaf) ? 0 : leaf.textContent.length);
      if (pos < from || pos > to) continue;
      // Prefer the run that starts here over the one that ends here.
      if (!best || from === pos) best = { leaf, offset: pos - from };
      if (from === pos) break;
    }
    if (!best) return null;
    const node = best.leaf.firstChild;
    return node?.nodeType === 3
      ? { node, offset: empty(best.leaf) ? 0 : best.offset }
      : { node: best.leaf, offset: 0 };
  }

  // Apply a change and remember it for mapping the runs not yet re-rendered.
  // patch: the page already shows it (typed into a run), so no render yet.
  let patching = false;
  function commit(change, caret, userEvent, patch = false) {
    patching = patch;
    const transaction = view.state.update({
      changes: change,
      selection: { anchor: caret },
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
      text = empty(leaf) ? "" : leaf.textContent;
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
      at = from + (empty(leaf) ? 0 : textOffset(leaf, node, offset));
    commit({ from: at, insert: text }, at + text.length, "input.type", true);
    starts.set(leaf, { pos: from, version: changes.length });
    if (empty(leaf)) {
      leaf.classList.remove("direct-empty");
      leaf.textContent = text;
      caretTo(leaf.firstChild, text.length);
    } else {
      node.insertData(offset, text);
      caretTo(node, offset + text.length);
    }
    verify(leaf);
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
    verify(leaf);
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
        ".formula,[data-src-from][data-src-to],code[data-text-from]",
      ) || []),
    ].filter((el) => range.intersectsNode(el) && covered(el));
    const outer = wholes.filter(
      (el) => !wholes.some((other) => other !== el && other.contains(el)),
    );
    for (const el of outer) {
      const from = Number(el.dataset.srcFrom ?? el.dataset.from),
        to = Number(el.dataset.srcTo ?? el.dataset.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
      list.push({ from: mapped(from), to: mapped(to) });
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
      return { change: { from: pos, insert }, caret: pos + insert.length };
    }
    const quote = line.match(/^(\s*(?:>\s?)+)/);
    if (quote) {
      const insert = "\n" + quote[1].trimEnd() + "\n" + quote[1];
      return { change: { from: pos, insert }, caret: pos + insert.length };
    }
    return { change: { from: pos, insert: "\n\n" }, caret: pos + 2 };
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
      return { change: { from: lineStart, to: pos }, caret: lineStart };
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
    return { change: { from: end, to: pos }, caret: end };
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
    return { change: { from: pos, to: start }, caret: pos };
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

  function structural({ change, caret }, userEvent) {
    commit(change, caret, userEvent);
    refresh();
  }
  function refuse() {
    report?.(t("这里不能直接编辑：公式、代码和表格请用铅笔就地编辑"));
  }

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
    if (
      type === "insertText" &&
      collapsed &&
      event.data &&
      range.startContainer.nodeType === 3 &&
      usable(leaf) &&
      !empty(leaf)
    ) {
      const from = leafStart(leaf),
        at = from + textOffset(leaf, range.startContainer, range.startOffset);
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
          from:
            from + textOffset(run, target.startContainer, target.startOffset),
          to: from + textOffset(run, target.startContainer, target.endOffset),
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
    if (collapsed && type === "deleteContentBackward" && usable(leaf)) {
      const join = joinBackward(leaf);
      return join ? structural(join, "delete") : refuse();
    }
    if (collapsed && type === "deleteContentForward" && usable(leaf)) {
      const join = joinForward(leaf);
      return join ? structural(join, "delete") : refuse();
    }
    // Everything else rebuilds from the source.
    let edits = collapsed ? [] : rangeChanges(range);
    if (edits === null) return refuse();
    const at = collapsed
      ? sourceAt(range.startContainer, range.startOffset)
      : edits[0].from;
    if (at === null) return refuse();
    if (type === "insertParagraph") {
      if (edits.length) commit(edits, at, "delete");
      const next = newBlock(edits.length ? changes.at(-1).mapPos(at) : at);
      return structural(next, "input");
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
      { change: all, caret: at + insert.length },
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
        if (on) {
          content.contentEditable = "true";
          content.spellcheck = false;
        } else content.removeAttribute("contenteditable");
        content.classList.toggle("direct-editing", on);
      }
      if (!on) return;
      if (doc && doc.previewText === doc.text) {
        changes = [];
        starts = new WeakMap();
      }
      for (const island of content.querySelectorAll(ISLANDS))
        if (!island.parentElement.closest(ISLANDS))
          island.contentEditable = "false";
      // A render replaced the run holding the caret: put it back.
      const focused =
        document.activeElement === content ||
        content.contains(document.activeElement);
      const selection = window.getSelection(),
        kept =
          selection.anchorNode?.isConnected &&
          content.contains(selection.anchorNode);
      const forced = restore;
      restore = false;
      if (!focused || (kept && !forced)) return;
      const main = view.state.selection.main;
      const anchor = pointAt(main.anchor) || placeholder(main.anchor),
        head = main.head === main.anchor ? anchor : pointAt(main.head);
      if (!anchor || !head) return;
      selection.setBaseAndExtent(
        anchor.node,
        anchor.offset,
        head.node,
        head.offset,
      );
    },
  };

  // A caret where the source has no text yet (a new empty paragraph or list
  // item): an empty run there takes the first keystroke.
  function placeholder(pos) {
    const run = document.createElement("span");
    run.className = "direct-empty";
    run.dataset.textFrom = String(pos);
    run.dataset.textTo = String(pos);
    run.textContent = "​";
    const item = [...content.querySelectorAll("li[data-from]")].find(
      (li) =>
        Number(li.dataset.from) <= pos &&
        pos <= Number(li.dataset.to) &&
        !leaves(li).length,
    );
    if (item) {
      item.append(run);
      return { node: run.firstChild, offset: 0 };
    }
    let before = null;
    for (const block of content.querySelectorAll("[data-from]")) {
      if (block.closest(ISLANDS) || block.parentElement.closest("[data-from]"))
        continue;
      if (Number(block.dataset.to) <= pos) before = block;
    }
    const paragraph = document.createElement("p");
    paragraph.className = "direct-empty-block";
    paragraph.append(run);
    if (before) before.after(paragraph);
    else content.prepend(paragraph);
    return { node: run.firstChild, offset: 0 };
  }
}
