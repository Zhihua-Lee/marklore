// A folder's index file (_目录.md, SUMMARY.md) in Read and Edit mode: its
// link list shown as an outline of the folder's pages, the rest of the note
// (front matter, headings, prose, comments) rendered as in any note. Source
// mode shows the Markdown as written.
//
// Each list entry is a row: a fold arrow when pages sit under it, its title,
// the file name when it differs, and the page's first sentence (read from
// the page, shown only, never written). Clicking opens the page. Edit mode
// adds dragging, Tab/Shift+Tab (also Alt+Shift+←/→) to nest or un-nest,
// Alt+↑/↓ to move, new sub-pages, removing an entry from the index (not
// the file) and editing a title in place. An entry whose file is missing
// says so, with create / point elsewhere / remove. Files of the folder the
// index does not list are offered under "not in the index".
//
// Every change is a small edit of the note's text (src/index-list.js) made
// through the source editor, so it is undone, kept as a draft and saved as
// any edit is. Prose is edited by double-clicking it (its Markdown, in place).
import { isolateHistory } from "@codemirror/commands";
import { t } from "../desktop/i18n.mjs";
import { isIndexName } from "../desktop/folder-index.mjs";
import { renderDocument } from "./document-render.js";
import { isDiffDocument } from "./diff-view.js";
import { icon } from "./icons.js";
import {
  scanIndex,
  moveEntry,
  indentEntry,
  outdentEntry,
  shiftEntry,
  insertEntry,
  removeEntry,
  retitleEntry,
  relinkEntry,
  noteExcerpt,
  titleFor,
  hrefFor,
} from "./index-list.js";
import "./folder-index-view.css";

const DRAG_TYPE = "application/x-marklore-index";
// Pages read for their first sentence, at most (an index lists a folder).
const EXCERPT_LIMIT = 200;

