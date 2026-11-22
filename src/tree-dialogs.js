// The library tree's questions: whether to start an index for a folder,
// which notes' links a rename or move updates (and whether child pages go
// along), and which folder to move to. Plain <dialog>s with the app's
// dialog look (style.css) and a few quiet additions (library-index.css).
import { t } from "../desktop/i18n.mjs";
import { INDEX_NAMES } from "../desktop/folder-index.mjs";
import { unifyKey } from "../desktop/note-names.mjs";

// A modal dialog built from `build(form)`; resolves with what `finish`
// is called with, or null on Esc / Cancel.
function modal(className, label, build) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "tree-dialog " + className;
    dialog.setAttribute("aria-label", label);
    const form = document.createElement("form");
    form.method = "dialog";
    dialog.append(form);
    let result = null;
    const finish = (value) => {
      result = value;
      dialog.close();
    };
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    build(form, finish);
    dialog.showModal();
    (
      form.querySelector("[autofocus]") || form.querySelector("button")
    )?.focus();
  });
}
const element = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
function actions(form, buttons, finish) {
  const row = element("div", "dialog-actions");
  for (const { label, value, primary } of buttons) {
    const button = element("button", primary ? "primary" : "", label);
    button.type = "button";
    if (primary) button.autofocus = true;
    button.onclick = () => finish(value);
    row.append(button);
  }
  form.append(row);
  form.onsubmit = (event) => {
    event.preventDefault();
    const primary = buttons.find((b) => b.primary);
    if (primary) finish(primary.value);
  };
}

// A folder without an index file: start one? Resolves true or false.
export async function askCreateIndex(folder) {
  const answer = await modal(
    "index-question",
    t("建立目录"),
    (form, finish) => {
      form.append(
        element("h2", "", t("为“{name}”建立目录？", { name: folder })),
        element(
          "p",
          "",
          t(
            "这个文件夹按名称排列。调整顺序、建立子页需要一个目录文件 {name}：它按现在的顺序列出文件夹中的笔记和子文件夹，之后的顺序和层级都记在里面。",
            { name: INDEX_NAMES[0] },
          ),
        ),
      );
      actions(
        form,
        [
          { label: t("取消"), value: false },
          {
            label: t("建立 {name}", { name: INDEX_NAMES[0] }),
            value: true,
            primary: true,
          },
        ],
        finish,
      );
    },
  );
  return answer === true;
}

// The notes whose links change: one row each, its name and how many links.
function affectedList(list) {
  const box = element("ul", "tree-dialog-list");
  for (const note of list) {
    const row = element("li");
    row.title = note.path;
    row.append(
      element("span", "tree-dialog-name", note.name),
      element(
        "span",
        "tree-dialog-count",
        t("{count} 处", { count: note.links }),
      ),
    );
    box.append(row);
  }
  return box;
}

// Before a rename or move that changes other notes' links (or carries
// child pages): what it does, the notes concerned, and the choice.
// kind: "rename" | "move"; affected: [{ path, name, links }];
// with: { children: [names], affected } when the note has child pages.
// Resolves { links, children } or null (cancelled).
export function askLinks({
  kind,
  title,
  affected,
  with: along = null,
  indexing = false,
  childrenError = null,
}) {
  return modal("links-question", title, (form, finish) => {
    form.append(element("h2", "", title));
    const check = along
      ? (() => {
          const label = element("label", "tree-dialog-check");
          const box = element("input");
          box.type = "checkbox";
          box.checked = true;
          label.append(
            box,
            element(
              "span",
              "",
              t("同时移动 {count} 个子页", { count: along.children.length }),
            ),
          );
          label.title = along.children.join("\n");
          form.append(label);
          return box;
        })()
      : null;
    const lead = element("p", "tree-dialog-lead");
    const slot = element("div", "tree-dialog-slot");
    const hint = element(
      "p",
      "tree-dialog-hint",
      t("改写前每个文件都会备份，可用“撤销上次改名/移动”一并恢复。"),
    );
    form.append(lead, slot, hint);
    // The library still being read: some links may not be listed yet.
    if (childrenError)
      form.append(
        element(
          "p",
          "tree-dialog-hint",
          t("子页不能一起移动：{reason}", { reason: childrenError }),
        ),
      );
    if (indexing)
      form.append(
        element(
          "p",
          "tree-dialog-hint",
          t("笔记库仍在读取，可能还有链接没有列出。"),
        ),
      );
    const row = element("div", "dialog-actions");
    const cancel = element("button", "", t("取消"));
    const only = element(
      "button",
      "",
      kind === "rename" ? t("只改名") : t("只移动"),
    );
    const apply = element("button", "primary");
    for (const b of [cancel, only, apply]) b.type = "button";
    row.append(cancel, only, apply);
    form.append(row);
    const children = () => Boolean(check?.checked);
    const current = () => (children() ? along.affected : affected);
    const show = () => {
      const list = current();
      lead.hidden = slot.hidden = hint.hidden = only.hidden = !list.length;
      lead.textContent = t("{count} 篇笔记中有链接会随之改变：", {
        count: list.length,
      });
      slot.replaceChildren(affectedList(list));
      apply.textContent = list.length
        ? t("更新 {count} 篇笔记的链接", { count: list.length })
        : kind === "rename"
          ? t("重命名")
          : t("移动");
    };
    show();
    check?.addEventListener("change", show);
    cancel.onclick = () => finish(null);
    only.onclick = () => finish({ links: false, children: children() });
    apply.onclick = () => finish({ links: true, children: children() });
    apply.autofocus = true;
    form.onsubmit = (event) => {
      event.preventDefault();
      apply.click();
    };
  });
}

