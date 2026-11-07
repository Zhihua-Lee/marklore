// The formatting toolbar's actions (editing.js) on the editor of Edit mode.
// What is inserted whole (a table, a code block, a rule, images) is made by
// the same Markdown the source pane would get (markdown-edits.js) and read
// in, so both editors insert the same thing.
import { TextSelection } from "prosemirror-state";
import { Slice, Fragment } from "prosemirror-model";
import { toggleMark, setBlockType, wrapIn, lift } from "prosemirror-commands";
import { wrapInList, liftListItem } from "prosemirror-schema-list";
import { undo, redo } from "prosemirror-history";
import { markdownEdit } from "../markdown-edits.js";
import { highlightInk } from "../text-colors.js";
import { schema, parseBlocks } from "./markdown.js";
import { editLink } from "./links.js";
import { openMathBlock } from "./math.js";

const S = schema.nodes;
const M = schema.marks;

// The innermost list around the selection, or null.
function listAround(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === S.bullet_list || node.type === S.ordered_list)
      return { node, pos: $from.before(d), depth: d };
  }
  return null;
}
function inside(state, type) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type === type) return true;
  return false;
}
// A list of that type: turned into it, out of it, or made.
function toggleList(type) {
  return (state, dispatch) => {
    const list = listAround(state);
    if (list?.node.type === type)
      return liftListItem(S.list_item)(state, dispatch);
    if (list) {
      dispatch?.(state.tr.setNodeMarkup(list.pos, type));
      return true;
    }
    return wrapInList(type)(state, dispatch);
  };
}
// Task items: the box at the start of each item's paragraph, or away.
function toggleTask(state, dispatch, view) {
  if (!listAround(state) && !toggleList(S.bullet_list)(state, dispatch))
    return false;
  state = view.state;
  const { from, to } = state.selection;
  const paras = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type === S.paragraph && parent?.type === S.list_item)
      paras.push({ node, pos });
  });
  if (!paras.length) return false;
  const all = paras.every((p) => p.node.firstChild?.type === S.task_box);
  const tr = state.tr;
  for (const { node, pos } of paras.reverse()) {
    const has = node.firstChild?.type === S.task_box;
    if (all && has) {
      const space = node.child(1)?.text?.startsWith(" ") ? 1 : 0;
      tr.delete(pos + 1, pos + 2 + space);
    } else if (!has)
      tr.insert(pos + 1, [S.task_box.create(), schema.text(" ")]);
  }
  dispatch?.(tr);
  return true;
}
// Highlight and text color are inline HTML, as the source pane writes them.
const paints = {
  highlight: {
    tag: "mark",
    open: (c) =>
      `<mark style="background-color: ${c}; color: ${highlightInk(c)}">`,
    is: (m) => m.attrs.tag === "mark",
  },
  color: {
    tag: "span",
    open: (c) => `<span style="color: ${c}">`,
    is: (m) =>
      m.attrs.tag === "span" &&
      /(^|[\s;"'])color\s*:/i.test(
        m.attrs.open.replace(/background-color/gi, ""),
      ),
  },
};
function paint(action, color) {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const kind = paints[action];
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      for (const m of node.marks)
        if (m.type === M.html && kind.is(m))
          tr.removeMark(
            Math.max(from, pos),
            Math.min(to, pos + node.nodeSize),
            m,
          );
    });
    // A text color stays inside a highlight (`<mark><span style="color">`):
    // outside it, the highlight's own ink would cover it. Marks of one type
    // nest in the order added, so colors are taken off and put back on.
    const colors = [];
    if (color && action === "highlight")
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks)
          if (m.type === M.html && paints.color.is(m))
            colors.push([
              Math.max(from, pos),
              Math.min(to, pos + node.nodeSize),
              m,
            ]);
      });
    for (const [a, b, m] of colors) tr.removeMark(a, b, m);
    if (color)
      tr.addMark(
        from,
        to,
        M.html.create({
          tag: kind.tag,
          open: kind.open(color.toLowerCase()),
          close: `</${kind.tag}>`,
        }),
      );
    for (const [a, b, m] of colors) tr.addMark(a, b, m);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
