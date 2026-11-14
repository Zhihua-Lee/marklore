// Image layout in the editor (see ../image-layout.js for how it is kept in
// the note): lines of images aligned to a side and rows of images shown as
// the reading view shows them; handles to resize an image and buttons to
// align it.
import { Plugin, NodeSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { t } from "../../desktop/i18n.mjs";
import { icon } from "../icons.js";
import { percent } from "../image-layout.js";
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

// --- Size and alignment ----------------------------------------------------

// One change to the note, one step to undo: a step of its own even right
// after another.
export function apply(view, tr) {
  view.dispatch(closeHistory(tr));
}
// The image at pos with attrs changed, still selected.
export function changeImage(view, pos, attrs) {
  const node = view.state.doc.nodeAt(pos);
  if (node?.type !== S.image) return;
  const tr = view.state.tr.setNodeMarkup(pos, null, {
    ...node.attrs,
    ...attrs,
  });
  apply(view, tr.setSelection(NodeSelection.create(tr.doc, pos)));
}
// Where an image stands: alone on its line, in a row, or among text.
export function placeOf(state, pos) {
  const $pos = state.doc.resolve(pos);
  const images = imageLine($pos.parent);
  if (!images) return "text";
  return images.length === 1 ? "alone" : "row";
}

// Handles on the sides of a selected image: dragged, they change its width
// (a share of the text column; the height follows).
export const imageHandles = new Plugin({
  view(view) {
    const frame = document.createElement("div");
    frame.className = "rich-image-frame";
    frame.hidden = true;
    const handles = ["left", "right"].map((side) => {
      const handle = document.createElement("div");
      handle.className = "rich-image-handle";
      handle.dataset.side = side;
      frame.append(handle);
      return handle;
    });
    document.body.append(frame);
    let drag = null;
    const selected = () => {
      const sel = view.state.selection;
      return sel instanceof NodeSelection && sel.node.type === S.image
        ? { pos: sel.from, node: sel.node }
        : null;
    };
    function place() {
      const hit = drag || selected();
      const img = hit && view.nodeDOM(hit.pos);
      if (!hit || !img?.getBoundingClientRect || (!drag && !view.hasFocus())) {
        frame.hidden = true;
        return;
      }
      const r = img.getBoundingClientRect();
      Object.assign(frame.style, {
        left: r.left + "px",
        top: r.top + "px",
        width: r.width + "px",
        height: r.height + "px",
      });
      frame.hidden = !r.width;
    }
    for (const handle of handles)
      handle.addEventListener("pointerdown", (event) => {
        const hit = selected();
        const img = hit && view.nodeDOM(hit.pos);
        if (!img || event.button !== 0) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const line = img.parentElement;
        const style = getComputedStyle(line);
        const room =
          line.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        const place0 = placeOf(view.state, hit.pos);
        drag = {
          ...hit,
          img,
          x: event.clientX,
          width: img.getBoundingClientRect().width,
          room,
          dir: handle.dataset.side === "right" ? 1 : -1,
          // A centred image grows on both sides at once.
          factor: place0 === "alone" && !hit.node.attrs.align ? 2 : 1,
          share: null,
        };
        frame.classList.add("dragging");
      });
    frame.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const px = drag.width + (event.clientX - drag.x) * drag.dir * drag.factor;
      drag.share = Math.max(5, Math.min(100, (px / drag.room) * 100));
      drag.img.style.width = drag.share + "%";
      place();
    });
    const end = () => {
      if (!drag) return;
      const { pos, share, img } = drag;
      drag = null;
      frame.classList.remove("dragging");
      img.style.width = "";
      if (share !== null) changeImage(view, pos, { width: percent(share) });
      place();
    };
    frame.addEventListener("pointerup", end);
    frame.addEventListener("pointercancel", end);
    const follow = () => (frame.hidden ? null : place());
    addEventListener("scroll", follow, true);
    addEventListener("resize", follow);
    view.dom.addEventListener("focusout", () => setTimeout(place, 0));
    return {
      update: place,
      destroy() {
        frame.remove();
        removeEventListener("scroll", follow, true);
        removeEventListener("resize", follow);
      },
    };
  },
});

// Buttons for the image box (images.js): alignment and the original size.
export function layoutButtons(view) {
  const dom = document.createElement("div");
  dom.className = "rich-image-layout";
  const button = (label, content, run) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = content;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      if (shown) run(shown);
    });
    dom.append(b);
    return b;
  };
  const aligns = [
    ["left", t("靠左"), "alignLeft"],
    [null, t("居中"), "alignCenter"],
    ["right", t("靠右"), "alignRight"],
  ].map(([align, label, name]) => {
    const b = button(label, icon(name), (hit) =>
      changeImage(view, hit.pos, { align }),
    );
    b.dataset.align = align ?? "center";
    return b;
  });
  const reset = button(t("原始大小"), t("原始大小"), (hit) =>
    changeImage(view, hit.pos, { width: null }),
  );
  reset.classList.add("text");
  let shown = null;
  return {
    dom,
    update(hit) {
      shown = hit;
      const place = placeOf(view.state, hit.pos);
      for (const b of aligns) {
        b.hidden = place !== "alone";
        b.setAttribute(
          "aria-pressed",
          String((hit.node.attrs.align ?? "center") === b.dataset.align),
        );
      }
      reset.hidden = place === "row" || !hit.node.attrs.width;
      dom.hidden = [...dom.children].every((b) => b.hidden);
    },
  };
}
