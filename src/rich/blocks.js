// Tables and code blocks in the editor are built as the reading view builds
// them (the same wrappers and classes), so they look the same in Read and
// Edit mode: a table in its scroll frame, a code block in its frame with
// the language and the copy and wrap buttons (code-blocks.js wires those).
import { decorateCodeBlocks } from "../code-blocks.js";
import { t } from "../../desktop/i18n.mjs";

// A display formula or raw block open for editing (math.js): its source,
// with the formula's `$$` lines shown around it but not typed into.
const isOpen = (node) =>
  node.attrs.params === "$$" || node.attrs.params.startsWith("\u0000raw:");

export class CodeView {
  constructor(node, view, getPos) {
    this.open = isOpen(node);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.append(code);
    this.contentDOM = code;
    if (this.open) {
      pre.dataset.params = node.attrs.params;
      const lead = node.attrs.lead.trim();
      const tail = node.attrs.tail.trim();
      if (lead) pre.dataset.lead = lead;
      if (tail) pre.dataset.tail = tail;
      this.dom = pre;
    } else {
      const language = (node.attrs.params || "").trim().split(/\s/)[0];
      if (language) code.className = "language-" + language;
      const holder = document.createElement("div");
      holder.append(pre);
      decorateCodeBlocks(holder, { fold: false });
      this.dom = holder.firstElementChild;
      const bar = this.dom.querySelector(".code-toolbar");
      if (bar) {
        bar.contentEditable = "false";
        this.language(bar.firstElementChild, node, view, getPos);
      }
    }
    this.params = node.attrs.params;
  }
  // The language label: a click turns it into a field; Enter or leaving it
  // sets the fence's language (the code is colored by it), Esc keeps it.
  language(label, node, view, getPos) {
    if (!label || !view) return;
    label.classList.add("code-language");
    label.tabIndex = 0;
    label.setAttribute("role", "button");
    label.title = t("点击修改代码语言");
    const edit = () => {
      const field = document.createElement("input");
      field.className = "code-language-field";
      field.value = node.attrs.params;
      field.placeholder = "text";
      field.setAttribute("aria-label", t("代码语言"));
      field.spellcheck = false;
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        const value = field.value.trim();
        field.replaceWith(label);
        const pos = getPos();
        if (keep && value !== node.attrs.params && typeof pos === "number") {
          const now = view.state.doc.nodeAt(pos);
          if (now?.type.name === "code_block")
            view.dispatch(
              view.state.tr.setNodeMarkup(pos, null, {
                ...now.attrs,
                params: value,
              }),
            );
        }
        view.focus();
      };
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      });
      field.addEventListener("blur", () => finish(true));
      label.replaceWith(field);
      field.focus();
      field.select();
    };
    label.addEventListener("mousedown", (event) => event.preventDefault());
    label.addEventListener("click", edit);
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        edit();
      }
    });
  }
  update(node) {
    if (node.type.name !== "code_block") return false;
    if (node.attrs.params !== this.params) return false;
    if (this.open) {
      const pre = this.dom;
      if ((pre.dataset.lead || "") !== node.attrs.lead.trim()) return false;
      if ((pre.dataset.tail || "") !== node.attrs.tail.trim()) return false;
    }
    return true;
  }
  // The buttons are the frame's own: clicks on them are not the editor's.
  stopEvent(event) {
    return !!event.target.closest?.(".code-toolbar");
  }
  ignoreMutation(mutation) {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }
}

export class TableView {
  constructor() {
    this.dom = document.createElement("div");
    this.dom.className = "table-scroll";
    const table = document.createElement("table");
    this.contentDOM = document.createElement("tbody");
    table.append(this.contentDOM);
    this.dom.append(table);
  }
  update(node) {
    return node.type.name === "table";
  }
  ignoreMutation(mutation) {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }
}
