// Image layout in the editor (see ../image-layout.js for how it is kept in
// the note): lines of images aligned to a side and rows of images shown as
// the reading view shows them; handles to resize an image, buttons to align
// it and to put it beside the block before (a row of images, or columns),
// dividers between the images of a row and between columns, and dragging an
// image to a side of another image or block.
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
function standing(doc, pos) {
  const $pos = doc.resolve(pos);
  const images = imageLine($pos.parent);
  if (!images) return null;
  const depth = $pos.depth;
  return {
    line: $pos.parent,
    linePos: $pos.before(),
    images,
    index: images.indexOf(doc.nodeAt(pos)),
    container: $pos.node(depth - 1),
    at: $pos.index(depth - 1),
  };
}

// --- Columns ---------------------------------------------------------------

// Columns as written: shares summing to 100. One column left is just its
// blocks; columns of one image each are a row of images.
export function columnsOf(columns) {
  if (!columns.length) return [];
  if (columns.length === 1) {
    const only = [];
    columns[0].forEach((block) => only.push(block));
    return only;
  }
  const shares = spread(
    columns.map((c) => c.attrs.width ?? 100 / columns.length),
    100,
  );
  const images = columns.map((column) => {
    const line = column.childCount === 1 && imageLine(column.firstChild);
    return line && line.length === 1 ? line[0] : null;
  });
  if (images.every(Boolean))
    return [
      rowOf(
        images.map((image, i) =>
          image.type.create({ ...image.attrs, width: percent(shares[i]) }),
        ),
      ),
    ];
  return [
    S.columns.create(
      null,
      columns.map((column, i) =>
        column.type.create({ width: shares[i] }, column.content),
      ),
    ),
  ];
}
const childrenOf = (node) => {
  const list = [];
  node.forEach((child) => list.push(child));
  return list;
};
// A new column for an image, given an even share among `count` columns.
const imageColumn = (image, count) =>
  S.column.create(
    { width: 100 / count },
    S.paragraph.create(null, loose(image)),
  );
// `columns` with `column` put in at `index`: the others give up room for it.
function withColumn(columns, column, index) {
  const list = childrenOf(columns);
  const share = column.attrs.width;
  const scaled = list.map((c) =>
    c.type.create(
      { width: (c.attrs.width ?? 100 / list.length) * (1 - share / 100) },
      c.content,
    ),
  );
  scaled.splice(index, 0, column);
  return columnsOf(scaled);
}
// The first image in tr's document from `from` on that is `image` (moved).
function selectImage(tr, from, image) {
  let found = null;
  tr.doc.nodesBetween(from, tr.doc.content.size, (node, pos) => {
    if (found !== null) return false;
    if (node.type === S.image && node.attrs.src === image.attrs.src) {
      found = pos;
      return false;
    }
  });
  if (found !== null) tr.setSelection(NodeSelection.create(tr.doc, found));
  return tr;
}

// The image at pos taken from where it stands (in tr): its line keeps the
// other images; a column left empty goes, and its columns are written again
// (one left: its blocks; images only: a row).
function removeImage(tr, pos) {
  const s = standing(tr.doc, pos);
  if (!s) {
    tr.delete(pos, pos + 1);
    return;
  }
  const rest = s.images.filter((_, i) => i !== s.index);
  const $line = tr.doc.resolve(s.linePos);
  if (s.container.type === S.column) {
    const depth = $line.depth;
    const columns = $line.node(depth - 1);
    const columnsPos = $line.before(depth - 1);
    const which = $line.index(depth - 1);
    const list = childrenOf(columns).flatMap((column, i) => {
      if (i !== which) return [column];
      const blocks = childrenOf(column).flatMap((block, k) =>
        k !== s.at ? [block] : rest.length ? [lineOf(rest)] : [],
      );
      return blocks.length ? [column.type.create(column.attrs, blocks)] : [];
    });
    tr.replaceWith(columnsPos, columnsPos + columns.nodeSize, columnsOf(list));
    return;
  }
  const end = s.linePos + s.line.nodeSize;
  if (rest.length) tr.replaceWith(s.linePos, end, lineOf(rest));
  else if (s.container.childCount > 1) tr.delete(s.linePos, end);
  else tr.replaceWith(s.linePos, end, S.paragraph.create());
}

