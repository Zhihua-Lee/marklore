// Image layout in the editor (see ../image-layout.js for how it is kept in
// the note): lines of images aligned to a side and rows of images shown as
// the reading view shows them.
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema, imageLine } from "./markdown.js";

const S = schema.nodes;

// The class a paragraph of images takes, as in the reading view.
export function lineClass(node) {
  const images = imageLine(node);
  if (!images) return null;
  const align = images[0].attrs.align;
  const aligned =
    align && images.every((image) => image.attrs.align === align)
      ? " image-align-" + align
      : "";
  if (images.length > 1 && images.every((image) => image.attrs.width))
    return "image-row" + aligned;
  return images.length === 1 || aligned ? "image-line" + aligned : null;
}
// The paragraphs between from and to: their classes.
function decorate(doc, from, to, found = []) {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type === S.paragraph) {
      const name = lineClass(node);
      if (name)
        found.push(Decoration.node(pos, pos + node.nodeSize, { class: name }));
    }
    return false;
  });
  return found;
}
export const imageLines = new Plugin({
  state: {
    init: (_, { doc }) =>
      DecorationSet.create(doc, decorate(doc, 0, doc.content.size)),
    // Only the paragraphs a change touched are looked at again.
    apply(tr, set) {
      if (!tr.docChanged) return set;
      const doc = tr.doc;
      set = set.map(tr.mapping, doc);
      tr.mapping.maps.forEach((map, i) => {
        const rest = tr.mapping.slice(i + 1);
        map.forEach((_a, _b, start, end) => {
          let from = rest.map(start, -1);
          let to = rest.map(end, 1);
          const old = set.find(from, to);
          for (const d of old) {
            from = Math.min(from, d.from);
            to = Math.max(to, d.to);
          }
          set = set.remove(old);
          const fresh = decorate(doc, from, Math.min(to, doc.content.size));
          set = set.add(
            doc,
            fresh.filter(
              (d) => !set.find(d.from, d.to).some((x) => x.from === d.from),
            ),
          );
        });
      });
      return set;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});
