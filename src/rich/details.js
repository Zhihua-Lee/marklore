// `<details>` folds in the editor (markdown.js, "details"): folded as in the
// reading view unless written `<details open>`. The marker before the
// summary folds and unfolds; the caret going into a folded body unfolds it.
// Folding is the editor's view of the note, not part of the note.
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "./markdown.js";

const key = new PluginKey("details");
const folded = (doc, pos, node) =>
  Decoration.node(pos, pos + node.nodeSize, { class: "rich-folded" });

function initial(doc) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.details && !node.attrs.open)
      decos.push(folded(doc, pos, node));
  });
  return DecorationSet.create(doc, decos);
}

export const details = new Plugin({
  key,
  state: {
    init: (_c, state) => initial(state.doc),
    apply(tr, set, _old, state) {
      set = set.map(tr.mapping, tr.doc);
      const toggle = tr.getMeta(key);
      if (toggle != null) {
        const hit = set.find(toggle, toggle + 1).find((d) => d.from === toggle);
        if (hit) set = set.remove([hit]);
        else {
          const node = tr.doc.nodeAt(toggle);
          if (node) set = set.add(tr.doc, [folded(tr.doc, toggle, node)]);
        }
      }
      // The caret in a folded body opens the fold.
      const { $head } = state.selection;
      for (let d = $head.depth; d > 0; d--) {
        if ($head.node(d).type !== schema.nodes.details) continue;
        if ($head.index(d) === 0 && d === $head.depth - 1) continue;
        const pos = $head.before(d);
        const open = set.find(pos, pos + 1).filter((x) => x.from === pos);
        if (open.length) set = set.remove(open);
      }
      return set;
    },
  },
  props: {
    decorations: (state) => key.getState(state),
    // Down from a summary goes into its body (opening a folded one); the
    // browser would pass over a folded body.
    handleKeyDown(view, event) {
      if (event.key !== "ArrowDown" || event.shiftKey || event.altKey)
        return false;
      const { $head, empty } = view.state.selection;
      if (!empty || $head.parent.type !== schema.nodes.details_summary)
        return false;
      if (!view.endOfTextblock("down")) return false;
      const details = $head.node(-1);
      if (details.childCount < 2) return false;
      const start = $head.after();
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.near(view.state.doc.resolve(start + 1)))
          .scrollIntoView(),
      );
      return true;
    },
    // A click on the marker before a summary folds or unfolds.
    handleClickOn(view, _pos, node, nodePos, event) {
      if (node.type !== schema.nodes.details_summary) return false;
      const dom = view.nodeDOM(nodePos);
      if (!dom?.getBoundingClientRect) return false;
      if (event.clientX > dom.getBoundingClientRect().left + 2) return false;
      const $summary = view.state.doc.resolve(nodePos);
      view.dispatch(view.state.tr.setMeta(key, $summary.before()));
      return true;
    },
  },
});