// "Beside the block before": an image alone on its line joins the line of
// images before it (a row), or the columns before it (a column of its
// own), or goes beside the block before it in two columns. null when that
// cannot be done (no block before; columns in columns).
export function besideBefore(state, pos) {
  const s = standing(state.doc, pos);
  if (!s || s.images.length !== 1 || !s.at) return null;
  const image = s.images[0];
  const before = s.container.child(s.at - 1);
  const from = s.linePos - before.nodeSize;
  const to = s.linePos + s.line.nodeSize;
  const prior = imageLine(before);
  const tr = state.tr;
  if (prior) tr.replaceWith(from, to, rowOf([...prior, image]));
  else if (before.type === S.columns)
    tr.replaceWith(
      from,
      to,
      withColumn(
        before,
        imageColumn(image, before.childCount + 1),
        before.childCount,
      ),
    );
  else if (
    s.container.type === S.column ||
    (before.type === S.raw_block && before.attrs.kind === "frontmatter")
  )
    return null;
  else
    tr.replaceWith(
      from,
      to,
      S.columns.create(null, [
        S.column.create({ width: 50 }, before),
        imageColumn(image, 2),
      ]),
    );
  return selectImage(tr, from, image);
}
// An image taken out of a row, or out of its column: on its own line after
// the row (the columns), at its own size.
export function takeOut(state, pos) {
  const s = standing(state.doc, pos);
  if (!s) return null;
  const image = s.images[s.index];
  if (s.images.length > 1) {
    const rest = s.images.filter((_, i) => i !== s.index);
    const line = lineOf(rest);
    const tr = state.tr.replaceWith(s.linePos, s.linePos + s.line.nodeSize, [
      line,
      S.paragraph.create(null, loose(image)),
    ]);
    return selectImage(tr, s.linePos + line.nodeSize, image);
  }
  if (s.container.type !== S.column) return null;
  const $line = state.doc.resolve(s.linePos);
  const after = $line.after($line.depth - 1);
  const tr = state.tr;
  removeImage(tr, pos);
  const at = tr.mapping.map(after);
  tr.insert(at, S.paragraph.create(null, loose(image)));
  return selectImage(tr, at, image);
}

// A column in the editor: its share as the reading view has it; a divider
// being dragged changes it on the page before the note (not read back).
export class ColumnView {
  constructor(node) {
    this.dom = this.contentDOM = document.createElement("div");
    this.dom.className = "column";
    this.set(node);
  }
  set(node) {
    this.node = node;
    if (node.attrs.width === null) this.dom.style.removeProperty("--share");
    else this.dom.style.setProperty("--share", String(node.attrs.width));
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    this.set(node);
    return true;
  }
  ignoreMutation(mutation) {
    return mutation.type === "attributes" && mutation.target === this.dom;
  }
}

