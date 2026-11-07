// Images in the editor: a click selects one, and a small box under it (like
// a link's) shows its address and its description (alt text) to change, or
// removes it. Enter or leaving the box applies; Escape goes back.
import { Plugin, NodeSelection } from "prosemirror-state";
import { t } from "../../desktop/i18n.mjs";
import { schema } from "./markdown.js";

const imageAt = (state) => {
  const sel = state.selection;
  return sel instanceof NodeSelection && sel.node.type === schema.nodes.image
    ? { pos: sel.from, node: sel.node }
    : null;
};

export const imageBox = new Plugin({
  view(view) {
    const dom = document.createElement("div");
    dom.className = "rich-image-box";
    dom.hidden = true;
    const field = (label) => {
      const input = document.createElement("input");
      input.type = "text";
      input.spellcheck = false;
      input.placeholder = label;
      input.setAttribute("aria-label", label);
      return input;
    };
    const src = field(t("图片地址"));
    const alt = field(t("说明文字"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = t("移除图片");
    dom.append(src, alt, remove);
    document.body.append(dom);
    let shown = null;
    const inside = () => dom.contains(document.activeElement);
    function place() {
      const hit = imageAt(view.state);
      if (!hit || !(view.hasFocus() || inside())) {
        if (!inside()) {
          dom.hidden = true;
          shown = null;
        }
        return;
      }
      const img = view.nodeDOM(hit.pos);
      const box = img?.getBoundingClientRect?.();
      if (!box) return;
      dom.style.left = Math.max(8, Math.min(box.left, innerWidth - 420)) + "px";
      dom.style.top = Math.min(innerHeight - 44, box.bottom + 6) + "px";
      if (shown?.pos !== hit.pos || shown.node !== hit.node) {
        src.value = hit.node.attrs.src || "";
        alt.value = hit.node.attrs.alt || "";
      }
      shown = hit;
      dom.hidden = false;
    }
    // The image as changed in the box, in place (it stays selected).
    function apply() {
      const hit = shown;
      const now = hit && view.state.doc.nodeAt(hit.pos);
      if (!now || now.type !== schema.nodes.image) return;
      const attrs = { ...now.attrs, src: src.value.trim(), alt: alt.value };
      if (attrs.src === now.attrs.src && attrs.alt === now.attrs.alt) return;
      const tr = view.state.tr.setNodeMarkup(hit.pos, null, attrs);
      view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, hit.pos)));
    }
    for (const input of [src, alt])
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
          view.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          view.focus();
        }
      });
    const away = () =>
      setTimeout(() => {
        if (view.hasFocus() || inside()) return;
        apply();
        dom.hidden = true;
        shown = null;
      }, 0);
    src.addEventListener("focusout", away);
    alt.addEventListener("focusout", away);
    view.dom.addEventListener("focusout", away);
    dom.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") e.preventDefault();
    });
    remove.addEventListener("click", () => {
      const hit = shown;
      if (hit && view.state.doc.nodeAt(hit.pos)?.type === schema.nodes.image)
        view.dispatch(view.state.tr.delete(hit.pos, hit.pos + 1));
      view.focus();
    });
    const follows = () => (dom.hidden ? null : place());
    addEventListener("scroll", follows, true);
    addEventListener("resize", follows);
    return {
      update: place,
      destroy() {
        dom.remove();
        removeEventListener("scroll", follows, true);
        removeEventListener("resize", follows);
      },
    };
  },
});
