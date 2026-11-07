// Links in the editor, edited as in Notion or Typora: the link text is text
// to type in; while the caret is in a link, a small box under it shows the
// address to change, open or remove. Ctrl+K adds or edits a link,
// Ctrl+click follows one, pasting an address over a selection links it, and
// typing [text](address) becomes a link.
import { Plugin, TextSelection } from "prosemirror-state";
import { inputRules, InputRule } from "prosemirror-inputrules";
import { t } from "../../desktop/i18n.mjs";
import { schema } from "./markdown.js";

const linkType = schema.marks.link;

// The link run around pos (same address, contiguous), or null.
export function linkAt(state, pos = state.selection.from) {
  const $p = state.doc.resolve(pos);
  const parent = $p.parent;
  if (!parent.inlineContent) return null;
  const start = $p.start();
  let run = null;
  let found = null;
  parent.forEach((child, offset) => {
    const mark = linkType.isInSet(child.marks);
    const from = start + offset;
    const to = from + child.nodeSize;
    if (mark && run && run.mark.eq(mark) && run.to === from) run.to = to;
    else run = mark ? { mark, from, to } : null;
    if (
      run &&
      (!found || found.from === run.from) &&
      pos >= run.from &&
      pos <= run.to
    )
      found = run;
  });
  if (!found) return null;
  // A caret right after a link is outside it.
  if (state.selection.empty && pos === found.to && pos !== found.from)
    return null;
  return {
    href: found.mark.attrs.href,
    mark: found.mark,
    from: found.from,
    to: found.to,
  };
}

export function setHref(view, range, href) {
  const tr = view.state.tr.removeMark(range.from, range.to, linkType);
  // A changed address keeps the link's title and how it was written.
  if (href)
    tr.addMark(
      range.from,
      range.to,
      linkType.create({ ...(range.mark?.attrs || {}), href }),
    );
  view.dispatch(tr);
}

let editRequest = null;
// Ctrl+K: link the selection (and type its address), or edit the link at
// the caret.
export function editLink(view) {
  const { state } = view;
  if (!linkAt(state)) {
    if (state.selection.empty) return false;
    const { from, to } = state.selection;
    view.dispatch(state.tr.addMark(from, to, linkType.create({ href: "" })));
  }
  editRequest?.();
  return true;
}

// follow(href): open the link the way the reading view does.
export function linkPlugins({ follow }) {
  const box = new Plugin({
    view(view) {
      const dom = document.createElement("div");
      dom.className = "rich-link-box";
      dom.hidden = true;
      const input = document.createElement("input");
      input.type = "text";
      input.spellcheck = false;
      input.placeholder = t("链接地址");
      input.setAttribute("aria-label", t("链接地址"));
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.textContent = t("打开");
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = t("移除链接");
      dom.append(input, openButton, removeButton);
      document.body.append(dom);
      let range = null;
      const inside = () => dom.contains(document.activeElement);
      const place = () => {
        range = linkAt(view.state);
        if (!range || !(view.hasFocus() || inside())) {
          if (!inside()) dom.hidden = true;
          return;
        }
        const at = view.coordsAtPos(range.from);
        dom.style.left =
          Math.max(8, Math.min(at.left, innerWidth - 380)) + "px";
        dom.style.top = at.bottom + 6 + "px";
        if (document.activeElement !== input) input.value = range.href;
        dom.hidden = false;
      };
      const apply = () => {
        const now =
          range &&
          linkAt(view.state, range.from + (range.to > range.from ? 1 : 0));
        if (!now) return;
        setHref(view, now, input.value.trim());
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, now.to),
          ),
        );
        view.focus();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (!input.value.trim() && range) setHref(view, range, "");
          view.focus();
        }
      });
      const away = () =>
        setTimeout(() => {
          if (view.hasFocus() || inside()) return;
          // An address left empty takes the link away again.
          const now = range && linkAt(view.state, range.from + 1);
          if (now && !now.href && !input.value.trim()) setHref(view, now, "");
          else if (now && input.value.trim() && input.value.trim() !== now.href)
            setHref(view, now, input.value.trim());
          dom.hidden = true;
        }, 0);
      view.dom.addEventListener("focusout", away);
      input.addEventListener("focusout", away);
      view.dom.addEventListener("focusin", place);
      dom.addEventListener("mousedown", (e) => {
        if (e.target.tagName === "BUTTON") e.preventDefault();
      });
      openButton.addEventListener(
        "click",
        () => range?.href && follow(range.href),
      );
      removeButton.addEventListener("click", () => {
        if (range) setHref(view, range, "");
        view.focus();
      });
      const follows = () => (dom.hidden ? null : place());
      addEventListener("scroll", follows, true);
      addEventListener("resize", follows);
      addEventListener("blur", () => (dom.hidden = true));
      editRequest = () => {
        place();
        if (!dom.hidden) {
          input.focus();
          input.select();
        }
      };
      return {
        update: place,
        destroy() {
          dom.remove();
          removeEventListener("scroll", follows, true);
          removeEventListener("resize", follows);
        },
      };
    },
    props: {
      handleClick(view, pos, event) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const range = linkAt(view.state, pos);
        if (!range?.href) return false;
        follow(range.href);
        return true;
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain")?.trim();
        const { from, to, empty } = view.state.selection;
        if (empty || !text || /\s/.test(text)) return false;
        if (!/^(https?:\/\/|mailto:|#|\.{0,2}\/|[\w%-]+\.md\b)/i.test(text))
          return false;
        view.dispatch(
          view.state.tr.addMark(from, to, linkType.create({ href: text })),
        );
        return true;
      },
    },
  });
  const typed = inputRules({
    rules: [
      new InputRule(
        /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)$/,
        (state, m, start, end) =>
          state.tr.replaceWith(
            start,
            end,
            schema.text(m[1], [linkType.create({ href: m[2] })]),
          ),
      ),
    ],
  });
  return [box, typed];
}
