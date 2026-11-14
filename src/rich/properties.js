// The note's properties in the editor: the reading view's card
// (../properties.js), whose values are changed in place: a click on a value
// turns it into a field (Enter or leaving it keeps the change, Esc drops
// it), a yes/no value flips, a row's × removes it, and a property is added
// at the bottom. Values the card cannot read (nested YAML, blocks of text)
// open the front matter as source, as "编辑源码" does. The title above the
// card is changed the same way, a click turning it into a field.
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  propertiesCard,
  readProperties,
  editText,
  setProperty,
  addProperty,
  removeProperty,
  titleField,
} from "../properties.js";
import { open } from "./math.js";
import { t } from "../../desktop/i18n.mjs";
import { icon } from "../icons.js";

// Unfolded stays unfolded while the editor draws the card again.
let unfolded = false;
// The card of each editor, told when the note's first heading changes.
const cards = new WeakMap();
export const titleWatch = new Plugin({
  view: () => ({ update: (view) => cards.get(view)?.recheck() }),
});
const SPLIT = /^(---[^\n]*\n)([\s\S]*?)\n?((?:---|\.\.\.)[ \t]*)$/;

export class PropertiesView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement("div");
    this.dom.className = "raw-block rich-properties";
    this.dom.dataset.kind = "frontmatter";
    this.dom.contentEditable = "false";
    cards.set(view, this);
    this.draw();
    this.dom.addEventListener(
      "toggle",
      (e) => {
        if (e.target.classList?.contains("front-matter"))
          unfolded = e.target.open;
      },
      true,
    );
    this.dom.addEventListener("click", (e) => this.click(e));
    this.dom.addEventListener("keydown", (e) => {
      const value = e.target.closest?.(".fm-value");
      if (value && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        this.editValue(value.closest(".fm-row"));
      } else if (
        e.target.classList?.contains("fm-title") &&
        (e.key === "Enter" || e.key === " ")
      ) {
        e.preventDefault();
        this.editTitle();
      }
    });
  }
  parts() {
    const m = SPLIT.exec(this.node.attrs.source);
    return m
      ? { lead: m[1], yaml: m[2], tail: m[3] }
      : { lead: "---\n", yaml: "", tail: "---" };
  }
  // The first heading of the note, when it is a level-one heading right
  // below the properties.
  bodyHeading() {
    const pos = this.getPos();
    if (typeof pos !== "number") return null;
    const next = this.view.state.doc.nodeAt(pos + this.node.nodeSize);
    return next?.type.name === "heading" && next.attrs.level === 1
      ? next.textContent.trim()
      : null;
  }
  draw() {
    this.heading = this.bodyHeading();
    this.dom.innerHTML = propertiesCard(this.parts().yaml, {
      editable: true,
      open: unfolded,
      heading: this.heading,
    });
  }
  recheck() {
    if (this.dom.querySelector("input")) return;
    if (this.bodyHeading() !== this.heading) this.draw();
  }
  write(yaml) {
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    const { lead, tail } = this.parts();
    const body = yaml.replace(/\n+$/, "");
    const source = lead + (body ? body + "\n" : "") + tail;
    if (source === this.node.attrs.source) return this.draw();
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, null, {
        ...this.node.attrs,
        source,
      }),
    );
  }
  source() {
    const pos = this.getPos();
    if (typeof pos === "number") open(this.view, pos, 1);
  }
  click(e) {
    const action = e.target.closest?.("[data-action]")?.dataset.action;
    const row = e.target.closest?.(".fm-row");
    if (action === "source") return this.source();
    if (action === "add") return this.addForm();
    if (
      e.target.closest?.(".fm-title") &&
      !this.dom.querySelector(".fm-title input")
    )
      return this.editTitle();
    if (action === "delete" && row)
      return this.write(removeProperty(this.parts().yaml, row.dataset.key));
    if (row && e.target.closest(".fm-value") && !row.querySelector("input")) {
      e.preventDefault();
      this.editValue(row);
    }
  }
  field(row) {
    return readProperties(this.parts().yaml).find(
      (f) => f.key === row.dataset.key,
    );
  }
  editValue(row) {
    const f = this.field(row);
    if (!f) return;
    const { yaml } = this.parts();
    if (f.kind === "complex") return this.source();
    if (f.kind === "bool")
      return this.write(
        setProperty(yaml, f.key, /^true$/i.test(f.text) ? "false" : "true"),
      );
    const input = document.createElement("input");
    input.className = "fm-input";
    input.value = editText(f);
    input.spellcheck = false;
    input.setAttribute("aria-label", t("属性值"));
    if (f.kind === "list") input.placeholder = t("用逗号分隔");
    const cell = row.querySelector(".fm-value");
    cell.replaceChildren(input);
    let done = false;
    const finish = (keep, refocus) => {
      if (done) return;
      done = true;
      if (keep && input.value !== editText(f))
        this.write(setProperty(this.parts().yaml, f.key, input.value.trim()));
      else this.draw();
      if (refocus) this.view.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false, true);
      }
    });
    input.addEventListener("blur", () => finish(true, false));
    input.focus();
    input.select();
  }
  editTitle() {
    const f = titleField(readProperties(this.parts().yaml));
    const head = this.dom.querySelector(".fm-title");
    if (!f || !head) return;
    const input = document.createElement("input");
    input.className = "fm-input fm-title-input";
    input.value = f.text;
    input.spellcheck = false;
    input.setAttribute("aria-label", t("页面标题"));
    head.replaceChildren(input);
    let done = false;
    const finish = (keep, refocus) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      if (keep && text !== f.text)
        this.write(setProperty(this.parts().yaml, f.key, text));
      else this.draw();
      if (refocus) this.view.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        finish(true, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false, true);
      }
    });
    input.addEventListener("blur", () => finish(true, false));
    input.focus();
    input.select();
  }
  addForm() {
    const actions = this.dom.querySelector(".fm-actions");
    if (!actions) return;
    const form = newPropertyRow((key, value, refocus) => {
      if (key.trim()) this.write(addProperty(this.parts().yaml, key, value));
      else this.draw();
      if (refocus) this.view.focus();
    });
    actions.replaceWith(form.row);
    form.focus();
  }
  destroy() {
    if (cards.get(this.view) === this) cards.delete(this.view);
  }
  update(node) {
    if (node.type !== this.node.type || node.attrs.kind !== "frontmatter")
      return false;
    if (node.attrs.source !== this.node.attrs.source) {
      this.node = node;
      this.draw();
    }
    this.node = node;
    return true;
  }
  selectNode() {
    this.dom.classList.add("rich-picked");
  }
  deselectNode() {
    this.dom.classList.remove("rich-picked");
  }
  // Its fields and buttons are its own, not the editor's.
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