// "Move to…": the library's folders ([{ path, name, rel }]) to pick from,
// filtered as one types; ↑/↓ choose, Enter or a double click moves.
// exclude(path): folders it cannot go to. Resolves a path or null.
export function pickFolder({
  title,
  folders,
  exclude = () => false,
  filterLabel = t("筛选文件夹"),
  emptyText = t("没有可移动到的文件夹"),
  actionLabel = t("移到这里"),
}) {
  return modal("folder-picker", title, (form, finish) => {
    const filter = element("input", "folder-filter");
    filter.type = "search";
    filter.placeholder = filterLabel;
    filter.setAttribute("aria-label", filterLabel);
    filter.spellcheck = false;
    filter.autofocus = true;
    const list = element("div", "folder-options");
    list.setAttribute("role", "listbox");
    list.id = "folder-options-" + Math.random().toString(36).slice(2);
    filter.setAttribute("aria-controls", list.id);
    form.append(element("h2", "", title), filter, list);
    const choices = folders.filter((folder) => !exclude(folder.path));
    let shown = [],
      at = -1;
    const mark = (next) => {
      // Only among the options shown (at most 300).
      at = Math.max(-1, Math.min(Math.min(shown.length, 300) - 1, next));
      list.querySelectorAll(".folder-option").forEach((el, i) => {
        el.classList.toggle("active", i === at);
        el.setAttribute("aria-selected", String(i === at));
      });
      const active = list.children[at];
      if (active) {
        filter.setAttribute("aria-activedescendant", active.id);
        active.scrollIntoView({ block: "nearest" });
      } else filter.removeAttribute("aria-activedescendant");
      move.disabled = at < 0;
    };
    const render = () => {
      const words = filter.value.trim().toLowerCase().split(/\s+/);
      shown = choices.filter((folder) =>
        words.every((w) => folder.rel.toLowerCase().includes(w)),
      );
      list.replaceChildren(
        ...shown.slice(0, 300).map((folder, i) => {
          const option = element("div", "folder-option");
          option.id = list.id + "-" + i;
          option.setAttribute("role", "option");
          option.title = folder.path;
          option.append(
            element("span", "folder-option-name", folder.name),
            element("span", "folder-option-path", folder.rel),
          );
          option.onclick = () => mark(i);
          option.ondblclick = () => finish(folder.path);
          return option;
        }),
      );
      if (!shown.length) list.append(element("p", "folder-none", emptyText));
      mark(shown.length ? 0 : -1);
    };
    filter.addEventListener("input", render);
    filter.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        mark(at + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        move.click();
      }
    });
    const row = element("div", "dialog-actions");
    const cancel = element("button", "", t("取消"));
    const move = element("button", "primary", actionLabel);
    for (const b of [cancel, move]) b.type = "button";
    row.append(cancel, move);
    form.append(row);
    cancel.onclick = () => finish(null);
    move.onclick = () => at >= 0 && finish(shown[at].path);
    form.onsubmit = (event) => {
      event.preventDefault();
      move.click();
    };
    render();
  });
}

