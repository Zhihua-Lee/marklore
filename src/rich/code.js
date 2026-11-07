// Code blocks in the editor colored as in the reading view: the same
// highlighter (highlighting.js), its spans laid over the code's text as
// decorations. A block's spans are kept with the block (unchanged blocks
// are the same node from one keystroke to the next).
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { highlightCode, onHighlighterReady } from "../highlighting.js";
import { schema } from "./markdown.js";

const key = new PluginKey("code");
const spansOf = new WeakMap();

// [from, to, class] over the code's text, from the highlighter's HTML.
function spans(node) {
  let list = spansOf.get(node);
  if (list) return list;
  list = [];
  const language = (node.attrs.params || "").trim().split(/\s/)[0];
  // An open formula or raw block (math.js) is not code.
  const html =
    language && language !== "$$" && !language.startsWith("\u0000")
      ? highlightCode(node.textContent, language)
      : "";
  if (html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    let at = 0;
    const walk = (parent, classes) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          const length = child.data.length;
          if (classes.length && length)
            list.push([at, at + length, classes.join(" ")]);
          at += length;
        } else if (child.nodeType === 1)
          walk(
            child,
            child.className ? [...classes, child.className] : classes,
          );
      }
    };
    walk(template.content, []);
    // Only when the highlighter has read the code as it is.
    if (at !== node.textContent.length) list = [];
  }
  if (html || !language) spansOf.set(node, list);
  return list;
}

function decorate(doc) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.code_block) {
      for (const [from, to, cls] of spans(node))
        decos.push(
          Decoration.inline(pos + 1 + from, pos + 1 + to, { class: cls }),
        );
      return false;
    }
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decos);
}

export const codeColors = new Plugin({
  key,
  state: {
    init: (_c, state) => decorate(state.doc),
    apply: (tr, set, _old, state) =>
      tr.docChanged || tr.getMeta(key) ? decorate(state.doc) : set,
  },
  props: { decorations: (state) => key.getState(state) },
  // Once the highlighter has loaded (on first use), color what waits.
  view(view) {
    let live = true;
    onHighlighterReady(() =>
      requestAnimationFrame(() => {
        if (live) view.dispatch(view.state.tr.setMeta(key, true));
      }),
    );
    return { destroy: () => (live = false) };
  },
});