// Two fields for a new property, its name and its value: Enter in the name
// goes on to the value, Enter there keeps it, Esc drops it, and leaving
// both keeps it. done(key, value, refocus), key "" when dropped.
function newPropertyRow(done) {
  const row = document.createElement("div");
  row.className = "fm-row fm-new";
  const key = document.createElement("input");
  key.className = "fm-input fm-key-input";
  key.placeholder = t("属性名");
  key.setAttribute("aria-label", t("属性名"));
  const value = document.createElement("input");
  value.className = "fm-input";
  value.placeholder = t("属性值");
  value.setAttribute("aria-label", t("属性值"));
  key.spellcheck = value.spellcheck = false;
  row.append(key, value);
  let finished = false;
  const finish = (keep, refocus) => {
    if (finished) return;
    finished = true;
    done(keep ? key.value : "", value.value, refocus);
  };
  for (const input of [key, value])
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (input === key && key.value.trim()) value.focus();
        else finish(true, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false, true);
      }
    });
  // Leaving the two fields (not going from one to the other) keeps it.
  row.addEventListener("focusout", (e) => {
    if (!row.contains(e.relatedTarget)) finish(true, false);
  });
  return { row, focus: () => key.focus() };
}

const isFront = (node) =>
  node?.type.name === "raw_block" && node.attrs.kind === "frontmatter";
// The note's front matter set to `yaml` (put at the top when it has none),
// as one change the editor can undo; `history: false` for a change that is
// not the writer's own (the modified time saving sets).
export function setFrontMatter(view, yaml, { history = true } = {}) {
  const first = view.state.doc.firstChild;
  const body = yaml.replace(/\n+$/, "");
  let tr;
  if (isFront(first)) {
    const m = SPLIT.exec(first.attrs.source);
    const source = m
      ? m[1] + (body ? body + "\n" : "") + m[3]
      : `---\n${body}\n---`;
    if (source === first.attrs.source) return false;
    tr = view.state.tr.setNodeMarkup(0, null, { ...first.attrs, source });
  } else
    tr = view.state.tr.insert(
      0,
      view.state.schema.nodes.raw_block.create({
        kind: "frontmatter",
        source: `---\n${body}\n---`,
      }),
    );
  if (!history) tr.setMeta("addToHistory", false);
  view.dispatch(tr);
  return true;
}

// A note without properties shows, in Edit mode only, a quiet "Add
// property" above its first line (seen while the pointer is over the
// note; its room is kept, so nothing moves); it asks for the first property's name and value
// and makes the front matter with it, its card unfolded.
function firstPropertyDom(view) {
  const box = document.createElement("div");
  box.className = "rich-properties fm-first";
  box.contentEditable = "false";
  const inner = document.createElement("div");
  inner.className = "front-matter";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fm-first-add";
  button.innerHTML = `${icon("plus")}<span></span>`;
  button.lastChild.textContent = t("添加属性");
  button.addEventListener("click", () => {
    box.classList.add("asking");
    const form = newPropertyRow((key, value, refocus) => {
      box.classList.remove("asking");
      inner.replaceChildren(button);
      if (key.trim()) {
        unfolded = true;
        setFrontMatter(view, addProperty("", key, value));
      }
      if (refocus) view.focus();
    });
    inner.replaceChildren(form.row);
    form.focus();
  });
  inner.append(button);
  box.append(inner);
  return box;
}
export const firstProperty = new Plugin({
  props: {
    decorations: (state) =>
      isFront(state.doc.firstChild)
        ? null
        : DecorationSet.create(state.doc, [
            Decoration.widget(0, firstPropertyDom, {
              side: -1,
              key: "fm-first",
              stopEvent: () => true,
              ignoreSelection: true,
            }),
          ]),
  },
});
// Ask for the first property, as a click on "Add property" does (the note's
// menu); false when the note has properties already.
export function askFirstProperty(view) {
  const button = view.dom.querySelector(".fm-first-add");
  if (!button) return false;
  button.scrollIntoView({ block: "nearest" });
  button.click();
  return true;
}