// Dividers between the images of a row and between columns: dragged, they
// move width from one to the one beside it.
export const imageDividers = new Plugin({
  view(view) {
    const divider = document.createElement("div");
    divider.className = "rich-divider";
    divider.hidden = true;
    document.body.append(divider);
    let hover = null;
    let drag = null;
    // The boundary near (x, y) between two items of a row or columns.
    function boundary(x, y) {
      for (const row of view.dom.querySelectorAll(".image-row, .columns")) {
        const box = row.getBoundingClientRect();
        if (y < box.top || y > box.bottom) continue;
        const columns = row.classList.contains("columns");
        const items = [...row.children].filter((el) =>
          columns
            ? el.classList.contains("column")
            : el.tagName === "IMG" && !el.matches(".ProseMirror-separator"),
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
            columns,
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
      const kind = hover.columns ? S.columns : S.paragraph;
      if (line?.type !== kind) return;
      const places = [];
      line.forEach((child, offset) => {
        if (child.type !== S.text && child.type !== S.soft_break)
          places.push(pos + 1 + offset);
      });
      const two = places.slice(hover.index, hover.index + 2);
      // An image's share is of the row; a column's, of all the columns.
      const room = hover.columns
        ? hover.items.reduce((w, el) => w + el.getBoundingClientRect().width, 0)
        : hover.row.clientWidth;
      const shares = hover.columns
        ? two.map(
            (p) =>
              view.state.doc.nodeAt(p).attrs.width ?? 100 / line.childCount,
          )
        : hover.items.map(
            (img) => (img.getBoundingClientRect().width / room) * 100,
          );
      drag = {
        ...hover,
        places: two,
        room: hover.columns ? (room / (shares[0] + shares[1])) * 100 : room,
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
      drag.result = [left, a + b - left].map((v) => Math.round(v * 10) / 10);
      drag.items.forEach((el, i) =>
        drag.columns
          ? el.style.setProperty("--share", String(drag.result[i]))
          : (el.style.width = drag.result[i] + "%"),
      );
      const r = drag.items[0].getBoundingClientRect();
      const n = drag.items[1].getBoundingClientRect();
      divider.style.left = (r.right + n.left) / 2 + "px";
    });
    const end = () => {
      if (!drag) return;
      const { places, items, result, columns } = drag;
      drag = null;
      divider.classList.remove("dragging");
      if (!columns) for (const img of items) img.style.width = "";
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
        else if (node?.type === S.column)
          tr.setNodeMarkup(p, null, { width: result[i] });
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

// --- Dragging an image to a side ---------------------------------------------

// Where a drop at (x, y) puts an image beside something: the side of an
// image in a line of images, of a column, or of a top-level block; null
// away from the sides.
function sideTarget(view, x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || !view.dom.contains(el)) return null;
  const near = (rect) => {
    const edge = Math.min(64, Math.max(24, rect.width * 0.2));
    if (x - rect.left < edge) return "left";
    if (rect.right - x < edge) return "right";
    return null;
  };
  const at = (dom) => {
    try {
      return view.posAtDOM(dom, 0);
    } catch {
      return null;
    }
  };
  const img = el.closest("img:not(.ProseMirror-separator)");
  if (img && view.dom.contains(img)) {
    const rect = img.getBoundingClientRect();
    const side = near(rect);
    const pos = at(img);
    if (side && view.state.doc.nodeAt(pos)?.type === S.image)
      return { kind: "image", pos, side, rect };
  }
  const column = el.closest(".column");
  if (column && view.dom.contains(column)) {
    const rect = column.getBoundingClientRect();
    const side = near(rect);
    const pos = at(column) - 1;
    if (side && view.state.doc.nodeAt(pos)?.type === S.column)
      return { kind: "column", pos, side, rect };
  }
  let block = el;
  while (block && block.parentElement !== view.dom) block = block.parentElement;
  if (!block) return null;
  const rect = block.getBoundingClientRect();
  const side = near(rect);
  const pos = at(block) - 1;
  const node = side && pos >= 0 && view.state.doc.nodeAt(pos);
  if (!node || view.state.doc.resolve(pos).depth) return null;
  if (node.type === S.raw_block && node.attrs.kind === "frontmatter")
    return null;
  return { kind: "block", pos, side, rect };
}

// The image at `from` moved beside the target (sideTarget): into its row,
// a column of its own, or two columns with the block. null when that
// cannot be done.
export function moveBeside(state, from, target) {
  const image = state.doc.nodeAt(from);
  if (image?.type !== S.image || from === target.pos) return null;
  const source = standing(state.doc, from);
  const tr = state.tr;
  const right = target.side === "right";
  if (target.kind === "image") {
    const line = standing(state.doc, target.pos);
    if (!line) return null;
    if (source && source.linePos === line.linePos) {
      // Within its own row: another place in it.
      const list = line.images.filter((_, i) => i !== source.index);
      const at = list.indexOf(line.images[line.index]) + (right ? 1 : 0);
      list.splice(at, 0, image);
      tr.replaceWith(
        line.linePos,
        line.linePos + line.line.nodeSize,
        rowOf(list),
      );
      return selectImage(tr, line.linePos, image);
    }
    removeImage(tr, from);
    const there = standing(tr.doc, tr.mapping.map(target.pos));
    if (!there || there.images.length !== line.images.length) return null;
    const list = [...there.images];
    list.splice(there.index + (right ? 1 : 0), 0, loose(image));
    tr.replaceWith(
      there.linePos,
      there.linePos + there.line.nodeSize,
      rowOf(list),
    );
    return selectImage(tr, there.linePos, image);
  }
  // A column, or a block: not the one the image comes from.
  const $from = state.doc.resolve(from);
  for (let d = $from.depth; d > 0; d--)
    if ($from.before(d) === target.pos) return null;
  if (target.kind === "column") {
    const $col = state.doc.resolve(target.pos);
    const columnsPos = $col.before();
    if (
      source &&
      $from.depth >= 3 &&
      $from.before($from.depth - 2) === columnsPos
    )
      return null;
    removeImage(tr, from);
    const at = tr.mapping.map(columnsPos);
    const columns = tr.doc.nodeAt(at);
    if (columns?.type !== S.columns) return null;
    tr.replaceWith(
      at,
      at + columns.nodeSize,
      withColumn(
        columns,
        imageColumn(image, columns.childCount + 1),
        $col.index() + (right ? 1 : 0),
      ),
    );
    return selectImage(tr, at, image);
  }
  removeImage(tr, from);
  const at = tr.mapping.map(target.pos);
  const block = tr.doc.nodeAt(at);
  if (!block) return null;
  const end = at + block.nodeSize;
  const line = imageLine(block);
  if (line) {
    const list = [...line];
    list.splice(right ? list.length : 0, 0, loose(image));
    tr.replaceWith(at, end, rowOf(list));
  } else if (block.type === S.columns)
    tr.replaceWith(
      at,
      end,
      withColumn(
        block,
        imageColumn(image, block.childCount + 1),
        right ? block.childCount : 0,
      ),
    );
  else {
    const columns = [
      S.column.create({ width: 50 }, block),
      imageColumn(image, 2),
    ];
    if (!right) columns.reverse();
    tr.replaceWith(at, end, S.columns.create(null, columns));
  }
  return selectImage(tr, at, image);
}
// An image dragged out of a row or a column to a place between blocks: on
// its own line there, at its own size.
export function moveOut(state, from, to) {
  const image = state.doc.nodeAt(from);
  const source = standing(state.doc, from);
  if (
    image?.type !== S.image ||
    !source ||
    (source.images.length < 2 && source.container.type !== S.column)
  )
    return null;
  const tr = state.tr;
  removeImage(tr, from);
  const at = tr.mapping.map(to, -1);
  tr.insert(at, S.paragraph.create(null, loose(image)));
  return selectImage(tr, at, image);
}

// Dragging an image: near a side of an image, a column or a block, a line
// shows where it goes; dropped there, it goes beside it. An image dragged
// out of a row or columns and dropped elsewhere stands alone again.
export const imageDrop = new Plugin({
  view(view) {
    const mark = document.createElement("div");
    mark.className = "rich-drop-side";
    mark.hidden = true;
    document.body.append(mark);
    const hide = () => (mark.hidden = true);
    view.dom.addEventListener("dragover", (event) => {
      const sel = view.state.selection;
      const dragged =
        view.dragging &&
        sel instanceof NodeSelection &&
        sel.node.type === S.image
          ? sel.from
          : null;
      const target =
        dragged !== null && sideTarget(view, event.clientX, event.clientY);
      if (!target || !moveBeside(view.state, dragged, target)) return hide();
      const x = target.side === "left" ? target.rect.left : target.rect.right;
      Object.assign(mark.style, {
        left: x + "px",
        top: target.rect.top + "px",
        height: target.rect.height + "px",
      });
      mark.hidden = false;
    });
    view.dom.addEventListener("dragleave", (event) => {
      if (!view.dom.contains(event.relatedTarget)) hide();
    });
    view.dom.addEventListener("dragend", hide);
    view.dom.addEventListener("drop", hide);
    return {
      destroy() {
        mark.remove();
      },
    };
  },
  props: {
    // An image moved within the note (still selected where it was).
    handleDrop(view, event, _slice, moved) {
      const sel = view.state.selection;
      if (
        !moved ||
        !(sel instanceof NodeSelection) ||
        sel.node.type !== S.image
      )
        return false;
      const from = sel.from;
      const target = sideTarget(view, event.clientX, event.clientY);
      let tr = target && moveBeside(view.state, from, target);
      if (!tr) {
        const hit = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!hit) return false;
        // Between the top-level blocks, on the side of the one dropped on
        // nearer the pointer.
        const $hit = view.state.doc.resolve(hit.pos);
        let to = hit.pos;
        if ($hit.depth) {
          const start = $hit.before(1);
          const dom = view.nodeDOM(start);
          const r = dom?.getBoundingClientRect?.();
          to =
            r && event.clientY > r.top + r.height / 2 ? $hit.after(1) : start;
        }
        tr = moveOut(view.state, from, to);
      }
      if (!tr) return false;
      event.preventDefault();
      apply(view, tr.scrollIntoView());
      return true;
    },
  },
});