function heading(level) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const now = $from.parent;
    if (!level || (now.type === S.heading && now.attrs.level === level))
      return setBlockType(S.paragraph)(state, dispatch);
    return setBlockType(S.heading, { level, markup: "#" })(state, dispatch);
  };
}
// Blocks made from Markdown, in place of the selection.
function insertMarkdown(action, options) {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const selected = state.doc.textBetween(from, to, "\n");
    const text = markdownEdit(selected, 0, selected.length, action, options)
      .changes.insert;
    const nodes = parseBlocks(text);
    if (!nodes.length) return false;
    dispatch?.(
      state.tr
        .replaceSelection(new Slice(Fragment.from(nodes), 0, 0))
        .scrollIntoView(),
    );
    return true;
  };
}
// A new block at the caret: after the line the caret is in (before it with
// the caret at its start; in its place when the line is empty), never
// splitting the sentence the caret is in. A selection is replaced. Returns
// the transaction and where the block starts, or null to let the
// selection's replacement place it.
function placeBlock(state, block) {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.depth < 1) return null;
  const line = $from.parent;
  const container = $from.node(-1);
  const index = $from.index(-1);
  const tr = state.tr;
  if (line.type === S.paragraph && !line.content.size) {
    if (!container.canReplaceWith(index, index + 1, block.type)) return null;
    tr.replaceWith($from.before(), $from.after(), block);
    return { tr, pos: $from.before() };
  }
  const at = $from.parentOffset === 0 ? index : index + 1;
  if (!container.canReplaceWith(at, at, block.type)) return null;
  const pos = at === index ? $from.before() : $from.after();
  tr.insert(pos, block);
  return { tr, pos };
}
// Where the block replacing the selection landed (the first such block
// from the selection on).
function landed(tr, from, test) {
  let at = null;
  tr.doc.nodesBetween(
    tr.mapping.map(from, -1),
    tr.doc.content.size,
    (node, pos) => {
      if (at === null && test(node)) at = pos;
      return at === null;
    },
  );
  return at;
}
// A display formula open for typing (as `$$` and a space do).
function mathBlock(state, dispatch) {
  const { from, to } = state.selection;
  const selected = state.doc.textBetween(from, to, "\n");
  const block = openMathBlock(selected);
  let placed = placeBlock(state, block);
  if (!placed) {
    const tr = state.tr.replaceSelectionWith(block);
    const pos = landed(
      tr,
      from,
      (node) => node.type === S.code_block && node.attrs.params === "$$",
    );
    placed = pos === null ? { tr, pos: null } : { tr, pos };
  }
  const { tr, pos } = placed;
  // The caret at the end of its TeX (the $$ lines are not text).
  if (pos !== null)
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + selected.length));
  dispatch?.(tr.scrollIntoView());
  return true;
}
// A code block: around the selected lines, or empty with the caret in it.
function codeBlock(options) {
  return (state, dispatch) => {
    if (!state.selection.empty)
      return insertMarkdown("code", options)(state, dispatch);
    const params = String(options.language || "").trim();
    const block = S.code_block.create({ params });
    let placed = placeBlock(state, block);
    if (!placed) {
      const tr = state.tr.replaceSelectionWith(block);
      placed = {
        tr,
        pos: landed(
          tr,
          state.selection.from,
          (node) => node.type === S.code_block && !node.content.size,
        ),
      };
    }
    const { tr, pos } = placed;
    if (pos !== null) tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
// An inline formula open for typing: its source around the selection.
function inlineMath(state, dispatch) {
  const { from, to } = state.selection;
  if (!state.selection.$from.parent.inlineContent) return false;
  const selected = state.doc.textBetween(from, to);
  const text = "$" + (selected || "x") + "$";
  const tr = state.tr.replaceWith(
    from,
    to,
    schema.text(text, [M.math_src.create()]),
  );
  dispatch?.(
    tr
      .setSelection(
        TextSelection.create(tr.doc, from + 1, from + text.length - 1),
      )
      .scrollIntoView(),
  );
  return true;
}

// Run a toolbar action on the editor; false when it does not apply here.
export function richCommand(view, action, options = {}) {
  const { state, dispatch } = view;
  const run = (command) => command(state, dispatch, view);
  let done;
  switch (action) {
    case "undo":
      done = run(undo);
      break;
    case "redo":
      done = run(redo);
      break;
    case "heading":
      done = run(heading(Number(options.level)));
      break;
    case "bold":
      done = run(toggleMark(M.strong));
      break;
    case "italic":
      done = run(toggleMark(M.em));
      break;
    case "strike":
      done = run(toggleMark(M.strike));
      break;
    case "inline":
      done = run(toggleMark(M.code));
      break;
    case "highlight":
    case "color":
      done = run(paint(action, options.color ?? null));
      break;
    case "bullet":
      done = run(toggleList(S.bullet_list));
      break;
    case "ordered":
      done = run(toggleList(S.ordered_list));
      break;
    case "task":
      done = run(toggleTask);
      break;
    case "quote":
      done = run(inside(state, S.blockquote) ? lift : wrapIn(S.blockquote));
      break;
    case "code":
      done = run(codeBlock(options));
      break;
    case "math":
      done = run(mathBlock);
      break;
    case "inlineMath":
      done = run(inlineMath);
      break;
    case "link":
      done = editLink(view);
      break;
    // From the link form: its text, linked, at the caret.
    case "linkText": {
      const href = String(options.url || "").trim();
      if (!href) return false;
      const text = String(options.label || "").trim() || href;
      const { from, to } = state.selection;
      dispatch(
        state.tr
          .replaceWith(from, to, schema.text(text, [M.link.create({ href })]))
          .scrollIntoView(),
      );
      done = true;
      break;
    }
    default:
      done = run(insertMarkdown(action, options));
  }
  view.focus();
  return done;
}

// Images picked or dropped (image-insertion.js), at the caret.
export function insertImages(view, images) {
  return insertMarkdown("images", { images })(view.state, view.dispatch);
}
