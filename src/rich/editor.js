// The editor of Edit mode: the note as its rendered blocks, typed into
// directly (ProseMirror). The Markdown stays the note's own: each change is
// written back block by block (markdown.js) and handed to the app as the
// note's new text, which saves, undoes in the source pane and marks the tab
// as before. Each tab keeps its own editor state, so its undo history and
// caret survive switching tabs.
import {
  EditorState,
  Plugin,
  Selection,
  TextSelection,
} from "prosemirror-state";
import { Slice, Fragment } from "prosemirror-model";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { gapCursor, GapCursor } from "prosemirror-gapcursor";
import { history, undo, redo } from "prosemirror-history";
import {
  baseKeymap,
  chainCommands,
  deleteSelection,
  joinBackward,
  selectNodeBackward,
  toggleMark,
  exitCode,
} from "prosemirror-commands";
import {
  splitListItem,
  sinkListItem,
  liftListItem,
} from "prosemirror-schema-list";
import {
  inputRules,
  InputRule,
  wrappingInputRule,
  textblockTypeInputRule,
} from "prosemirror-inputrules";
import {
  tableEditing,
  goToNextCell,
  isInTable,
  selectedRect,
  addRowAfter,
  TableMap,
} from "prosemirror-tables";
import { t } from "../../desktop/i18n.mjs";
import { loadMath, mayContainMath } from "../markdown.js";
import {
  schema,
  load,
  write,
  mapBlocks,
  asTyped,
  mapText,
  parseBlocks,
} from "./markdown.js";
import {
  DrawnView,
  closer,
  stepIn,
  grab,
  openSelected,
  watchFormulas,
  openMathBlock,
} from "./math.js";
import { linkPlugins, editLink } from "./links.js";
import { details } from "./details.js";
import { selectionBubble } from "./bubble.js";
import { codeColors } from "./code.js";
import { imageBox } from "./images.js";
import { findPlugin } from "./find.js";
import { attachMenu } from "./menu.js";
import { CodeView, TableView } from "./blocks.js";

const S = schema.nodes;
const M = schema.marks;

// Where each top-level block starts in the note (for reading positions).
const startsOf = new WeakMap();
// The block holding the caret is always laid out (rich.css lets the browser
// skip blocks off screen; a block just made must not be skipped).
const caretBlock = new Plugin({
  props: {
    decorations(state) {
      const { $from } = state.selection;
      if ($from.depth < 1) return null;
      const from = $from.before(1);
      const node = state.doc.child($from.index(0));
      return DecorationSet.create(state.doc, [
        Decoration.node(from, from + node.nodeSize, { class: "rich-current" }),
      ]);
    },
  },
});

class ImageView {
  constructor(node, fileId) {
    this.dom = document.createElement("img");
    const src = node.attrs.src || "";
    this.dom.alt = node.attrs.alt || "";
    this.dom.decoding = "async";
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src))
      this.dom.src = src;
    else if (fileId && src && !/^(?:https?:|javascript:|blob:)/i.test(src))
      this.dom.src = `folio-asset://${fileId}/?path=${encodeURIComponent(src)}`;
    else
      this.dom.alt = t("{alt}（远程图片默认禁用）", {
        alt: node.attrs.alt || t("图片"),
      });
  }
  ignoreMutation() {
    return true;
  }
}
class TaskView {
  constructor(node, view, getPos) {
    this.dom = document.createElement("input");
    this.dom.type = "checkbox";
    this.dom.className = "task-list-item-checkbox";
    this.dom.checked = node.attrs.checked;
    this.dom.setAttribute("aria-label", t("切换任务完成状态"));
    this.dom.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = getPos();
      if (typeof pos !== "number") return;
      const now = view.state.doc.nodeAt(pos);
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, null, { checked: !now.attrs.checked }),
      );
    });
  }
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