export function createIndexView({
  api,
  host,
  view,
  getDocument,
  // Show the note again (it changed, or what is known about its folder).
  rerender,
  // Open a link of the index, as a click on a link in a note does.
  open,
  report,
  run,
  setMode,
  // The text of a note open in a tab (by file id), when main hands back
  // only its id.
  openText = () => null,
  newNoteText = () => "",
  // Files were created in the folder: the library tree shows them.
  filesChanged = () => {},
  // Read mode's format bar is on (a double click selects words for it).
  readingFormat = () => false,
}) {
  const states = new WeakMap();
  // Per index file: its folder's entries, and the pages' first sentences.
  const folders = new Map();
  let lastShown = null;

  const applies = (doc) =>
    Boolean(doc) && isIndexName(doc.name || "") && !isDiffDocument(doc);
  const editing = (doc) => doc.mode === "edit" && !doc.preview;
  const stateOf = (doc) => {
    let state = states.get(doc);
    if (!state) states.set(doc, (state = { folds: new Set(), tray: false }));
    return state;
  };
  const foldKey = (entry) => (entry.name || entry.href).toLowerCase();
  const childOf = (info, name) =>
    name && info?.status === "ready"
      ? info.children.find(
          (child) => child.name.toLowerCase() === name.toLowerCase(),
        )
      : null;

  // ── What is known about the folder ──
  function folderOf(doc) {
    if (!doc.fileId || !api?.currentFolder || !api?.list) return null;
    let info = folders.get(doc.fileId);
    if (!info) {
      info = {
        status: "loading",
        children: [],
        excerpts: new Map(),
        asked: new Set(),
        version: 0,
      };
      folders.set(doc.fileId, info);
      load(doc, info);
    }
    return info;
  }
  async function load(doc, info) {
    try {
      const folder = await api.currentFolder(doc.fileId);
      info.children = (await api.list(folder.id)) || [];
      info.folderId = folder.id;
      info.status = "ready";
    } catch {
      // Listed before: what was known stays.
      if (info.status !== "ready") info.status = "error";
    }
    if (folders.get(doc.fileId) !== info) return;
    info.version++;
    rerender(doc);
  }
  // The first sentence of each listed page not read yet.
  async function loadExcerpts(doc, info) {
    if (!api?.preview || info.status !== "ready") return;
    const wanted = [];
    for (const entry of scanIndex(doc.text).entries) {
      const child = childOf(info, entry.name);
      if (!child || child.directory) continue;
      const lower = child.name.toLowerCase();
      if (info.asked.has(lower)) continue;
      if (info.asked.size >= EXCERPT_LIMIT) break;
      info.asked.add(lower);
      wanted.push([child, entry.title]);
    }
    if (!wanted.length) return;
    let next = 0;
    const worker = async () => {
      while (next < wanted.length) {
        const [child, title] = wanted[next++];
        let text = "";
        try {
          const file = await api.preview(doc.fileId, hrefFor(child.name));
          text = file?.text ?? openText(file?.id) ?? "";
        } catch {
          /* Shown without a sentence. */
        }
        info.excerpts.set(child.name.toLowerCase(), noteExcerpt(text, title));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (folders.get(doc.fileId) !== info) return;
    info.version++;
    rerender(doc);
  }
  // "library": files were created, renamed or removed: the shown index's
  // folder is listed again (the view stays as it is until then), others
  // when shown. "links": notes changed: their first sentences are read
  // again when the index is next shown (not at every save, nor while a
  // large library is being read).
  function invalidate(kind = "library") {
    const doc = getDocument();
    const shown = applies(doc) && doc.fileId ? folders.get(doc.fileId) : null;
    if (kind === "links") {
      for (const info of folders.values()) info.stale = true;
      return;
    }
    for (const [id, info] of folders) if (info !== shown) folders.delete(id);
    if (shown) load(doc, shown);
  }
  // What the shown view depends on besides the text.
  function key(doc) {
    const info = doc.fileId ? folders.get(doc.fileId) : null;
    return `${doc.mode}|${doc.preview ? 1 : 0}|${info ? info.status + info.version : "-"}`;
  }

  // ── Rendering ──
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const button = (className, label, content, action) => {
    const b = element("button", className);
    b.type = "button";
    b.tabIndex = -1;
    if (action) b.dataset.ix = action;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (content) b.innerHTML = content;
    else b.textContent = label;
    return b;
  };
  // The link's target as an href attribute (angle brackets and a link
  // title left out).
  const target = (href) => {
    const m = /^\s*(<[^>]*>|\S*)/.exec(href)[1];
    return m.startsWith("<") ? encodeURI(m.slice(1, -1)) : m;
  };

  function render(doc) {
    const scan = scanIndex(doc.text);
    const info = folderOf(doc);
    if (doc !== lastShown && info?.stale) {
      info.excerpts.clear();
      info.asked.clear();
      info.stale = false;
    }
    lastShown = doc;
    if (info?.status === "ready") loadExcerpts(doc, info);
    // The list lines blanked (same length: every other block keeps its
    // source positions), the note rendered, the lists put in their places.
    let masked = doc.text;
    if (scan.runs.length) {
      const parts = [];
      let from = 0;
      for (const run of scan.runs) {
        const start = scan.lines[run.first].start,
          end = scan.lines[run.last].start + scan.lines[run.last].text.length;
        parts.push(
          doc.text.slice(from, start),
          doc.text.slice(start, end).replace(/[^\r\n]/g, " "),
        );
        from = end;
      }
      parts.push(doc.text.slice(from));
      masked = parts.join("");
    }
    const result = renderDocument(
      { ...doc, text: masked },
      { deferMath: true, interactiveTasks: true },
    );
    const fragment = result.fragment;
    const context = {
      doc,
      scan,
      info,
      edit: editing(doc),
      state: stateOf(doc),
      first: true,
    };
    let last = null;
    for (const run of scan.runs) {
      const node = runNode(context, run);
      place(fragment, scan.lines[run.first].start, node);
      last = node;
    }
    const footer = footerNode(context);
    if (footer) {
      if (last) last.after(footer);
      else fragment.append(footer);
    }
    if (context.edit)
      for (const block of proseBlocks(fragment)) {
        block.classList.add("ix-prose");
        block.title = t("双击编辑这段文字");
      }
    const box = document.createElement("div");
    for (const node of fragment.childNodes) box.append(node.cloneNode(true));
    const html = box.innerHTML;
    return {
      ...result,
      html,
      fragment,
      bytes: html.length * 12 + (result.bytes - result.html.length * 12 || 0),
    };
  }
  // A list put after the last block that starts before it (inside the
  // section of the heading above it).
  function startOf(node) {
    if (node.nodeType !== 1) return null;
    const value =
      node.getAttribute("data-from") ??
      node.querySelector("[data-from]")?.getAttribute("data-from");
    return value == null ? null : Number(value);
  }
  function place(container, offset, node) {
    let last = null;
    for (const child of container.children) {
      const start = startOf(child);
      if (start != null && start >= offset) break;
      last = child;
    }
    if (last?.classList.contains("note-section")) {
      const body = last.querySelector(":scope > .section-body");
      if (body) return place(body, offset, node);
    }
    if (last) last.after(node);
    else container.prepend(node);
  }
  function proseBlocks(root) {
    const out = [];
    const walk = (container) => {
      for (const child of container.children) {
        if (child.matches(".ix-list, .ix-footer, .front-matter")) continue;
        if (child.matches(".note-section")) {
          if (child.firstElementChild?.matches("h1,h2,h3,h4,h5,h6"))
            out.push(child.firstElementChild);
          const body = child.querySelector(":scope > .section-body");
          if (body) walk(body);
        } else if (startOf(child) != null) out.push(child);
      }
    };
    walk(root);
    return out;
  }
  function runNode(context, run) {
    const list = element("div", "ix-list");
    list.setAttribute("role", "tree");
    list.setAttribute("aria-label", t("目录中的页面"));
    list.dataset.run = String(run.index);
    for (const i of run.roots) list.append(itemNode(context, i));
    return list;
  }
  function itemNode(context, i) {
    const { scan, info, edit, state, doc } = context;
    const entry = scan.entries[i];
    const item = element("div", "ix-item");
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", String(entry.depth + 1));
    item.dataset.line = String(entry.line);
    item.dataset.href = entry.href;
    // One stop for Tab: the first entry (moved with the focus).
    item.tabIndex = context.first ? 0 : -1;
    context.first = false;
    const row = element("div", "ix-row");
    const child = childOf(info, entry.name);
    const missing = Boolean(info?.status === "ready" && entry.name && !child);
    if (missing) item.classList.add("missing");
    if (child?.directory) item.dataset.kind = "folder";
    if (entry.children.length) {
      const closed = state.folds.has(foldKey(entry));
      item.setAttribute("aria-expanded", String(!closed));
      if (closed) item.classList.add("closed");
      row.append(
        button(
          "ix-twisty",
          t("展开或折叠 {name} 的子页", { name: entry.title }),
          " ",
          "fold",
        ),
      );
    } else row.append(element("span", "ix-twisty-space"));
    let title;
    if (missing) title = element("span", "ix-title", entry.title);
    else {
      title = element("a", "ix-title", entry.title);
      title.setAttribute("href", target(entry.href));
      title.tabIndex = -1;
      if (edit) title.draggable = false;
    }
    title.title = entry.title;
    row.append(title);
    const written = entry.name
      ? entry.name + (child?.directory ? "/" : "")
      : target(entry.href);
    if (
      written &&
      titleFor(entry.name || "").toLowerCase() !== entry.title.toLowerCase()
    )
      row.append(element("span", "ix-file", written));
    if (missing) {
      row.append(element("span", "ix-missing", t("不存在")));
      if (!doc.preview) {
        const actions = element("span", "ix-repair");
        actions.append(
          button("ix-text-button", t("创建"), null, "create"),
          button("ix-text-button", t("改为指向…"), null, "relocate"),
          button("ix-text-button", t("移出目录"), null, "remove"),
        );
        row.append(actions);
      }
    } else {
      const rest = entry.rest.trim();
      const excerpt = child ? info.excerpts.get(child.name.toLowerCase()) : "";
      if (rest) row.append(element("span", "ix-rest", rest));
      else if (excerpt) row.append(element("span", "ix-excerpt", excerpt));
    }
    if (edit) {
      row.draggable = true;
      const tools = element("span", "ix-tools");
      if (info?.folderId)
        tools.append(button("ix-tool", t("新建子页"), icon("plus"), "child"));
      tools.append(
        button("ix-tool", t("改标题"), icon("pencil"), "rename"),
        button("ix-tool", t("移出目录（不删除文件）"), icon("close"), "remove"),
      );
      row.append(tools);
    }
    item.append(row);
    if (entry.children.length) {
      const group = element("div", "ix-children");
      group.setAttribute("role", "group");
      for (const k of entry.children) group.append(itemNode(context, k));
      item.append(group);
    }
    return item;
  }
  function footerNode({ doc, scan, info, edit, state }) {
    const footer = element("div", "ix-footer");
    if (edit && info?.folderId) {
      const add = button("ix-new", t("新建页面"), null, "new");
      add.tabIndex = 0;
      add.innerHTML = `${icon("plus")}<span>${t("新建页面")}</span>`;
      footer.append(add);
    }
    if (info?.status === "ready") {
      const listed = new Set(
        scan.entries.map((entry) => entry.name?.toLowerCase()).filter(Boolean),
      );
      const own = (doc.name || "").toLowerCase();
      const unlisted = info.children.filter(
        (child) =>
          !child.index &&
          !isIndexName(child.name) &&
          child.name.toLowerCase() !== own &&
          !listed.has(child.name.toLowerCase()),
      );
      if (unlisted.length) {
        const tray = element("div", "ix-unlisted");
        if (!state.tray) tray.classList.add("closed");
        const toggle = button(
          "ix-unlisted-toggle",
          t("未列入目录（{count}）", { count: unlisted.length }),
          null,
          "tray",
        );
        toggle.tabIndex = 0;
        toggle.setAttribute("aria-expanded", String(state.tray));
        tray.append(toggle);
        const items = element("div", "ix-unlisted-items");
        for (const child of unlisted) {
          const row = element("div", "ix-unlisted-item");
          row.dataset.name = child.name;
          row.dataset.directory = String(Boolean(child.directory));
          if (child.directory) row.dataset.kind = "folder";
          const link = element(
            "a",
            "ix-title",
            child.name + (child.directory ? "/" : ""),
          );
          link.setAttribute("href", hrefFor(child.name, child.directory));
          row.append(link);
          if (edit) {
            row.draggable = true;
            link.draggable = false;
            row.append(button("ix-text-button", t("加入目录"), null, "add"));
          }
          items.append(row);
        }
        tray.append(items);
        footer.append(tray);
      }
    }
    return footer.childNodes.length ? footer : null;
  }

  // ── Editing ──
  // The entry an item shows, in the note as it is now (null, and shown
  // again, when the note changed under the view).
  function entryAt(item) {
    const doc = getDocument();
    if (!applies(doc) || !item) return null;
    const scan = scanIndex(doc.text);
    const line = Number(item.dataset.line);
    const index = scan.entries.findIndex((entry) => entry.line === line);
    if (index < 0 || scan.entries[index].href !== item.dataset.href) {
      rerender(doc);
      return null;
    }
    return { doc, scan, index, entry: scan.entries[index] };
  }
  // One edit of the note: one step to undo.
  function apply(doc, result) {
    if (!result || getDocument() !== doc) return false;
    if (view.state.doc.toString() !== doc.text) {
      report(t("目录正在更新，请稍后再试。"));
      return false;
    }
    // The entry acted on is shown anew; the focus goes to it after.
    if (host.contains(document.activeElement)) document.activeElement.blur();
    view.dispatch({
      changes: result.change,
      annotations: isolateHistory.of("full"),
      userEvent: "input.index",
    });
    rerender(doc);
    if (result.line != null) focusLine(result.line);
    return true;
  }
  function focusLine(line) {
    const item = host.querySelector(`.ix-item[data-line="${line}"]`);
    if (item) focusItem(item);
  }
  function focusItem(item) {
    for (const other of host.querySelectorAll('.ix-item[tabindex="0"]'))
      if (other !== item) other.tabIndex = -1;
    item.tabIndex = 0;
    item.focus({ preventScroll: false });
  }
  const visibleItems = () =>
    [...host.querySelectorAll(".ix-item")].filter(
      (item) => !item.parentElement.closest(".ix-item.closed"),
    );
  function fold(item, closed) {
    const found = entryAt(item);
    if (!found || !found.entry.children.length) return;
    const { doc, entry } = found;
    const folds = stateOf(doc).folds;
    if (closed) folds.add(foldKey(entry));
    else folds.delete(foldKey(entry));
    item.classList.toggle("closed", closed);
    item.setAttribute("aria-expanded", String(!closed));
  }
  // A title typed in place: Enter or leaving the box takes it, Esc cancels.
  function editTitle(item) {
    const found = entryAt(item);
    if (!found || !editing(found.doc)) return;
    const title = item.querySelector(":scope > .ix-row > .ix-title");
    const input = element("input", "ix-title-input");
    input.value = found.entry.title;
    input.setAttribute("aria-label", t("页面标题"));
    input.spellcheck = false;
    title.hidden = true;
    title.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const value = input.value;
      input.remove();
      title.hidden = false;
      const again = keep && entryAt(item);
      if (
        again &&
        apply(again.doc, retitleEntry(again.doc.text, again.index, value))
      )
        return;
      focusItem(item);
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }
  // The file of a new page. One place to change when the main process
  // offers creating index pages itself.
  async function createPageFile(folderId, name) {
    return api.createEntry(folderId, name, "note", newNoteText(name));
  }
  const fileName = (name) =>
    /\.(md|markdown|txt)$/i.test(name) ? name : name + ".md";
  // A name typed for a new page, in a row where it will be listed.
  function askName(container, before = null) {
    return new Promise((resolve) => {
      const row = element("div", "ix-new-row");
      const input = element("input", "ix-title-input");
      input.placeholder = t("新页面名称");
      input.setAttribute("aria-label", t("新页面名称"));
      input.spellcheck = false;
      row.append(input);
      container.insertBefore(row, before);
      input.focus();
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        row.remove();
        resolve(value);
      };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(input.value.trim() || null);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      });
      input.addEventListener("blur", () => finish(input.value.trim() || null));
    });
  }
  async function newPage(item) {
    const doc = getDocument();
    const info = applies(doc) && folderOf(doc);
    if (!info?.folderId || !editing(doc)) return;
    let container,
      before = null,
      made = null;
    if (item) {
      fold(item, false);
      container = item.querySelector(":scope > .ix-children");
      if (!container) {
        container = made = element("div", "ix-children");
        item.append(container);
      }
    } else {
      const lists = host.querySelectorAll(".ix-list");
      container = lists[lists.length - 1] || host.querySelector(".ix-footer");
      before = container?.matches(".ix-footer") ? container.firstChild : null;
    }
    if (!container) return;
    const typed = await askName(container, before);
    made?.remove();
    if (!typed) {
      if (item) focusItem(item);
      return;
    }
    const name = fileName(typed);
    // A file of that name already in the folder is listed, not made again.
    if (!childOf(info, name)) {
      await createPageFile(info.folderId, name);
      info.children.push({ name, directory: false });
      info.version++;
      filesChanged();
    }
    const now = getDocument();
    if (now !== doc) return;
    const parent = item ? entryAt(item) : null;
    if (item && !parent) return;
    apply(
      doc,
      insertEntry(
        doc.text,
        { title: titleFor(name), href: hrefFor(name) },
        parent ? parent.index : -1,
        parent ? "into" : "after",
      ),
    );
  }
  async function createMissing(item) {
    const found = entryAt(item);
    const info = found && folderOf(found.doc);
    if (!info?.folderId || !found.entry.name) return;
    const name = found.entry.name;
    const folder =
      /\/\s*$/.test(target(found.entry.href)) ||
      !/\.(md|markdown|txt)$/i.test(name);
    if (folder) await api.createEntry(info.folderId, name, "folder", "");
    else await createPageFile(info.folderId, name);
    info.children.push({ name, directory: folder });
    info.version++;
    filesChanged();
    rerender(found.doc);
    focusLine(found.entry.line);
  }
  // Point a missing entry at a file of the folder, picked from a list.
  function relocate(item) {
    const found = entryAt(item);
    const info = found && folderOf(found.doc);
    if (!info || info.status !== "ready") return;
    const listed = new Set(
      found.scan.entries.map((e) => e.name?.toLowerCase()).filter(Boolean),
    );
    const choices = info.children
      .filter((child) => !child.index && !isIndexName(child.name))
      .sort(
        (a, b) =>
          Number(listed.has(a.name.toLowerCase())) -
          Number(listed.has(b.name.toLowerCase())),
      );
    if (!choices.length) return report(t("这个文件夹里没有可指向的笔记"));
    const select = element("select", "ix-relocate");
    select.setAttribute("aria-label", t("改为指向"));
    select.append(element("option", "", t("选择文件…")));
    select.firstChild.value = "";
    for (const child of choices) {
      const option = element(
        "option",
        "",
        child.name + (child.directory ? "/" : ""),
      );
      option.value = child.name;
      option.dataset.directory = String(Boolean(child.directory));
      select.append(option);
    }
    const repair = item.querySelector(":scope > .ix-row > .ix-repair");
    repair.hidden = true;
    repair.after(select);
    select.focus();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const option = select.selectedOptions[0];
      select.remove();
      repair.hidden = false;
      const again = option?.value && entryAt(item);
      if (
        again &&
        apply(
          again.doc,
          relinkEntry(
            again.doc.text,
            again.index,
            hrefFor(option.value, option.dataset.directory === "true"),
          ),
        )
      )
        return;
      focusItem(item);
    };
    select.addEventListener("change", finish);
    select.addEventListener("blur", finish);
    select.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        select.value = "";
        finish();
      }
    });
  }
  function addUnlisted(row, goal = null, place = "after") {
    const doc = getDocument();
    if (!applies(doc) || doc.preview) return;
    const name = row.dataset.name,
      directory = row.dataset.directory === "true";
    const found = goal ? entryAt(goal) : null;
    if (goal && !found) return;
    apply(
      doc,
      insertEntry(
        doc.text,
        { title: titleFor(name), href: hrefFor(name, directory) },
        found ? found.index : -1,
        found ? place : "after",
      ),
    );
  }
  function act(action, item) {
    const found = entryAt(item);
    if (!found) return;
    const { doc, index } = found;
    const edits = {
      indent: () => indentEntry(doc.text, index),
      outdent: () => outdentEntry(doc.text, index),
      up: () => shiftEntry(doc.text, index, -1),
      down: () => shiftEntry(doc.text, index, 1),
      remove: () => removeEntry(doc.text, index),
    };
    const result = edits[action]();
    if (!apply(doc, result)) focusItem(item);
  }

  // A prose block's Markdown, edited in place (Edit mode): Ctrl+Enter or
  // leaving the box takes it, Esc cancels.
  function editBlock(start) {
    const doc = getDocument();
    if (!applies(doc) || !editing(doc)) return;
    // The block: a child of the note, of a section's body, or a heading.
    let block = start;
    while (
      block?.parentElement &&
      block.parentElement !== host &&
      !block.parentElement.matches(".section-body, .note-section")
    )
      block = block.parentElement;
    if (!block?.parentElement || !host.contains(block)) return;
    if (
      block.matches(
        ".ix-list, .ix-footer, .note-section, .section-rail, .section-body, .front-matter",
      )
    )
      return;
    const positions = [block, ...block.querySelectorAll("[data-from]")]
      .filter((el) => el.hasAttribute?.("data-from"))
      .map((el) => [Number(el.dataset.from), Number(el.dataset.to)]);
    if (!positions.length) return;
    const from = Math.min(...positions.map(([a]) => a)),
      to = Math.max(...positions.map(([, b]) => b));
    if (!(from >= 0 && to > from && to <= doc.text.length)) return;
    const original = doc.text.slice(from, to);
    const shown = original.replace(/(\r?\n)+$/, "");
    const area = element("textarea", "ix-block-editor");
    area.value = shown;
    area.spellcheck = false;
    area.setAttribute("aria-label", t("编辑这段 Markdown"));
    block.hidden = true;
    block.after(area);
    const fit = () => {
      area.style.height = "auto";
      area.style.height = area.scrollHeight + 2 + "px";
    };
    fit();
    area.addEventListener("input", fit);
    area.focus();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const value = area.value;
      area.remove();
      block.hidden = false;
      if (!keep || value === shown || getDocument() !== doc) return;
      if (doc.text.slice(from, to) !== original) {
        report(t("这段文字已在别处改动，这次修改未写入"));
        return;
      }
      apply(doc, {
        change: { from, to: from + shown.length, insert: value },
        line: null,
      });
    };
    area.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      )
        // Saving takes what was typed first.
        finish(true);
      else event.stopPropagation();
    });
    area.addEventListener("blur", () => finish(true));
  }

  // ── Events (on the reading view; only for an index note) ──
  const managed = () => {
    const doc = getDocument();
    return applies(doc) ? doc : null;
  };
  host.addEventListener("click", (event) => {
    const doc = managed();
    if (!doc) return;
    const control = event.target.closest?.("[data-ix]");
    const item = event.target.closest?.(".ix-item");
    if (control) {
      event.preventDefault();
      const action = control.dataset.ix;
      if (action === "fold")
        return fold(item, !item.classList.contains("closed"));
      if (action === "tray") {
        const tray = control.closest(".ix-unlisted");
        const state = stateOf(doc);
        state.tray = tray.classList.contains("closed");
        tray.classList.toggle("closed", !state.tray);
        control.setAttribute("aria-expanded", String(state.tray));
        return;
      }
      if (action === "new") return run(() => newPage(null))();
      if (action === "add")
        return addUnlisted(control.closest(".ix-unlisted-item"));
      if (!item) return;
      if (action === "child") return run(() => newPage(item))();
      if (action === "rename") return editTitle(item);
      if (action === "create") return run(() => createMissing(item))();
      if (action === "relocate") return relocate(item);
      if (action === "remove") return act("remove", item);
      return;
    }
    if (!item || event.target.closest("a, input, select, textarea")) return;
    const row = event.target.closest(".ix-row");
    if (!row) return;
    // A click on the row beside its title: the page opens (Read mode), or
    // the entry is picked for the keys (Edit mode).
    if (editing(doc)) focusItem(item);
    else if (!item.classList.contains("missing"))
      open(
        item
          .querySelector(":scope > .ix-row > .ix-title")
          ?.getAttribute("href"),
      );
  });
  host.addEventListener(
    "dblclick",
    (event) => {
      const doc = managed();
      if (!doc) return;
      if (event.target.closest?.("textarea, input, select")) {
        event.stopPropagation();
        return;
      }
      const inList = event.target.closest?.(".ix-list, .ix-footer");
      if (inList) {
        event.stopPropagation();
        event.preventDefault();
        const item = event.target.closest(".ix-item");
        if (item && editing(doc) && event.target.closest(".ix-title"))
          editTitle(item);
        return;
      }
      if (doc.preview) return;
      if (editing(doc)) {
        event.stopPropagation();
        editBlock(event.target);
        return;
      }
      // Read mode: into Edit mode with this block's Markdown open (unless
      // the format bar takes the double click to select a word).
      if (readingFormat() && !event.altKey) return;
      event.stopPropagation();
      const from = startOf(
        event.target.closest?.("[data-from]") || event.target,
      );
      setMode("edit");
      if (from == null) return;
      const again = host.querySelector(`[data-from="${from}"]`);
      if (again) editBlock(again);
    },
    true,
  );
  host.addEventListener("keydown", (event) => {
    const doc = managed();
    if (!doc) return;
    const item = event.target.closest?.(".ix-item");
    if (!item || event.target !== item) return;
    const key = event.key;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const items = visibleItems();
    const at = items.indexOf(item);
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        const next = items[at + (key === "ArrowDown" ? 1 : -1)];
        handled();
        if (next) focusItem(next);
        return;
      }
      if (key === "ArrowRight" || key === "ArrowLeft") {
        handled();
        const open = !item.classList.contains("closed");
        const hasChildren = item.hasAttribute("aria-expanded");
        if (key === "ArrowRight") {
          if (hasChildren && !open) fold(item, false);
          else if (hasChildren)
            focusItem(item.querySelector(":scope > .ix-children > .ix-item"));
        } else if (hasChildren && open) fold(item, true);
        else {
          const parent = item.parentElement.closest(".ix-item");
          if (parent) focusItem(parent);
        }
        return;
      }
      if (key === "Enter") {
        handled();
        if (!item.classList.contains("missing"))
          open(
            item
              .querySelector(":scope > .ix-row > .ix-title")
              ?.getAttribute("href"),
          );
        return;
      }
    }
    if (!editing(doc)) return;
    let action = null;
    if (key === "Tab" && !event.altKey && !event.ctrlKey)
      action = event.shiftKey ? "outdent" : "indent";
    else if (event.altKey && event.shiftKey && key === "ArrowRight")
      action = "indent";
    else if (event.altKey && event.shiftKey && key === "ArrowLeft")
      action = "outdent";
    else if (event.altKey && !event.shiftKey && key === "ArrowUp")
      action = "up";
    else if (event.altKey && !event.shiftKey && key === "ArrowDown")
      action = "down";
    else if (key === "Delete" && !event.altKey && !event.ctrlKey)
      action = "remove";
    else if (key === "F2") {
      handled();
      editTitle(item);
      return;
    }
    if (!action) return;
    handled();
    act(action, item);
  });
  // Dragging (Edit mode): before, after or onto (as a sub-page) an entry; a
  // file not in the index dragged in becomes an entry there.
  let dragging = null;
  const placeOf = (event, row) => {
    const box = row.getBoundingClientRect();
    const y = (event.clientY - box.top) / box.height;
    return y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
  };
  const clearDrop = () => {
    for (const el of host.querySelectorAll(".ix-row[data-drop]"))
      delete el.dataset.drop;
  };
  host.addEventListener("dragstart", (event) => {
    const doc = managed();
    if (!doc || !editing(doc)) return;
    const row = event.target.closest?.(".ix-row, .ix-unlisted-item");
    if (!row) return;
    dragging = row.matches(".ix-row")
      ? { item: row.parentElement }
      : { unlisted: row };
    event.dataTransfer.setData(DRAG_TYPE, "1");
    event.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  });
  host.addEventListener("dragend", () => {
    for (const el of host.querySelectorAll(".dragging"))
      el.classList.remove("dragging");
    dragging = null;
    clearDrop();
  });
  host.addEventListener("dragover", (event) => {
    if (!dragging) return;
    const row = event.target.closest?.(".ix-row");
    if (!row || row.parentElement === dragging.item) return clearDrop();
    if (dragging.item?.contains(row)) return clearDrop();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const place = placeOf(event, row);
    if (row.dataset.drop === place) return;
    clearDrop();
    row.dataset.drop = place;
  });
  host.addEventListener("dragleave", (event) => {
    const row = event.target.closest?.(".ix-row");
    if (row && !row.contains(event.relatedTarget)) delete row.dataset.drop;
  });
  host.addEventListener("drop", (event) => {
    if (!dragging) return;
    const row = event.target.closest?.(".ix-row");
    const drag = dragging;
    dragging = null;
    clearDrop();
    if (!row) return;
    event.preventDefault();
    const place = placeOf(event, row);
    const goal = row.parentElement;
    if (drag.unlisted) return addUnlisted(drag.unlisted, goal, place);
    const from = entryAt(drag.item),
      to = entryAt(goal);
    if (!from || !to) return;
    apply(from.doc, moveEntry(from.doc.text, from.index, to.index, place));
  });

  return { applies, key, render, invalidate };
}
