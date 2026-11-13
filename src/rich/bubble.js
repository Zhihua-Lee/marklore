// The small toolbar over selected text in the editor of Edit mode: the
// text styles of the toolbar at the top, where the selection is (the same
// look as the reading view's, selection-tools.css). It shows once the mouse
// is up or the selection was made with the keyboard, and goes when the
// selection does.
import { Plugin, TextSelection } from "prosemirror-state";
import { icon } from "../icons.js";
import { wireColorButton, closeColorPicker } from "../color-picker.js";
import { t } from "../../desktop/i18n.mjs";
import { richCommand } from "./commands.js";

export function selectionBubble({ comment = null } = {}) {
  return new Plugin({
    view(view) {
      const bar = document.createElement("div");
      bar.className = "selection-tools rich-bubble";
      bar.hidden = true;
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", t("选中文字格式"));
      const actions = [
        ["bold", t("加粗"), "<b>B</b>"],
        ["italic", t("斜体"), "<i>I</i>"],
        ["strike", t("删除线"), "<s>S</s>"],
        ["highlight", t("高亮"), icon("highlight")],
        ["color", t("文字颜色"), icon("textColor")],
        ["link", t("链接"), icon("link")],
        ["inline", t("行内代码"), "&lt;/&gt;"],
        ["inlineMath", t("行内公式"), icon("inlineMath")],
        ...(comment ? [["comment", t("标记给 AI…"), icon("comment")]] : []),
      ];
      bar.innerHTML = `<div class="selection-actions">${actions.map(([action, label, body]) => `<button type="button" data-selection-action="${action}" aria-label="${label}" title="${label}">${body}</button>`).join("")}</div>`;
      document.body.append(bar);
      let pressed = false;
      const hide = () => {
        if (bar.hidden) return;
        if (bar.querySelector('[aria-expanded="true"]')) closeColorPicker();
        bar.hidden = true;
      };
      const selected = () => {
        const sel = view.state.selection;
        return sel instanceof TextSelection && !sel.empty && view.hasFocus();
      };
      // Its palette of colours is open (the focus is in it): the bar stays.
      const choosing = () => !!bar.querySelector('[aria-expanded="true"]');
      function place() {
        if (choosing()) return;
        if (pressed || view.composing || !selected()) return hide();
        const { from, to } = view.state.selection;
        const start = view.coordsAtPos(from, 1);
        const end = view.coordsAtPos(to, -1);
        const scroller = view.dom.closest("#rich-reader") || document.body;
        const box = scroller.getBoundingClientRect();
        if (end.bottom < box.top || start.top > box.bottom) return hide();
        bar.hidden = false;
        const left = Math.max(
          box.left + 6,
          Math.min(start.left, box.right - bar.offsetWidth - 6),
        );
        // Above the selection, unless that would cover the toolbar at the
        // top of the panes: then below it.
        const tools = document.querySelector(".editing-tools");
        const ceiling = Math.max(
          box.top,
          tools?.checkVisibility() ? tools.getBoundingClientRect().bottom : 0,
        );
        const above = start.top - bar.offsetHeight - 8;
        bar.style.left = left + "px";
        bar.style.top = (above >= ceiling + 4 ? above : end.bottom + 8) + "px";
      }
      const down = () => {
        pressed = true;
        hide();
      };
      const up = () => {
        if (!pressed) return;
        pressed = false;
        requestAnimationFrame(place);
      };
      view.dom.addEventListener("mousedown", down);
      document.addEventListener("mouseup", up);
      const scroller = view.dom.closest("#rich-reader");
      const onScroll = () => !bar.hidden && place();
      scroller?.addEventListener("scroll", onScroll, { passive: true });
      bar.addEventListener("mousedown", (event) => event.preventDefault());
      bar.addEventListener("click", (event) => {
        const action = event.target.closest("[data-selection-action]")?.dataset
          .selectionAction;
        if (!action || action === "highlight" || action === "color") return;
        if (action === "comment") {
          hide();
          return comment(view);
        }
        richCommand(view, action);
        requestAnimationFrame(place);
      });
      for (const action of ["highlight", "color"])
        wireColorButton(
          bar.querySelector(`[data-selection-action="${action}"]`),
          action,
          () =>
            selected()
              ? {
                  apply: (options) => richCommand(view, action, options),
                  focus: () => view.focus(),
                }
              : null,
        );
      // The editor losing focus to anything but this bar hides it.
      // ... or to the palette opened from it.
      const blur = (event) => {
        const to = event.relatedTarget;
        if (bar.contains(to) || to?.closest?.(".text-color-picker")) return;
        hide();
      };
      view.dom.addEventListener("blur", blur);
      return {
        update: () => requestAnimationFrame(place),
        destroy() {
          view.dom.removeEventListener("mousedown", down);
          view.dom.removeEventListener("blur", blur);
          document.removeEventListener("mouseup", up);
          scroller?.removeEventListener("scroll", onScroll);
          bar.remove();
        },
      };
    },
  });
}