// Up and Down in a table go to the cell above or below (the table plugin
// expects paragraphs in cells; a note's cells hold their text directly),
// and from the first or last row out of the table.
const cellVert = (dir) => (state, dispatch, view) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const $h = sel.$head;
  const role = $h.parent.type.spec.tableRole;
  if (role !== "cell" && role !== "header_cell") return false;
  if (!view.endOfTextblock(dir < 0 ? "up" : "down")) return false;
  const table = $h.node(-2);
  const tableStart = $h.start(-2);
  const map = TableMap.get(table);
  const rect = map.findCell($h.before() - tableStart);
  const row = dir < 0 ? rect.top - 1 : rect.bottom;
  let next;
  if (row >= 0 && row < map.height) {
    const cell = tableStart + map.map[row * map.width + rect.left];
    const size = state.doc.nodeAt(cell).content.size;
    next = TextSelection.create(
      state.doc,
      cell + 1 + Math.min($h.parentOffset, size),
    );
  } else {
    const $out = state.doc.resolve(dir < 0 ? $h.before(-2) : $h.after(-2));
    next = GapCursor.valid($out)
      ? new GapCursor($out)
      : Selection.near($out, dir);
  }
  dispatch?.(state.tr.setSelection(next).scrollIntoView());
  return true;
};
// Out of a quote, a list or a fold with the arrows: from its last line
// (first line, going up) the caret stops after (before) it when no line of
// text follows (precedes) there, as between two tables; typing there
// starts a paragraph. Without this only Enter twice got out of a quote at
// the end of a note.
const leaveBlock = (dir, side) => (state, dispatch, view) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const $h = sel.$head;
  if ($h.depth < 2) return false;
  if (side === "left" || side === "right") {
    if ($h.parentOffset !== (dir < 0 ? 0 : $h.parent.content.size))
      return false;
  } else if (!view.endOfTextblock(side)) return false;
  for (let d = $h.depth - 1; d >= 1; d--) {
    const node = $h.node(d);
    if ($h.index(d) !== (dir < 0 ? 0 : node.childCount - 1)) return false;
    const role = node.type.spec.tableRole;
    if (role) return false;
  }
  const $out = state.doc.resolve(dir < 0 ? $h.before(1) : $h.after(1));
  const beside = dir < 0 ? $out.nodeBefore : $out.nodeAfter;
  if (beside?.isTextblock) return false;
  dispatch?.(state.tr.setSelection(new GapCursor($out)).scrollIntoView());
  return true;
};
// Enter in a table goes to the cell below (a new row after the last).
const cellBelow = (state, dispatch, view) => {
  if (!isInTable(state)) return false;
  const go = (st) => {
    const rect = selectedRect(st);
    if (rect.top + 1 >= rect.map.height) return false;
    const pos =
      rect.tableStart +
      rect.map.map[(rect.top + 1) * rect.map.width + rect.left];
    view.dispatch(
      st.tr.setSelection(TextSelection.near(st.doc.resolve(pos + 1))),
    );
    return true;
  };
  if (go(state)) return true;
  addRowAfter(state, dispatch);
  return go(view.state);
};
// Enter in a task item starts the next with an empty box; Enter in an empty
// task item (only its box) leaves the list like any empty item.
const splitItem = (state, dispatch, view) => {
  const { $from } = state.selection;
  const para = $from.parent;
  const isTask =
    $from.depth >= 2 &&
    $from.node(-1).type === S.list_item &&
    para.firstChild?.type === S.task_box;
  if (isTask && para.childCount === 1) {
    const tr = state.tr.delete($from.start(), $from.start() + 1);
    view.dispatch(tr);
    return liftListItem(S.list_item)(view.state, view.dispatch);
  }
  if (!splitListItem(S.list_item)(state, dispatch)) return false;
  if (isTask) {
    const st = view.state;
    view.dispatch(
      st.tr.insert(st.selection.from, [S.task_box.create(), schema.text(" ")]),
    );
  }
  return true;
};
// Ctrl+Home/End: the note's first or last place; beside a block that takes
// no caret of its own (a table, a formula, a diagram), the gap before or
// after it, where typing starts a paragraph.
const edge = (dir) => (state, dispatch) => {
  const { doc } = state;
  const block = dir < 0 ? doc.firstChild : doc.lastChild;
  let sel;
  if (block?.isTextblock)
    sel = dir < 0 ? TextSelection.atStart(doc) : TextSelection.atEnd(doc);
  else {
    const $pos = doc.resolve(dir < 0 ? 0 : doc.content.size);
    sel = GapCursor.valid($pos)
      ? new GapCursor($pos)
      : dir < 0
        ? TextSelection.atStart(doc)
        : TextSelection.atEnd(doc);
  }
  dispatch?.(state.tr.setSelection(sel).scrollIntoView());
  return true;
};
// Enter at the end of a paragraph reading ```` ```js ````, `$$` or `---`
// makes a code block, a display formula or a rule (as in Typora); typed
// alone they stay text, so `---x` or `$$` within a line can be typed.
const blockOnEnter = (state, dispatch) => {
  const { $cursor } = state.selection;
  const para = $cursor?.parent;
  if (!para || para.type !== S.paragraph) return false;
  if ($cursor.parentOffset !== para.content.size) return false;
  if (para.childCount !== 1 || !para.firstChild.isText) return false;
  const text = para.textContent;
  const from = $cursor.before();
  const to = $cursor.after();
  const tr = state.tr;
  let m;
  if ((m = /^(```|~~~)([\w+#.-]*)$/.exec(text))) {
    tr.replaceWith(
      from,
      to,
      S.code_block.create({ markup: m[1], params: m[2] }),
    );
    tr.setSelection(TextSelection.create(tr.doc, from + 1));
  } else if (text === "$$") {
    tr.replaceWith(from, to, openMathBlock());
    tr.setSelection(TextSelection.create(tr.doc, from + 1));
  } else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) {
    tr.replaceWith(from, to, [
      S.horizontal_rule.create({ markup: text }),
      S.paragraph.create(),
    ]);
    tr.setSelection(TextSelection.create(tr.doc, from + 2));
  } else return false;
  dispatch?.(tr.scrollIntoView());
  return true;
};
// Inline code: at the edge of a code span, typing goes into the code or
// beside it. Left and Right first step out of the code or into it (the
// span shows a ring while typing would go in), then move on; moving up to
// an edge keeps the side the caret came from.
const inCode = (node) => !!node && !!M.code.isInSet(node.marks);
const codeEdge = (dir) => (state, dispatch) => {
  const { $cursor } = state.selection;
  if (!$cursor || !$cursor.parent.inlineContent) return false;
  if ($cursor.parent.type === S.code_block) return false;
  const before = $cursor.nodeBefore;
  const after = $cursor.nodeAfter;
  const tr = state.tr;
  if (inCode(before) !== inCode(after)) {
    const marks = state.storedMarks || $cursor.marks();
    const inside = !!M.code.isInSet(marks);
    const ahead = inCode(dir > 0 ? after : before);
    if (ahead === inside) return false;
    const code = inCode(before) ? before : after;
    const plain = code === before ? after : before;
    tr.setStoredMarks(
      ahead ? code.marks : plain?.marks || M.code.removeFromSet(code.marks),
    );
  } else {
    // One step up to an edge, along text: the side the caret came from.
    const crossed = dir > 0 ? after : before;
    if (!crossed?.isText) return false;
    const $to = state.doc.resolve($cursor.pos + dir);
    if ($to.parent !== $cursor.parent) return false;
    const b = $to.nodeBefore;
    const a = $to.nodeAfter;
    if (inCode(b) === inCode(a)) return false;
    const code = inCode(b) ? b : a;
    const plain = code === b ? a : b;
    tr.setSelection(TextSelection.create(state.doc, $to.pos));
    tr.setStoredMarks(
      inCode(crossed)
        ? code.marks
        : plain?.marks || M.code.removeFromSet(code.marks),
    );
  }
  dispatch?.(tr.scrollIntoView());
  return true;
};
// The code span the caret would type into, at its edge, shows a ring.
const codeRing = new Plugin({
  props: {
    decorations(state) {
      const { $cursor } = state.selection;
      if (!$cursor || !$cursor.parent.inlineContent) return null;
      const before = $cursor.nodeBefore;
      const after = $cursor.nodeAfter;
      if (inCode(before) === inCode(after)) return null;
      const marks = state.storedMarks || $cursor.marks();
      if (!M.code.isInSet(marks)) return null;
      const parent = $cursor.parent;
      const back = inCode(before);
      let from = $cursor.pos;
      let to = $cursor.pos;
      for (
        let i = back ? $cursor.index() - 1 : $cursor.index();
        i >= 0 && i < parent.childCount && inCode(parent.child(i));
        i += back ? -1 : 1
      )
        if (back) from -= parent.child(i).nodeSize;
        else to += parent.child(i).nodeSize;
      return DecorationSet.create(state.doc, [
        Decoration.inline(from, to, { class: "rich-code-in" }),
      ]);
    },
  },
});
const hardBreak = (state, dispatch) => {
  dispatch?.(
    state.tr.replaceSelectionWith(S.hard_break.create()).scrollIntoView(),
  );
  return true;
};

const rules = inputRules({
  rules: [
    // $x$ typed becomes a formula; $$ and a space starts a display formula.
    new InputRule(
      /(?<![$\\\w])\$([^$\s](?:[^$]*[^$\s])?)\$$/,
      (state, m, start, end) =>
        state.tr.replaceWith(
          start,
          end,
          S.math_inline.create({ tex: m[1], raw: m[0] }),
        ),
    ),
    new InputRule(/^\$\$\s$/, (state, _m, start) => {
      const $start = state.doc.resolve(start);
      if (
        $start.parent.type !== S.paragraph ||
        $start.parent.textContent.trim() !== "$$"
      )
        return null;
      const from = $start.before();
      const tr = state.tr.replaceWith(from, $start.after(), openMathBlock());
      return tr.setSelection(TextSelection.create(tr.doc, from + 1));
    }),
    wrappingInputRule(/^\s*([-+*])\s$/, S.bullet_list, (m) => ({
      bullet: m[1],
    })),
    wrappingInputRule(
      /^(\d+)([.)])\s$/,
      S.ordered_list,
      (m) => ({ order: +m[1], delim: m[2] }),
      (m, node) => node.childCount + node.attrs.order === +m[1],
    ),
    new InputRule(/^\[([ xX])\]\s$/, (state, m, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.depth < 2 || $start.node(-1).type !== S.list_item) return null;
      return state.tr.replaceWith(start, end, [
        S.task_box.create({ checked: m[1] !== " " }),
        schema.text(" "),
      ]);
    }),
    wrappingInputRule(/^\s*>\s$/, S.blockquote),
    textblockTypeInputRule(/^(#{1,6})\s$/, S.heading, (m) => ({
      level: m[1].length,
      markup: "#",
    })),
    textblockTypeInputRule(/^(```|~~~)([\w+#.-]*)\s$/, S.code_block, (m) => ({
      markup: m[1],
      params: m[2],
    })),
  ],
});