// A link or index entry whose target is gone: where it may lead instead
// (candidates: [{ path, name, rel, reason }]), or take it away, or create
// the missing note. Resolves { kind: "relocate", to } | { kind: "remove" }
// | { kind: "create" } | null. index: an index entry (its wording).
export function askRepair({ name, rel, candidates, creatable, index = false }) {
  const title = t("“{name}”不存在", { name });
  return modal("repair-question", title, (form, finish) => {
    form.append(
      element("h2", "", title),
      element(
        "p",
        "",
        index
          ? t("目录中的这一项指向 {rel}，那里没有文件。", { rel })
          : t("这个链接指向 {rel}，那里没有文件。", { rel }),
      ),
    );
    const reasons = {
      renamed: t("刚被改名或移动到这里"),
      "same-name": t("同名的文件"),
      unlisted: t("这个文件夹中未列入目录的笔记"),
    };
    let chosen = candidates.length ? 0 : -1;
    const list = element("div", "folder-options repair-options");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", t("可以改为指向"));
    list.tabIndex = 0;
    const options = candidates.map((candidate, i) => {
      const option = element("div", "folder-option");
      option.setAttribute("role", "option");
      option.title = candidate.path;
      option.append(
        element("span", "folder-option-name", candidate.rel),
        element("span", "folder-option-path", reasons[candidate.reason] || ""),
      );
      option.onclick = () => mark(i);
      option.ondblclick = () =>
        finish({ kind: "relocate", to: candidate.path });
      return option;
    });
    const mark = (i) => {
      chosen = Math.max(0, Math.min(candidates.length - 1, i));
      options.forEach((el, k) => {
        el.classList.toggle("active", k === chosen);
        el.setAttribute("aria-selected", String(k === chosen));
      });
      options[chosen]?.scrollIntoView({ block: "nearest" });
    };
    if (candidates.length) {
      form.append(element("p", "tree-dialog-lead", t("可以改为指向：")), list);
      list.append(...options);
      list.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        mark(chosen + (event.key === "ArrowDown" ? 1 : -1));
      });
      mark(0);
    } else
      form.append(
        element(
          "p",
          "tree-dialog-hint",
          t("笔记库中没有找到同名或刚改名的文件。"),
        ),
      );
    const row = element("div", "dialog-actions");
    const cancel = element("button", "", t("取消"));
    const remove = element(
      "button",
      "",
      index ? t("从目录中移除") : t("移除链接"),
    );
    const create = element("button", "", t("新建这篇笔记"));
    const relocate = element("button", "primary", t("改为指向所选"));
    for (const b of [cancel, remove, create, relocate]) b.type = "button";
    create.hidden = !creatable;
    relocate.hidden = !candidates.length;
    row.append(cancel, remove, create, relocate);
    form.append(row);
    cancel.onclick = () => finish(null);
    remove.onclick = () => finish({ kind: "remove" });
    create.onclick = () => finish({ kind: "create" });
    relocate.onclick = () =>
      chosen >= 0 && finish({ kind: "relocate", to: candidates[chosen].path });
    (candidates.length ? relocate : creatable ? create : remove).autofocus =
      true;
    form.onsubmit = (event) => {
      event.preventDefault();
      if (candidates.length) relocate.click();
    };
  });
}

// "Unify names…" on a folder: for each note, what would change (its file
// name, its index entry, a heading added, its front-matter title), with
// subfolders included on request. plan(deep) → main's planUnify. Resolves
// { deep } when the reader applies it, or null.
export function askUnify({ folder, plan }) {
  const title = t("统一“{name}”中的名字", { name: folder });
  return modal("unify-question", title, (form, finish) => {
    form.append(element("h2", "", title));
    form.append(
      element(
        "p",
        "tree-dialog-hint",
        t(
          "笔记的名字是它开头的一级标题；没有标题的笔记取目录条目或文件名作为标题。文件名、目录条目和属性 title 都改为这个名字。",
        ),
      ),
    );
    const label = element("label", "tree-dialog-check");
    const deep = element("input");
    deep.type = "checkbox";
    label.append(deep, element("span", "", t("包括子文件夹")));
    form.append(label);
    const lead = element("p", "tree-dialog-lead");
    const slot = element("div", "tree-dialog-slot");
    const skipped = element("p", "tree-dialog-hint");
    const hint = element(
      "p",
      "tree-dialog-hint",
      t(
        "其他笔记中的链接随之更新；改写前每个文件都会备份，可用“撤销上次改名/移动”一并恢复。",
      ),
    );
    form.append(lead, slot, skipped, hint);
    const row = element("div", "dialog-actions");
    const cancel = element("button", "", t("取消"));
    const apply = element("button", "primary", t("统一名字"));
    for (const b of [cancel, apply]) b.type = "button";
    row.append(cancel, apply);
    form.append(row);
    let epoch = 0;
    // The plan on screen: the one applied.
    let shown = [];
    const show = async () => {
      const mine = ++epoch;
      apply.disabled = true;
      lead.textContent = t("正在检查…");
      slot.replaceChildren();
      let found;
      try {
        found = await plan(deep.checked);
      } catch (error) {
        if (mine === epoch) lead.textContent = error.message;
        return;
      }
      if (mine !== epoch) return;
      const notes = found.notes || [];
      shown = notes;
      lead.textContent = notes.length
        ? t("{count} 篇笔记会改变：", { count: notes.length })
        : t("名字都已统一，没有要改的。");
      const list = element("ul", "tree-dialog-list unify-list");
      for (const note of notes) {
        const item = element("li", "unify-item");
        item.title = note.path;
        item.append(element("span", "unify-name", note.title));
        const what = [];
        if (note.to)
          what.push(
            t("文件名 {from} → {to}", { from: note.name, to: note.to }),
          );
        if (note.heading) what.push(t("加上标题"));
        if (note.entry)
          what.push(t("目录条目“{from}”", { from: note.entry.from || "" }));
        if (note.front)
          what.push(t("属性 title“{from}”", { from: note.front.from || "" }));
        item.append(element("span", "unify-changes", what.join(t("；"))));
        list.append(item);
      }
      if (notes.length) slot.append(list);
      const left = found.skipped || [];
      skipped.hidden = !left.length;
      skipped.textContent = left.length
        ? t("有未保存修改的笔记不改：{names}", {
            names: left.map((n) => n.name).join(", "),
          })
        : "";
      apply.disabled = !notes.length;
    };
    deep.addEventListener("change", show);
    cancel.onclick = () => finish(null);
    apply.onclick = () =>
      finish({ deep: deep.checked, expect: unifyKey(shown) });
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!apply.disabled) apply.click();
    };
    show();
  });
}
