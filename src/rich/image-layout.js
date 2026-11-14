// Image layout in the editor (see ../image-layout.js for how it is kept in
// the note): lines of images aligned to a side and rows of images shown as
// the reading view shows them; handles to resize an image, buttons to align
// it and to put it beside the image before, and dividers between the images
// of a row.
import { Plugin, NodeSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { t } from "../../desktop/i18n.mjs";
import { icon } from "../icons.js";
import { percent, share, spread, rowTotal } from "../image-layout.js";
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

// --- Rows ----------------------------------------------------------------

// An image as it stands alone: its own size, centred.
const loose = (image) =>
  image.type.create({ ...image.attrs, width: null, align: null });
// A row of images: their shares kept in proportion and summing to what a
// row takes; one without a share (just added) gets an even part.
export function rowOf(images) {
  const even = 100 / images.length;
  const shares = spread(
    images.map((image) => share(image.attrs.width) ?? even),
    rowTotal(images.length),
  );
  const content = [];
  images.forEach((image, i) => {
    if (i) content.push(schema.text(" "));
    content.push(
      image.type.create({
        ...image.attrs,
        width: percent(shares[i]),
        align: null,
      }),
    );
  });
  return S.paragraph.create(null, content);
}
// A line of `images`: a row, or one image alone at its own size.
const lineOf = (images) =>
  images.length === 1
    ? S.paragraph.create(null, loose(images[0]))
    : rowOf(images);
// The image at pos in a line of images: the line, its place, its block.
function standing(state, pos) {
  const $pos = state.doc.resolve(pos);
  const images = imageLine($pos.parent);
  if (!images) return null;
  const depth = $pos.depth;
  return {
    line: $pos.parent,
    linePos: $pos.before(),
    images,
    index: images.indexOf(state.doc.nodeAt(pos)),
    container: $pos.node(depth - 1),
    at: $pos.index(depth - 1),
  };
}
// The last image of the line at `linePos` in tr's document, selected.
function selectLast(tr, linePos) {
  const line = tr.doc.nodeAt(linePos);
  let found = null;
  line.forEach((child, offset) => {
    if (child.type === S.image) found = linePos + 1 + offset;
  });
  if (found !== null) tr.setSelection(NodeSelection.create(tr.doc, found));
  return tr;
}

// "Beside the block before": an image alone on its line joins the line of
// images before it, as a row. null when that cannot be done.
export function besideBefore(state, pos) {
  const s = standing(state, pos);
  if (!s || s.images.length !== 1 || !s.at) return null;
  const before = s.container.child(s.at - 1);
  const prior = imageLine(before);
  if (!prior) return null;
  const from = s.linePos - before.nodeSize;
  const tr = state.tr.replaceWith(
    from,
    s.linePos + s.line.nodeSize,
    rowOf([...prior, s.images[0]]),
  );
  return selectLast(tr, from);
}
// An image in a row taken out of it: on its own line after the row, at its
// own size; the row keeps the others.
export function takeOut(state, pos) {
  const s = standing(state, pos);
  if (!s || s.images.length < 2) return null;
  const rest = s.images.filter((_, i) => i !== s.index);
  const line = lineOf(rest);
  const tr = state.tr.replaceWith(s.linePos, s.linePos + s.line.nodeSize, [
    line,
    S.paragraph.create(null, loose(s.images[s.index])),
  ]);
  return selectLast(tr, s.linePos + line.nodeSize);
}

// Dividers between the images of a row: dragged, they move width from one
// image to the one beside it.
export const imageDividers = new Plugin({
  view(view) {
    const divider = document.createElement("div");
    divider.className = "rich-divider";
    divider.hidden = true;
    document.body.append(divider);
    let hover = null;
    let drag = null;
    // The boundary near (x, y) between two items of a row.
    function boundary(x, y) {
      for (const row of view.dom.querySelectorAll(".image-row")) {
        const box = row.getBoundingClientRect();
        if (y < box.top || y > box.bottom) continue;
        const items = [...row.children].filter(
          (el) => el.tagName === "IMG" && !el.matches(".ProseMirror-separator"),
        );
        for (let i = 0; i + 1 < items.length; i++) {
          const a = items[i].getBoundingClientRect();
          const b = items[i + 1].getBoundingClientRect();
          if (Math.abs(a.top - b.top) > 1) continue;
          const mid = (a.right + b.left) / 2;
          if (Math.abs(x - mid) > Math.max(8, (b.left - a.right) / 2 + 4))
            continue;
          const top = Math.min(a.top, b.top);
          return {
            row,
            items: [items[i], items[i + 1]],
            index: i,
            x: mid,
            top,
            height: Math.max(a.bottom, b.bottom) - top,
          };
        }
      }
      return null;
    }
    function show(hit) {
      hover = hit;
      divider.hidden = !hit;
      if (!hit) return;
      Object.assign(divider.style, {
        left: hit.x + "px",
        top: hit.top + "px",
        height: hit.height + "px",
      });
    }
    const move = (event) => {
      if (drag || event.buttons) return;
      show(boundary(event.clientX, event.clientY));
    };
    view.dom.addEventListener("mousemove", move);
    view.dom.addEventListener("mouseleave", (event) => {
      if (!drag && event.relatedTarget !== divider) show(null);
    });
    divider.addEventListener("mouseleave", () => drag || show(null));
    divider.addEventListener("pointerdown", (event) => {
      if (!hover || event.button !== 0) return;
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
      const pos = view.posAtDOM(hover.row, 0) - 1;
      const line = view.state.doc.nodeAt(pos);
      if (line?.type !== S.paragraph) return;
      const places = [];
      line.forEach((child, offset) => {
        if (child.type === S.image) places.push(pos + 1 + offset);
      });
      const room = hover.row.clientWidth;
      const shares = hover.items.map(
        (img) => (img.getBoundingClientRect().width / room) * 100,
      );
      drag = {
        ...hover,
        places: places.slice(hover.index, hover.index + 2),
        room,
        shares,
        start: event.clientX,
        result: null,
      };
      divider.classList.add("dragging");
    });
    divider.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const [a, b] = drag.shares;
      const d = ((event.clientX - drag.start) / drag.room) * 100;
      const left = Math.max(8, Math.min(a + b - 8, a + d));
      drag.result = [left, a + b - left];
      drag.items.forEach((img, i) => (img.style.width = drag.result[i] + "%"));
      const r = drag.items[0].getBoundingClientRect();
      const n = drag.items[1].getBoundingClientRect();
      divider.style.left = (r.right + n.left) / 2 + "px";
    });
    const end = () => {
      if (!drag) return;
      const { places, items, result } = drag;
      drag = null;
      divider.classList.remove("dragging");
      for (const img of items) img.style.width = "";
      show(null);
      if (!result) return;
      const tr = view.state.tr;
      places.forEach((p, i) => {
        const node = tr.doc.nodeAt(p);
        if (node?.type === S.image)
          tr.setNodeMarkup(p, null, {
            ...node.attrs,
            width: percent(result[i]),
          });
      });
      apply(view, tr);
    };
    divider.addEventListener("pointerup", end);
    divider.addEventListener("pointercancel", end);
    const away = () => drag || show(null);
    addEventListener("scroll", away, true);
    return {
      update: away,
      destroy() {
        divider.remove();
        removeEventListener("scroll", away, true);
      },
    };
  },
});

// Buttons for the image box (images.js): alignment, the original size, and
// putting the image beside the one before it or taking it out of a row.
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
  const act = (make) => (hit) => {
    const tr = make(view.state, hit.pos);
    if (tr) apply(view, tr);
  };
  const beside = button(
    t("并排到前一块"),
    t("并排到前一块"),
    act(besideBefore),
  );
  const out = button(t("移出并排"), t("移出并排"), act(takeOut));
  for (const b of [beside, out]) b.classList.add("text");
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
      beside.hidden = !besideBefore(view.state, hit.pos);
      out.hidden = !takeOut(view.state, hit.pos);
      dom.hidden = [...dom.children].every((b) => b.hidden);
    },
  };
}