// The relative position in a block where its text (atoms as one
// character, blocks parted by a line break) reaches `count` characters.
const flat = (node, to = node.content.size) =>
  node.textBetween(0, to, "\n", "￼");
// A formula in `next` whose source, in the typed text `text`, holds the
// typed place `k` between its delimiters.
function typedInFormula(next, text, k) {
  let hit = null;
  next.descendants((node, pos) => {
    if (hit) return false;
    if (node.type !== S.math_inline) return true;
    const raw = node.attrs.raw;
    for (let s = text.indexOf(raw); s >= 0; s = text.indexOf(raw, s + 1))
      if (s < k && k < s + raw.length) {
        hit = { node, pos, offset: k - s };
        break;
      }
    return false;
  });
  return hit;
}
const MARKUP = /[^\p{L}\p{N}\s]/u;
function placeOfText(node, count) {
  for (let r = 0; r <= node.content.size; r++)
    if (flat(node, r).length >= count) return r;
  return node.content.size;
}

export function createRichEditor({
  host,
  getTheme,
  follow,
  onText,
  onFocus,
  typeMarkdown = () => true,
  // Start a comment on the selection (comments.js); none without comments.
  comment = null,
}) {
  let current = null;
  // Text just typed (handleTextInput), for typing as Markdown.
  let typed = null;
  // Typing as Markdown: once what was typed makes the block read
  // differently (`**bold**` closed), the block becomes what it reads as and
  // the caret stays after the typed text. Not in code, nor in a formula's
  // source.
  function retype(old, state, hit) {
    const end = hit.from + hit.text.length;
    if (end > state.doc.content.size) return null;
    const $end = state.doc.resolve(end);
    if ($end.depth < 1 || !$end.parent.inlineContent) return null;
    if ($end.parent.type === S.code_block) return null;
    if ($end.marks().some((m) => m.type === M.math_src || m.type === M.code))
      return null;
    const index = $end.index(0);
    const pos = $end.before(1);
    const $old = old.doc.resolve(Math.min(hit.from, old.doc.content.size));
    if ($old.depth < 1 || $old.index(0) !== index || $old.before(1) !== pos)
      return null;
    const after = state.doc.child(index);
    const next = asTyped(current.rich.loaded, pos, old.doc.child(index), after);
    if (!next) return null;
    const k = flat(after, end - pos - 1).length;
    const r = placeOfText(next, mapText(flat(after), flat(next), k));
    const tr = state.tr.replaceWith(
      pos + 1,
      pos + 1 + after.content.size,
      next.content,
    );
    tr.setNodeMarkup(pos, next.type, next.attrs);
    // Typed between a formula's delimiters (`$|$`, then `x`): it is a
    // formula now, still open as its source, the caret where it was.
    const inside = typedInFormula(next, flat(after), k);
    if (inside) {
      const at = pos + 1 + inside.pos;
      const marks = M.math_src.create().addToSet(inside.node.marks);
      tr.replaceWith(at, at + 1, schema.text(inside.node.attrs.raw, marks));
      tr.setSelection(TextSelection.create(tr.doc, at + inside.offset));
      return tr;
    }
    const $at = tr.doc.resolve(Math.min(pos + 1 + r, tr.doc.content.size));
    tr.setSelection(TextSelection.near($at));
    // Typing on after a closed `**bold**` is plain again.
    const $c = tr.selection.$from;
    tr.setStoredMarks(
      $c.marks().filter((m) => $c.nodeAfter && m.isInSet($c.nodeAfter.marks)),
    );
    return tr;
  }
  let composeStart = null;
  const typing = new Plugin({
    props: {
      handleDOMEvents: {
        compositionstart(view) {
          composeStart = { state: view.state, doc: current };
          return false;
        },
        compositionend(view) {
          const begun = composeStart;
          composeStart = null;
          if (!begun || !typeMarkdown()) return false;
          const start = begun.state;
          setTimeout(() => {
            if (view.composing || current !== begun.doc || !current?.rich)
              return;
            const now = view.state;
            const from = start.selection.from;
            const to = now.selection.from;
            if (to <= from || to > now.doc.content.size) return;
            const text = now.doc.textBetween(from, to, "\n", "");
            const near =
              now.doc.textBetween(Math.max(0, from - 1), from, "\n", "") +
              now.doc.textBetween(
                to,
                Math.min(now.doc.content.size, to + 1),
                "\n",
                "",
              );
            if (!MARKUP.test(text) && !(/\S/.test(text) && MARKUP.test(near)))
              return;
            const fix = retype(start, now, { from, to: from, text });
            if (fix) view.dispatch(fix);
          }, 30);
          return false;
        },
      },
      handleTextInput(view, from, to, text) {
        // Markup typed, or text typed next to markup (`x` typed between
        // two `$` makes a formula).
        const { doc } = view.state;
        const near =
          doc.textBetween(Math.max(0, from - 1), from, "\n", "") +
          doc.textBetween(to, Math.min(doc.content.size, to + 1), "\n", "");
        typed =
          typeMarkdown() &&
          (MARKUP.test(text) || (/\S/.test(text) && MARKUP.test(near)))
            ? { from, to, text }
            : null;
        return false;
      },
      // Pasted plain text is read as Markdown (not in code).
      clipboardTextParser(text, $context, plain) {
        if (plain || !typeMarkdown() || $context.parent.type === S.code_block)
          return null;
        const nodes = parseBlocks(text, current?.rich?.loaded.env);
        if (!nodes.length) return null;
        // Within a line, the spaces around the pasted text are kept.
        const [, lead, trail] = /^([ \t]*)[\s\S]*?([ \t]*)$/.exec(text);
        if (
          nodes.length === 1 &&
          nodes[0].type === S.paragraph &&
          (lead || trail)
        ) {
          let inner = nodes[0].content;
          if (lead) inner = Fragment.from(schema.text(lead)).append(inner);
          if (trail) inner = inner.append(Fragment.from(schema.text(trail)));
          nodes[0] = nodes[0].copy(inner);
        }
        return Slice.maxOpen(Fragment.from(nodes));
      },
    },
  });
  const nodeViews = {
    math_inline: (n, v, g) => new DrawnView(n, v, g, options()),
    math_display: (n, v, g) => new DrawnView(n, v, g, options()),
    raw_block: (n, v, g) => new DrawnView(n, v, g, options()),
    raw_inline: (n, v, g) => new DrawnView(n, v, g, options()),
    image: (n) => new ImageView(n, current?.fileId),
    task_box: (n, v, g) => new TaskView(n, v, g),
    code_block: (n) => new CodeView(n),
    table: () => new TableView(),
  };
  const options = () => ({ fileId: current?.fileId, theme: getTheme() });
  const finder = findPlugin();
  const plugins = [
    rules,
    typing,
    details,
    selectionBubble({ comment }),
    codeColors,
    imageBox,
    finder.plugin,
    caretBlock,
    codeRing,
    closer,
    history(),
    ...linkPlugins({ follow: (href) => follow(href) }),
    keymap({
      ArrowUp: chainCommands(cellVert(-1), leaveBlock(-1, "up")),
      ArrowDown: chainCommands(cellVert(1), leaveBlock(1, "down")),
    }),
    tableEditing(),
    gapCursor(),
    keymap({
      "Mod-Home": edge(-1),
      // Find (and replace) in the note, the selection as what to find.
      "Mod-f": (state) => {
        const { from, to } = state.selection;
        const text = state.doc.textBetween(from, to);
        finder.open(text.includes("\n") ? "" : text);
        return true;
      },
      "Mod-End": edge(1),
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
      "Mod-b": toggleMark(M.strong),
      "Mod-i": toggleMark(M.em),
      "Mod-k": (_s, _d, view) => editLink(view),
      ArrowLeft: chainCommands(
        codeEdge(-1),
        stepIn(-1),
        leaveBlock(-1, "left"),
      ),
      ArrowRight: chainCommands(codeEdge(1), stepIn(1), leaveBlock(1, "right")),
      Enter: chainCommands(openSelected, cellBelow, blockOnEnter, splitItem),
      "Shift-Enter": chainCommands(exitCode, hardBreak),
      Tab: chainCommands(
        goToNextCell(1),
        sinkListItem(S.list_item),
        () => true,
      ),
      "Shift-Tab": chainCommands(
        goToNextCell(-1),
        liftListItem(S.list_item),
        () => true,
      ),
      Backspace: chainCommands(
        deleteSelection,
        grab(-1),
        joinBackward,
        selectNodeBackward,
      ),
      Delete: chainCommands(deleteSelection, grab(1)),
    }),
    keymap(baseKeymap),
  ];

  function stateFor(doc) {
    const loaded = load(doc.text);
    const state = EditorState.create({ doc: loaded.doc, plugins });
    const written = write(state.doc, loaded);
    startsOf.set(state.doc, spans(written));
    return { loaded, state, text: doc.text, written: written.text };
  }
  function spans({ starts, text }) {
    return {
      from: starts,
      to: starts.map((s, i) =>
        i + 1 < starts.length ? starts[i + 1] : text.length,
      ),
    };
  }

  const view = new EditorView(host, {
    state: EditorState.create({ schema }),
    nodeViews,
    attributes: { spellcheck: "false", "aria-label": t("编辑笔记") },
    dispatchTransaction(tr) {
      const doc = current;
      if (!doc?.rich) return;
      // The note changed elsewhere (the source pane, the disk) since the
      // editor last read it: no change is made on the old note; it is read
      // again first.
      if (tr.docChanged && doc.rich.text !== doc.text) {
        show(doc);
        return;
      }
      const old = view.state;
      let { state, transactions } = old.applyTransaction(tr);
      const changed = transactions.some((x) => x.docChanged);
      if (changed) {
        for (const x of transactions) mapBlocks(doc.rich.loaded, x.mapping);
        const hit = typed;
        typed = null;
        const fix = hit && !view.composing && retype(old, state, hit);
        if (fix) {
          const more = state.applyTransaction(fix);
          state = more.state;
          for (const x of more.transactions)
            mapBlocks(doc.rich.loaded, x.mapping);
        }
        const written = write(state.doc, doc.rich.loaded);
        startsOf.set(state.doc, spans(written));
        doc.rich.text = written.text;
      }
      doc.rich.state = state;
      view.updateState(state);
      if (changed) onText(doc, doc.rich.text);
    },
    handleDOMEvents: {
      focus: () => {
        onFocus?.();
        return false;
      },
    },
  });
  const detachMenu = attachMenu(view, { follow: (href) => follow(href) });
  const scroller = host.parentElement;
  watchFormulas(scroller);
  // The top-level block holding a note offset: its position and source span.
  function blockAt(from) {
    const starts = startsOf.get(view.state.doc);
    if (!starts) return null;
    let index = 0;
    for (let i = 0; i < starts.from.length; i++)
      if (starts.from[i] <= from) index = i;
    let pos = 0;
    view.state.doc.forEach((_n, p, i) => i === index && (pos = p));
    return { pos, from: starts.from[index], to: starts.to[index] };
  }
  // Between offsets in the note and places in the editor, within a block:
  // the block's text and its Markdown line up by their common characters
  // (markup such as `**` falls between).
  function offsetAt(pos, bias = 1) {
    const starts = startsOf.get(view.state.doc);
    if (!starts || !current) return null;
    const doc = view.state.doc;
    const index = Math.min(doc.resolve(pos).index(0), doc.childCount - 1);
    let start = 0;
    doc.forEach((_n, p, i) => i === index && (start = p));
    const node = doc.child(index);
    const source = current.text.slice(starts.from[index], starts.to[index]);
    const inner = Math.max(0, Math.min(pos - start - 1, node.content.size));
    return (
      starts.from[index] +
      mapText(flat(node), source, flat(node, inner).length, bias)
    );
  }
  function posAt(offset, bias = 1) {
    const hit = blockAt(offset);
    if (!hit || !current) return null;
    const node = view.state.doc.nodeAt(hit.pos);
    const source = current.text.slice(hit.from, hit.to);
    const k = mapText(source, flat(node), Math.max(0, offset - hit.from), bias);
    return hit.pos + 1 + placeOfText(node, k);
  }
  // For tests and debugging on the dev server only.
  if (import.meta.env?.DEV) window.__richView = view;

  // Show doc in its own editor state. When its text changed elsewhere
  // (source pane, disk, a proposal) since the editor last wrote it, the note
  // is read again (its undo history here starts over) and the caret stays
  // about where it was. Returns false, editing nothing, for a note that
  // would not be written back exactly as it is.
  async function show(doc) {
    if (mayContainMath(doc.text)) await loadMath();
    const again = doc.rich && doc.rich.text !== doc.text;
    const at = again ? doc.rich.state.selection.from : 0;
    if (!doc.rich || again) {
      const next = stateFor(doc);
      if (next.written !== doc.text) return false;
      doc.rich = next;
    }
    current = doc;
    if (view.state !== doc.rich.state) view.updateState(doc.rich.state);
    if (again) {
      const pos = Math.min(at, view.state.doc.content.size);
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(pos)),
        ),
      );
    }
    return true;
  }
  return {
    view,
    show,
    get doc() {
      return current;
    },
    // Draw formulas and diagrams again (theme, math loaded).
    redraw() {
      if (!current?.rich) return;
      view.setProps({ nodeViews: { ...nodeViews } });
    },
    focus() {
      view.focus();
    },
    hasFocus: () => view.hasFocus(),
    // Find in the note (Ctrl+F outside the editor itself).
    find: (text) => finder.open(text),
    finding: () => finder.isOpen(),
    // Select note offsets from..to (a word double-clicked while reading).
    selectSource(from, to) {
      const a = posAt(from);
      const b = to > from ? posAt(to, -1) : a;
      if (a === null || b === null) return;
      view.dispatch(
        view.state.tr
          .setSelection(
            TextSelection.between(
              view.state.doc.resolve(a),
              view.state.doc.resolve(Math.max(a, b)),
            ),
          )
          .scrollIntoView(),
      );
      view.focus();
    },
    // The caret at a point of the page (a drop).
    caretAtPoint(x, y) {
      const hit = view.posAtCoords({ left: x, top: y });
      if (!hit) return;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(hit.pos)),
        ),
      );
    },
    // The selection as offsets in the note (null when nothing is selected).
    selected() {
      const { from, to, empty } = view.state.selection;
      if (empty) return null;
      const a = offsetAt(from);
      const b = offsetAt(to, -1);
      return a === null || b === null || b <= a ? null : { from: a, to: b };
    },
    // The text at note offsets from..to, as DOM ranges (comments).
    ranges(from, to, out = []) {
      const a = posAt(from);
      const b = posAt(to, -1);
      if (a === null || b === null || b <= a) return out;
      try {
        const start = view.domAtPos(a);
        const end = view.domAtPos(b);
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        out.push(range);
      } catch {}
      return out;
    },
    // The caret at a note offset (the start of the block holding it).
    caretAt(from) {
      const hit = blockAt(from);
      if (!hit) return;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(hit.pos + 1)),
        ),
      );
    },
    // The reading position, as the reading view keeps it ({from, y,
    // fraction}): the block at the top of the pane, and how far into it.
    anchor() {
      if (scroller.scrollTop < 2) return { from: 0, y: 0, top: true };
      const box = scroller.getBoundingClientRect();
      const y = box.top + 32;
      const hit = view.posAtCoords({ left: box.left + box.width / 2, top: y });
      const starts = startsOf.get(view.state.doc);
      if (!hit || !starts) return { from: 0, y: 0, top: true };
      const index = view.state.doc.resolve(hit.pos).index(0);
      let pos = 0;
      view.state.doc.forEach((_n, p, i) => i === index && (pos = p));
      const dom = view.nodeDOM(pos);
      const r = dom?.getBoundingClientRect?.();
      const fraction = r
        ? Math.max(0, Math.min(1, (y - r.top) / Math.max(1, r.height)))
        : 0;
      return { from: starts.from[index] ?? 0, y: 32, fraction };
    },
    // Scroll to a reading position (from the reading view or this pane).
    scrollTo(anchor, behavior = "instant") {
      if (!anchor || anchor.top) return scroller.scrollTo({ top: 0, behavior });
      const hit = blockAt(anchor.from || 0);
      const dom = hit && view.nodeDOM(hit.pos);
      if (!dom?.getBoundingClientRect) return;
      const r = dom.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const fraction =
        anchor.fraction ??
        Math.min(
          1,
          ((anchor.from || 0) - hit.from) / Math.max(1, hit.to - hit.from),
        );
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          r.top -
          box.top +
          fraction * r.height -
          (anchor.y ?? 32),
        behavior,
      });
    },
    destroy() {
      detachMenu();
      view.destroy();
    },
  };
}
