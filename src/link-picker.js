// Suggestions for a link field: notes in the library and their headings and
// anchors, so a link is picked rather than typed. Typing filters notes and
// anchors by name; "note#..." lists that note's anchors. What is picked is
// written as an ordinary relative link (chapter.md#anchor). A web address
// is left alone.
import { t } from "../desktop/i18n.mjs";
import "./link-picker.css";

const encodePath = (rel) =>
  rel
    .split("/")
    .map((part) => part.replace(/[ ()<>%]/g, (c) => encodeURIComponent(c)))
    .join("/");
const stem = (name) => name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "");
const includes = (text, query) =>
  text.toLowerCase().includes(query.toLowerCase());

// Attach to an input. getTargets() resolves to [{ name, rel, anchors }] (rel
// is "" for the note being edited); onPick({ href, label }) after a choice.
export function attachLinkPicker(input, { getTargets, onPick = () => {} }) {
  const list = document.createElement("div");
  list.className = "link-picker";
  list.setAttribute("role", "listbox");
  list.id = "link-picker-" + Math.random().toString(36).slice(2);
  list.hidden = true;
  input.after(list);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  let targets = null,
    items = [],
    active = -1;

  function option({ kind, title, detail, value, level = 0 }) {
    const el = document.createElement("div");
    el.className = "link-option";
    el.dataset.kind = kind;
    el.setAttribute("role", "option");
    el.style.paddingLeft = 10 + Math.max(0, level - 1) * 10 + "px";
    el.innerHTML = `<span class="link-option-title"></span><span class="link-option-detail"></span>`;
    el.querySelector(".link-option-title").textContent = title;
    el.querySelector(".link-option-detail").textContent = detail || "";
    el.onmousedown = (event) => {
      event.preventDefault();
      choose(items.indexOf(value));
    };
    return el;
  }
  const noteHref = (note) => encodePath(note.rel);
  const anchorHref = (note, anchor) =>
    (note.rel ? encodePath(note.rel) : "") + "#" + anchor.id;
  const anchorTitle = (anchor) =>
    (anchor.kind === "explicit" ? "◇ " : "") + (anchor.label || anchor.id);

  function render() {
    const query = input.value.trim();
    list.replaceChildren();
    items = [];
    active = -1;
    if (!targets || /^[a-z][a-z0-9+.-]*:/i.test(query)) return close();
    const hash = query.indexOf("#");
    if (hash >= 0) {
      // "note#..." (or "#..." for this note): that note's anchors.
      const path = query.slice(0, hash),
        part = query.slice(hash + 1);
      const note = targets.find(
        (n) =>
          n.rel === path || encodePath(n.rel) === path || (!path && !n.rel),
      );
      if (!note) return close();
      for (const anchor of note.anchors) {
        if (
          part &&
          !includes(anchor.label || anchor.id, part) &&
          !includes(anchor.id, part)
        )
          continue;
        items.push({
          href: anchorHref(note, anchor),
          label: anchor.label || stem(note.name),
          kind: anchor.kind,
          title: anchorTitle(anchor),
          level: anchor.kind === "heading" ? anchor.level : 3,
        });
      }
    } else {
      const notes = targets
        .filter(
          (n) =>
            n.rel &&
            (!query || includes(stem(n.name), query) || includes(n.rel, query)),
        )
        .slice(0, 8);
      for (const note of notes)
        items.push({
          href: noteHref(note),
          label: stem(note.name),
          kind: "note",
          title: stem(note.name),
          detail: note.rel,
          note,
        });
      if (query)
        for (const note of targets) {
          for (const anchor of note.anchors) {
            if (items.length >= 16) break;
            if (anchor.kind === "heading" && anchor.level === 1) continue;
            if (!includes(anchor.label || "", query)) continue;
            items.push({
              href: anchorHref(note, anchor),
              label: anchor.label,
              kind: anchor.kind,
              title: anchorTitle(anchor),
              detail: note.rel ? stem(note.name) : t("本笔记"),
            });
          }
        }
    }
    if (!items.length) return close();
    for (const item of items)
      list.append(
        option({
          kind: item.kind,
          title: item.title,
          detail: item.detail,
          value: item,
          level: item.level,
        }),
      );
    // Under the field, or above it when there is no room below.
    const box = input.getBoundingClientRect();
    list.style.left = box.left + "px";
    list.style.minWidth = box.width + "px";
    list.style.maxWidth =
      Math.max(box.width, Math.min(460, innerWidth - box.left - 8)) + "px";
    list.hidden = false;
    const below = box.bottom + 4;
    list.style.top =
      (below + list.offsetHeight < innerHeight - 8
        ? below
        : Math.max(8, box.top - list.offsetHeight - 4)) + "px";
    input.setAttribute("aria-expanded", "true");
  }
  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }
  function highlight(index) {
    active = index;
    [...list.children].forEach((el, i) => {
      el.classList.toggle("active", i === index);
      el.setAttribute("aria-selected", String(i === index));
      if (i === index) el.scrollIntoView({ block: "nearest" });
    });
  }
  // A note opens its anchors; an anchor (or a note chosen twice) is final.
  function choose(index) {
    const item = items[index];
    if (!item) return;
    if (item.kind === "note" && input.value !== item.href) {
      input.value = item.href;
      onPick({ href: item.href, label: item.label, final: false });
      input.value = item.href + "#";
      render();
      if (!items.length) {
        input.value = item.href;
        close();
      }
      return;
    }
    input.value = item.href;
    onPick({ href: item.href, label: item.label, final: true });
    close();
  }

  input.addEventListener("focus", async () => {
    try {
      targets ??= await getTargets();
    } catch {
      targets = [];
    }
    render();
  });
  input.addEventListener("input", render);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (event) => {
    if (list.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlight((active + step + items.length) % items.length);
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      event.stopPropagation();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  return { close };
}
