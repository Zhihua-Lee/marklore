// Tables and code blocks in the editor are built as the reading view builds
// them (the same wrappers and classes), so they look the same in Read and
// Edit mode: a table in its scroll frame, a code block in its frame with
// the language and the copy and wrap buttons (code-blocks.js wires those).
import { decorateCodeBlocks } from "../code-blocks.js";

// A display formula or raw block open for editing (math.js): its source,
// with the formula's `$$` lines shown around it but not typed into.
const isOpen = (node) =>
  node.attrs.params === "$$" || node.attrs.params.startsWith("\u0000raw:");

export class CodeView {
  constructor(node) {
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
      if (bar) bar.contentEditable = "false";
    }
    this.params = node.attrs.params;
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
