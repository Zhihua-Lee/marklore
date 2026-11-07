// Tables and code blocks in the editor are built as the reading view builds
// them (the same wrappers and classes), so they look the same in Read and
// Edit mode: a table in its scroll frame, a code block in its frame with
// the language and the copy and wrap buttons (code-blocks.js wires those).
import { decorateCodeBlocks } from "../code-blocks.js";
import { t } from "../../desktop/i18n.mjs";
import { codeLanguages } from "../highlighting.js";

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
  // The language label: a click turns it into a field with the known
  // languages below it, narrowed as one types; Enter or leaving it sets the
  // fence's language (the code is colored by it), Esc keeps it. A name not
  // in the list is taken as typed.
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
      field.setAttribute("role", "combobox");
      field.setAttribute("aria-autocomplete", "list");
      field.setAttribute("aria-expanded", "false");
      field.spellcheck = false;
      const menu = languageMenu(field);
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        menu.close();
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
      menu.onPick = () => finish(true);
      field.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          menu.move(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          menu.pick();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      });
      field.addEventListener("input", () => menu.filter());
      field.addEventListener("blur", () => finish(true));
      label.replaceWith(field);
      field.focus();
      field.select();
      menu.open();
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

// The list under the language field. It matches the first word of the field
// (what follows, like a title, is kept): a name or alias equal to it first,
// then names starting with it, then titles, then anything containing it.
let languages = null;
function rank(entry, q) {
  const names = [entry.name, ...entry.aliases];
  if (!q) return 4;
  if (names.includes(q)) return 0;
  if (names.some((n) => n.startsWith(q))) return 1;
  const title = entry.title.toLowerCase();
  if (title.startsWith(q)) return 2;
  if (names.some((n) => n.includes(q)) || title.includes(q)) return 3;
  return -1;
}
function languageMenu(field) {
  const list = document.createElement("ul");
  list.className = "code-language-menu";
  list.id = "code-language-menu";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("代码语言"));
  field.setAttribute("aria-controls", list.id);
  // Choosing with the mouse must not take the focus from the field.
  list.addEventListener("mousedown", (event) => event.preventDefault());
  let items = [];
  let active = -1;
  let typed = false;
  const first = () => field.value.trim().split(/\s/)[0].toLowerCase();
  const show = (i) => {
    active = i;
    list.querySelectorAll("li").forEach((li, n) => {
      li.setAttribute("aria-selected", String(n === i));
      if (n === i) li.scrollIntoView({ block: "nearest" });
    });
    if (i >= 0) field.setAttribute("aria-activedescendant", "code-lang-" + i);
    else field.removeAttribute("aria-activedescendant");
  };
  const place = () => {
    const box = field.getBoundingClientRect();
    list.style.left = box.left + "px";
    list.style.top = box.bottom + 4 + "px";
  };
  const menu = {
    onPick: null,
    open() {
      document.body.append(list);
      field.setAttribute("aria-expanded", "true");
      place();
      const ready = (all) => {
        languages = all;
        if (list.isConnected) menu.filter(true);
      };
      if (languages) ready(languages);
      else codeLanguages().then(ready, () => {});
    },
    close() {
      list.remove();
      field.setAttribute("aria-expanded", "false");
    },
    // At first every language shows, the current one picked; once typed in,
    // only the matches.
    filter(initial = false) {
      if (!languages) return;
      if (!initial) typed = true;
      const q = first();
      items = languages
        .map((entry) => [rank(entry, typed ? q : ""), entry])
        .filter(([r]) => r >= 0)
        .sort(
          (a, b) =>
            a[0] - b[0] ||
            a[1].title.localeCompare(b[1].title, undefined, {
              sensitivity: "base",
            }),
        )
        .map(([, entry]) => entry);
      list.replaceChildren(
        ...items.map((entry, i) => {
          const li = document.createElement("li");
          li.id = "code-lang-" + i;
          li.setAttribute("role", "option");
          const title = document.createElement("span");
          title.textContent = entry.title;
          const names = document.createElement("small");
          names.textContent = [entry.name, ...entry.aliases]
            .slice(0, 4)
            .join(", ");
          li.append(title, names);
          li.addEventListener("click", () => {
            show(i);
            menu.pick();
            menu.onPick?.();
          });
          return li;
        }),
      );
      list.hidden = !items.length;
      const current = items.findIndex(
        (e) => e.name === q || e.aliases.includes(q),
      );
      show(typed ? (q ? 0 : -1) : current);
      if (!items.length) show(-1);
    },
    move(step) {
      if (!items.length) return;
      const n = items.length;
      show(active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n);
    },
    // The highlighted language replaces the field's first word.
    pick() {
      const entry = items[active];
      if (!entry || list.hidden) return;
      const rest = field.value.trim().split(/\s+/).slice(1).join(" ");
      // A name typed in full stays as typed (js stays js).
      const q = first();
      const names = [entry.name, ...entry.aliases];
      field.value =
        (names.includes(q) ? q : entry.name) + (rest ? " " + rest : "");
    },
  };
  return menu;
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
