// The note's properties in the editor: the reading view's card
// (../properties.js), whose values are changed in place: a click on a value
// turns it into a field (Enter or leaving it keeps the change, Esc drops
// it), a yes/no value flips, a row's × removes it, and a property is added
// at the bottom. Values the card cannot read (nested YAML, blocks of text)
// open the front matter as source, as "编辑源码" does. The title above the
// card is changed the same way, a click turning it into a field.
import { Plugin } from "prosemirror-state";
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
    actions.replaceWith(row);
    let done = false;
    const finish = (keep, refocus) => {
      if (done) return;
      done = true;
      if (keep && key.value.trim())
        this.write(addProperty(this.parts().yaml, key.value, value.value));
      else this.draw();
      if (refocus) this.view.focus();
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
    key.focus();
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
