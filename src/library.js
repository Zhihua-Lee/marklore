import { t } from "../desktop/i18n.mjs";
import { MATH } from "../desktop/snippet.mjs";
import { excludedBy } from "../desktop/excluded.mjs";
import { renderMarkdown, loadMath, mayContainMath } from "./markdown.js";
import { movedPathOf } from "../desktop/link-rewrite.mjs";
import {
  askCreateIndex,
  askLinks,
  askRepair,
  pickFolder,
} from "./tree-dialogs.js";
// Folder browser: lazily loaded tree, current-folder following and search
// (file names in the folders shown, and the text of the library's notes).

// A search snippet as Markdown for the (sanitizing) renderer: its text with
// punctuation escaped, formulas kept, and the hits in <mark>. A hit inside a
// formula marks the whole formula, which KaTeX could not split.
export function snippetMarkdown(snippet) {
  const text = snippet.map(([part]) => part).join("");
  const math = [...text.matchAll(MATH)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const marks = [];
  let at = 0;
  for (const [part, hit] of snippet) {
    if (hit) {
      let a = at,
        b = at + part.length;
      for (const [c, d] of math)
        if (a < d && b > c) {
          a = Math.min(a, c);
          b = Math.max(b, d);
        }
      if (marks.length && a <= marks.at(-1)[1])
        marks.at(-1)[1] = Math.max(marks.at(-1)[1], b);
      else marks.push([a, b]);
    }
    at += part.length;
  }
  const escape = (s) => s.replace(/[!-/:-@[-`{-~]/g, "\\$&");
  // Text between from and to: formulas verbatim, the rest escaped.
  const plain = (from, to) => {
    let out = "",
      i = from;
    for (const [c, d] of math) {
      if (d <= from || c >= to) continue;
      out +=
        escape(text.slice(i, Math.max(i, c))) +
        text.slice(Math.max(c, i), Math.min(d, to));
      i = Math.min(d, to);
    }
    return out + escape(text.slice(i, to));
  };
  let out = "",
    i = 0;
  for (const [a, b] of marks) {
    out += plain(i, a) + "<mark>" + plain(a, b) + "</mark>";
    i = b;
  }
  return out + plain(i, text.length);
}
// Notes with sub-pages the reader folded (by path), kept across rebuilds.
const closedPages = new Set();
export function createLibrary({
  api,
  roots,
  getActive,
  getSettings,
  add,
  run,
  report,
  changed,
  openResult,
  // Whether a note (by path) is open with unsaved changes.
  isUnsaved = () => false,
  // Open notes at or under a path that have unsaved changes (names).
  unsavedUnder = () => [],
  // Notes renamed or moved on disk by the tree: [{ id, path, name }].
  renamed = () => {},
  // Paths of open notes with unsaved changes (never written under them).
  drafts = () => [],
  // Before `renamed`: what a rename, move or undo did to notes open with
  // unsaved changes, for their drafts: { moves, links, drafts: [{ path,
  // ops }] }. Returns how many drafts changed.
  patchDrafts = () => 0,
  // Open notes with unsaved changes whose links these moves would change:
  // [{ path, name, links }].
  draftLinks = () => [],
  // A repair to apply to an open draft ({ path, kind, ... }, note-repair).
  repaired = () => {},
  // A note or folder went to the Recycle Bin: close its tabs.
  trashed = () => {},
  copyLink = () => {},
  changeSettings = () => {},
  // A note just created in the tree: open it for writing.
  openNew = (doc) => add(doc),
  // What a note created in the tree starts with (by its file name).
  newNoteText = () => "",
}) {
  const $ = (s) => document.querySelector(s);
  let currentFolder = null;
  let folderEpoch = 0;
  let treeEpoch = 0;
  let searchTimer,
    searchEpoch = 0;
  const within = (p, folder) => {
    const a = p.toLowerCase().replace(/[\\/]+$/, ""),
      b = folder.toLowerCase().replace(/[\\/]+$/, "");
    return a === b || a.startsWith(b + "\\") || a.startsWith(b + "/");
  };
  const samePath = (a, b) =>
    a.toLowerCase().replace(/[\\/]+$/, "") ===
    b.toLowerCase().replace(/[\\/]+$/, "");
  const inLibrary = (folder) =>
    roots.some((root) => within(folder.path, root.path));
  async function openFolder() {
    if (!api) return report(t("请运行桌面版以访问文件夹"));
    const root = await api.pickFolder(getActive()?.fileId || null);
    if (root) await addRoot(root);
  }
  async function addRoot(root) {
    if (roots.some((r) => samePath(r.path, root.path))) return;
    roots.push(root);
    await refresh();
    changed();
  }
  // The open note's folder heads the tree only when the library does not
  // hold it; a folder inside the library is shown where it is.
  function outsideFolder() {
    return currentFolder && !inLibrary(currentFolder) ? currentFolder : null;
  }
  function browsingRoots() {
    const outside = outsideFolder();
    return outside ? [outside, ...roots] : roots;
  }
  function markCurrentFile() {
    const current = getActive()?.path?.toLowerCase();
    for (const button of $("#tree").querySelectorAll(
      ".file, .text-note-name",
    )) {
      if (current && button.title.toLowerCase() === current)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }
  async function followCurrentFolder() {
    const doc = getActive(),
      epoch = ++folderEpoch;
    if (!doc?.fileId || !api?.currentFolder) return;
    const folder = await api.currentFolder(doc.fileId);
    if (epoch !== folderEpoch || getActive() !== doc || !getSettings().sidebar)
      return;
    // A search in progress stays: the reader is going through its results.
    if ($("#file-filter").value.trim()) {
      currentFolder = folder;
      markCurrentFile();
      return;
    }
    const before = outsideFolder()?.path;
    currentFolder = folder;
    // Only a change of the folder shown on top rebuilds the tree.
    if (before !== outsideFolder()?.path) {
      $("#file-filter").value = "";
      ++searchEpoch;
      clearTimeout(searchTimer);
      await refresh();
      if (epoch !== folderEpoch) return;
    }
    await revealFolder(folder.path);
    if (epoch !== folderEpoch) return;
    markCurrentFile();
    const current = $("#tree").querySelector('[aria-current="page"]');
    // A note under a folded sub-page: unfold the pages above it.
    for (let page = current?.closest(".page.closed"); page;) {
      page.querySelector(":scope > .page-row > .page-twisty").click();
      page = page.parentElement.closest(".page.closed");
    }
    current?.scrollIntoView({ block: "nearest" });
  }
  // A folder shown and focused in the tree, opened down to it (a folder
  // entry of an index with no index of its own). False when the library
  // does not hold it.
  async function revealPath(target) {
    const filter = $("#file-filter");
    if (filter.value.trim()) {
      filter.value = "";
      ++searchEpoch;
      await renderTree();
    }
    const details = await revealFolder(target);
    if (!details) return false;
    const summary = details.querySelector(":scope > summary");
    summary.scrollIntoView({ block: "nearest" });
    summary.focus();
    return true;
  }
  // Open the folders down to this one (each loads its entries first).
  async function revealFolder(target) {
    const tops = [...$("#tree").children].filter(
      (el) => el.matches("details.folder") && within(target, el.dataset.path),
    );
    let details = tops.sort(
      (a, b) => b.dataset.path.length - a.dataset.path.length,
    )[0];
    while (details) {
      await details.load();
      if (samePath(details.dataset.path, target)) return details;
      const parent = details;
      details = [...parent.querySelectorAll("details.folder")].find(
        (el) =>
          el.parentElement.closest("details.folder") === parent &&
          within(target, el.dataset.path),
      );
    }
    return null;
  }
  // open: folder paths to reopen, so a rebuild keeps what the reader expanded.
  // Folders left out of search and backlinks (Settings; right-click a folder).
  const excludedNow = () => excludedBy(getSettings().searchExclude || []);
  function markExcluded(details, isExcluded) {
    const summary = details.querySelector(":scope > summary");
    const on = isExcluded(details.dataset.path);
    details.classList.toggle("excluded", on);
    if (on) summary.dataset.excluded = t("不参与搜索");
    else delete summary.dataset.excluded;
  }
  // The settings changed: mark the folders shown again.
  function showExcluded() {
    const isExcluded = excludedNow();
    for (const details of $("#tree").querySelectorAll("details.folder"))
      markExcluded(details, isExcluded);
  }
  // A folder's entries. In a folder with an index file (desktop/
  // folder-index.mjs) they come in the index's order, a note listed under
  // another showing as its sub-item (depth), and those the index does not
  // list after a quiet separator; dragging rewrites the index (a folder
  // without one is asked to start one first).
  async function fillFolder(details, entry, children, open) {
    const indexFile = children.find((child) => child.index);
    if (indexFile) details.dataset.index = indexFile.path;
    else delete details.dataset.index;
    const stack = [{ depth: -1, box: details }];
    let separated = false;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const depth = child.listed ? child.depth : 0;
      while (stack.length > 1 && stack.at(-1).depth >= depth) stack.pop();
      const box = stack.at(-1).box;
      if (indexFile && !child.listed && !child.index && !separated) {
        separated = true;
        const line = element("div", "tree-unlisted", t("未列入目录"));
        line.setAttribute("role", "separator");
        box.append(line);
      }
      if (child.directory) {
        const folder = await branch(child, open);
        draggable(folder.firstChild, entry, child, indexFile);
        box.append(folder);
        continue;
      }
      const b = document.createElement("button");
      b.className = "file";
      b.textContent = child.name;
      b.title = child.path;
      // An index with entries whose note is gone says how many (repaired
      // from its menu).
      if (child.missing)
        b.dataset.missing = t("{count} 项不存在", { count: child.missing });
      b.onclick = run(async () =>
        add(await api.openChild(entry.id, child.name)),
      );
      draggable(b, entry, child, indexFile);
      const next = children[i + 1];
      if (!(next?.listed && child.listed && next.depth > depth)) {
        box.append(b);
        continue;
      }
      // Sub-pages: under the note, folded like a folder.
      const page = element("div", "page");
      const row = element("div", "page-row");
      const twisty = element("button", "page-twisty");
      const pages = element("div", "pages");
      pages.setAttribute("role", "group");
      const fold = (closed) => {
        page.classList.toggle("closed", closed);
        twisty.setAttribute("aria-expanded", String(!closed));
        if (closed) closedPages.add(child.path);
        else closedPages.delete(child.path);
      };
      twisty.setAttribute(
        "aria-label",
        t("展开或折叠 {name} 的子页", { name: child.name }),
      );
      twisty.onclick = () => fold(!page.classList.contains("closed"));
      fold(closedPages.has(child.path));
      row.append(twisty, b);
      page.append(row, pages);
      box.append(page);
      stack.push({ depth, box: pages });
    }
  }
  // Dragging in the tree. A drop before or after an entry of the same
  // folder reorders it in the folder's index; in the middle of a note, it
  // becomes that note's child page; in the middle of a folder (or on a
  // library folder), it moves there. A folder without an index is asked to
  // start one before its first reordering.
  const DRAG_TYPE = "application/x-marklore-tree";
  let dragging = null;
  const placeOf = (event, target, child, sortable) => {
    const box = target.getBoundingClientRect();
    const y = (event.clientY - box.top) / box.height;
    if (child.directory) {
      if (!sortable) return "move";
      return y < 0.25 ? "before" : y > 0.75 ? "after" : "move";
    }
    // Only notes nest: a folder goes before or after a note.
    if (dragging?.directory) return y < 0.5 ? "before" : "after";
    return y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
  };
  // Whether the entry being dragged may go there.
  const allowed = (place, entry, child) => {
    if (!dragging) return false;
    if (place === "move")
      return (
        !samePath(dragging.folderPath, child.path) &&
        !within(child.path, dragging.path)
      );
    return dragging.folder === entry?.id && dragging.name !== child.name;
  };
  const clearDrop = () => {
    for (const el of $("#tree").querySelectorAll(".drop-target")) {
      el.classList.remove("drop-target");
      delete el.dataset.drop;
    }
  };
  // Drops on a row: reorder (in its folder `entry`), and for a folder's
  // row, moving into it.
  function dropZone(target, entry, child, sortable) {
    const placeNow = (event) => {
      const place = placeOf(event, target, child, sortable);
      if (place !== "move" && !sortable) return null;
      return allowed(place, entry, child) ? place : null;
    };
    target.addEventListener("dragover", (event) => {
      const place = placeNow(event);
      if (!place) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (target.dataset.drop === place) return;
      clearDrop();
      target.classList.add("drop-target");
      target.dataset.drop = place;
    });
    target.addEventListener("dragleave", (event) => {
      if (target.contains(event.relatedTarget)) return;
      target.classList.remove("drop-target");
      delete target.dataset.drop;
    });
    target.addEventListener("drop", (event) => {
      const place = placeNow(event);
      if (!place) return;
      event.preventDefault();
      const moved = dragging;
      dragging = null;
      clearDrop();
      if (place === "move") run(() => moveEntry(moved, child.path))();
      else
        run(() =>
          reorder(folderInfoOf(entry), moved.name, child.name, place),
        )();
    });
  }
  function draggable(target, entry, child, indexFile) {
    if (child.index) {
      target.dataset.indexFile = "";
      return;
    }
    target.dataset.indexName = child.name;
    target.dataset.listed = String(Boolean(child.listed));
    target.draggable = true;
    target.addEventListener("dragstart", (event) => {
      dragging = {
        folder: entry.id,
        folderPath: entry.path,
        name: child.name,
        path: child.path,
        directory: Boolean(child.directory),
      };
      event.dataTransfer.setData(DRAG_TYPE, child.name);
      event.dataTransfer.effectAllowed = "move";
    });
    target.addEventListener("dragend", () => {
      dragging = null;
      clearDrop();
    });
    // Reordering onto the index's entries (any entry, in a folder that has
    // no index yet); a folder's row also takes moves into it.
    const sortable = indexFile ? Boolean(child.listed) : true;
    if (sortable || child.directory) dropZone(target, entry, child, sortable);
  }
  // A folder of the tree as the operations need it.
  const folderInfoOf = (entry) => {
    const details = [...$("#tree").querySelectorAll("details.folder")].find(
      (el) => el.dataset.id === entry.id,
    );
    return {
      id: entry.id,
      path: entry.path ?? details?.dataset.path,
      name: entry.name ?? details?.dataset.name,
      index: details?.dataset.index || null,
    };
  };
  const folderInfo = (details) => ({
    id: details.dataset.id,
    path: details.dataset.path,
    name: details.dataset.name,
    index: details.dataset.index || null,
  });
  // The folder's index, started on the reader's word when it has none.
  // Returns its path, or null.
  async function ensureIndex(folder) {
    if (folder.index) return folder.index;
    if (!(await askCreateIndex(folder.name))) return null;
    const made = await api.createIndex(folder.id);
    await refresh();
    return made.path;
  }
  // An index open with unsaved changes is not rewritten under them.
  function indexBusy(index, message) {
    if (!isUnsaved(index)) return false;
    report(message(index.split(/[\\/]/).pop()));
    return true;
  }
  async function reorder(folder, name, target, place) {
    const index = await ensureIndex(folder);
    if (!index) return;
    if (
      indexBusy(index, (name) =>
        t("{name} 有未保存的修改，请先保存，再在文件树中拖动排序", { name }),
      )
    )
      return;
    if (!api.reorderIndex) return;
    await api.reorderIndex(folder.id, { name, target, place });
    await refresh();
  }
  // The row of this path in the rebuilt tree (its folders load a moment
  // later), focused.
  async function focusRow(path) {
    for (let i = 0; i < 40; i++) {
      const again = [
        ...$("#tree").querySelectorAll("button.file, details.folder > summary"),
      ].find((el) => el.title === path);
      if (again) return again.focus();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  // One change of the index from the keyboard (Alt+↑/↓ in a folder without
  // an index, Alt+Shift+←/→): asks for an index first, then focuses the
  // entry again. Returns whether it changed (null: not tried).
  async function changeIndex(folder, op, path) {
    const index = await ensureIndex(folder);
    if (!index) return null;
    if (
      indexBusy(index, (name) =>
        t("{name} 有未保存的修改，请先保存，再调整目录", { name }),
      )
    )
      return null;
    const done = await api.editIndex(folder.id, op);
    await refresh();
    await focusRow(path);
    return Boolean(done);
  }
  // The rows at an entry's level (its row and its siblings'), only those
  // the index lists when it has one.
  function levelOf(item, listedOnly) {
    const own =
      item.matches("summary") || item.parentElement.matches(".page-row")
        ? item.parentElement.closest("details, .page")
        : item;
    return [...own.parentElement.children]
      .map((el) =>
        el.matches(".page")
          ? el.querySelector(".file")
          : el.matches("details")
            ? el.firstChild
            : // The folder's own name is not one of its entries.
              el.matches("summary")
              ? null
              : el,
      )
      .filter(
        (el) =>
          el?.dataset.indexName &&
          (!listedOnly || el.dataset.listed === "true"),
      );
  }
  const unlistedMessage = (name) =>
    t("“{name}”未列入目录，请先把它拖进目录", { name });
  // Alt+↑/↓ on a listed entry: the same move by keyboard, past the entry
  // before or after it at its level.
  $("#tree").addEventListener("keydown", (event) => {
    if (!event.altKey || event.shiftKey || !/^Arrow(Up|Down)$/.test(event.key))
      return;
    const item = event.target.closest?.("[data-index-name]");
    if (!item) return;
    const up = event.key === "ArrowUp";
    const folderEl = folderOf(
      item.matches("summary") ? item.parentElement.parentElement : item,
    );
    if (!folderEl) return;
    const indexed = Boolean(folderEl.dataset.index);
    if (indexed && item.dataset.listed !== "true") {
      event.preventDefault();
      report(unlistedMessage(item.dataset.indexName));
      return;
    }
    const level = levelOf(item, indexed);
    const at = level.indexOf(item);
    const other = level[at + (up ? -1 : 1)];
    // Nothing to pass: nothing is asked or written.
    if (at < 0 || !other) return;
    event.preventDefault();
    // A folder without an index: start one, then move.
    if (!indexed) {
      run(() =>
        changeIndex(
          folderInfo(folderEl),
          { kind: "shift", ref: item.dataset.indexName, step: up ? -1 : 1 },
          item.title,
        ),
      )();
      return;
    }
    run(async () => {
      await reorder(
        folderInfo(folderEl),
        item.dataset.indexName,
        other.dataset.indexName,
        up ? "before" : "after",
      );
      await focusRow(item.title);
    })();
  });
  // Alt+Shift+→ makes a note the child page of the note above it, Alt+Shift+←
  // takes it a level up (Tab stays the way through the tree).
  $("#tree").addEventListener("keydown", (event) => {
    if (
      !event.altKey ||
      !event.shiftKey ||
      !/^Arrow(Left|Right)$/.test(event.key)
    )
      return;
    const item = event.target.closest?.("#tree button.file[data-index-name]");
    if (!item) return;
    event.preventDefault();
    const indent = event.key === "ArrowRight";
    const folderEl = folderOf(item);
    if (folderEl.dataset.index && item.dataset.listed !== "true")
      return report(unlistedMessage(item.dataset.indexName));
    // Without an index every entry is at the top: a move that cannot
    // happen is said at once, without asking to start an index.
    if (!folderEl.dataset.index) {
      if (!indent) return report(t("已在最上一层"));
      const level = levelOf(item, false);
      const above = level[level.indexOf(item) - 1];
      if (!above?.matches("button.file"))
        return report(t("上面没有可作为上级的笔记"));
    }
    run(async () => {
      const changed = await changeIndex(
        folderInfo(folderOf(item)),
        { kind: indent ? "indent" : "outdent", ref: item.dataset.indexName },
        item.title,
      );
      if (changed === false)
        report(indent ? t("上面没有可作为上级的笔记") : t("已在最上一层"));
    })();
  });
  async function branch(entry, open = null) {
    const details = document.createElement("details");
    details.className = "folder";
    details.dataset.path = entry.path;
    details.dataset.id = entry.id;
    details.dataset.name = entry.name;
    const summary = document.createElement("summary");
    summary.textContent = entry.name;
    summary.title = entry.path;
    details.append(summary);
    markExcluded(details, excludedNow());
    // Entries load once, when the folder is first opened.
    let loading = null;
    const load = () =>
      (loading ??= (async () => {
        await fillFolder(details, entry, await api.list(entry.id), open);
        markCurrentFile();
      })().catch((e) => {
        loading = null;
        throw e;
      }));
    details.load = async () => {
      details.open = true;
      await load();
    };
    details.addEventListener(
      "toggle",
      run(async () => {
        if (!details.open) return;
        await load();
        // Open again after a rebuild: the reader's place stays.
        if (restored.delete(details)) return;
        const selected = details.querySelector('[aria-current="page"]');
        if (details.isConnected && selected)
          selected.scrollIntoView({ block: "nearest" });
      }),
    );
    // A folder that was open comes back open and filled, so that the
    // rebuilt tree takes the old one's place in one step.
    if (open?.has(entry.path)) {
      details.open = true;
      restored.add(details);
      await load().catch(() => {});
    }
    return details;
  }
  // What a tree shows: names, order, open folders. The entries of a closed
  // folder and the current note's mark do not count.
  const shown = (el) =>
    [...el.children]
      .map((c) =>
        c.matches("input")
          ? ""
          : c.matches("details:not([open])")
            ? `[${c.className}|${c.dataset.path}|${c.firstChild?.textContent}]`
            : `<${c.tagName}|${c.className}|${c.title}|${c.dataset.path || ""}|${c.dataset.note || ""}|${c.dataset.listed || ""}|${c.children.length ? shown(c) : c.textContent}>`,
      )
      .join("");
  const restored = new WeakSet();
  async function renderTree(open = null) {
    const tree = $("#tree");
    const fragment = document.createDocumentFragment(),
      epoch = ++treeEpoch;
    const displayedRoots = browsingRoots();
    if (!displayedRoots.length) {
      const empty = document.createElement("div");
      empty.className = "empty-tree";
      empty.innerHTML = `${t("尚未添加文件夹")}<br><button>${t("打开文件夹")}</button>`;
      empty.querySelector("button").onclick = run(openFolder);
      fragment.append(empty);
    }
    for (const root of displayedRoots) {
      const el = await branch(root, open);
      el.classList.add("root");
      // A library folder takes notes and folders dropped on its name (the
      // open note's folder outside the library does not).
      if (root !== outsideFolder())
        dropZone(el.firstChild, null, { ...root, directory: true }, false);
      // The open note's folder outside the library: said so beside its name.
      if (root === outsideFolder()) {
        el.classList.add("outside");
        el.firstChild.dataset.note = t("不在笔记库中");
      }
      fragment.append(el);
      el.open = true;
    }
    if (epoch !== treeEpoch) return;
    // A refresh that found nothing new (a note was saved) leaves the tree
    // as it is: no flash, and the focus and a name being typed stay.
    if (open && shown(fragment) === shown(tree)) return;
    tree.replaceChildren(fragment);
  }
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const info = (text) => element("p", "search-info", text);
  // The words in a name, marked (case-insensitive).
  function markWords(text, terms) {
    const lower = text.toLowerCase(),
      ranges = [];
    for (const term of terms)
      for (
        let at = lower.indexOf(term);
        at !== -1;
        at = lower.indexOf(term, at + term.length)
      )
        ranges.push([at, at + term.length]);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const out = document.createDocumentFragment();
    let at = 0;
    for (const [a, b] of ranges) {
      if (a < at) continue;
      if (a > at) out.append(text.slice(at, a));
      out.append(element("mark", "", text.slice(a, b)));
      at = b;
    }
    out.append(text.slice(at));
    return out;
  }
  // One result: the note's name (words marked), how many hits, and the
  // section and line around its best hits. open(hit) opens it there.
  function resultItem({ name, path, count, hits = [] }, terms, open, typeset) {
    const item = element("div", "text-note");
    const title = element("button", "text-note-name");
    title.title = path;
    const label = element("span", "text-note-title");
    label.append(markWords(name, terms));
    title.append(label);
    if (count) title.append(element("span", "text-note-count", String(count)));
    title.onclick = run(() => open(hits[0] || null));
    item.append(title);
    for (const hit of hits) {
      const b = element("button", "text-hit");
      b.title = t("第 {line} 行", { line: hit.line });
      if (hit.section)
        b.append(element("span", "text-hit-section", hit.section));
      const line = element(
        "span",
        hit.heading ? "text-hit-line heading" : "text-hit-line",
      );
      for (const [text, mark] of hit.snippet)
        line.append(
          mark ? element("mark", "", text) : document.createTextNode(text),
        );
      // Formulas are typeset once KaTeX is loaded; until then, as written.
      if (mayContainMath(hit.snippet.map(([text]) => text).join(""))) {
        line.dataset.markdown = snippetMarkdown(hit.snippet);
        typeset.push(line);
      }
      b.append(line);
      b.onclick = run(() => open(hit));
      item.append(b);
    }
    return item;
  }
  function typesetLater(lines) {
    if (!lines.length) return;
    loadMath()
      .then(() => {
        for (const line of lines)
          if (line.isConnected)
            line.innerHTML = renderMarkdown(line.dataset.markdown).html;
      })
      .catch(() => {});
  }
  // Folders shown in the tree that the library does not cover (the open
  // note's folder elsewhere): searched by file name on disk, which is slower.
  const outsideLibrary = () =>
    browsingRoots().filter(
      (folder) => !roots.some((root) => within(folder.path, root.path)),
    );
  // One list, like a search engine's: every note once, its name and text
  // searched together, best first. Results stay until the next ones arrive.
  async function search(q, epoch) {
    const tree = $("#tree");
    const top = tree.scrollTop;
    const found =
      roots.length && api.searchText
        ? await api.searchText(q)
        : { terms: [], total: 0, results: [] };
    if (epoch !== searchEpoch) return;
    const terms = found.terms.length ? found.terms : [q.toLowerCase()];
    const list = element("div", "search-results"),
      typeset = [];
    for (const note of found.results)
      list.append(
        resultItem(
          note,
          terms,
          (hit) => openResult(note.path, hit, found.terms),
          typeset,
        ),
      );
    const fragment = document.createDocumentFragment();
    if (!roots.length)
      fragment.append(info(t("用“打开文件夹”加入笔记库后，可以搜索笔记内容")));
    fragment.append(list);
    const summary = info(
      found.total > found.results.length
        ? t("共 {count} 篇笔记，仅显示前 {shown} 篇", {
            count: found.total,
            shown: found.results.length,
          })
        : found.total
          ? t("共 {count} 篇笔记", { count: found.total })
          : t("没有匹配的笔记"),
    );
    fragment.append(summary);
    // A large library is still being read: say so; results follow.
    if (found.indexing)
      fragment.append(
        info(
          t("正在读取笔记库（已读 {count} 篇），结果会继续更新", {
            count: found.indexed,
          }),
        ),
      );
    tree.replaceChildren(fragment);
    markCurrentFile();
    if (keepScroll) tree.scrollTop = top;
    typesetLater(typeset);
    // File names in folders outside the library, appended when they come.
    const outside = outsideLibrary();
    if (!outside.length) return;
    const names = await api.search(
      outside.slice(0, 10).map((r) => r.id),
      q,
    );
    if (epoch !== searchEpoch) return;
    // A large folder is walked in the background; results follow.
    if (names.scanning)
      summary.after(
        info(
          t("仍在查找 {folder} 中的文件名，结果会继续更新", {
            folder: outside.map((r) => r.name).join(", "),
          }),
        ),
      );
    const shown = new Set(found.results.map((note) => note.path.toLowerCase()));
    let added = 0;
    for (const file of names.items) {
      if (shown.has(file.path.toLowerCase())) continue;
      list.append(
        resultItem(
          file,
          terms,
          async () => add(await api.openChild(file.parent, file.name)),
          [],
        ),
      );
      added++;
    }
    if (added)
      summary.textContent = t("共 {count} 篇笔记", {
        count: found.total + added,
      });
  }
  let keepScroll = false;
  const filterBox = $("#file-filter");
  filterBox.oninput = (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim(),
      epoch = ++searchEpoch;
    if (!q) {
      run(renderTree)();
      return;
    }
    if (!api) return;
    // The index answers from memory: results follow the typing.
    searchTimer = setTimeout(() => run(() => search(q, epoch))(), 60);
  };
  // ↓ moves into the results, ↑/↓ between them; Enter opens the first.
  const resultButtons = () => [
    ...$("#tree").querySelectorAll(".search-results button"),
  ];
  filterBox.addEventListener("keydown", (event) => {
    if (!filterBox.value.trim()) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      resultButtons()[0]?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      resultButtons()[0]?.click();
    }
  });
  $("#tree").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = resultButtons(),
      at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && at === 0) filterBox.focus();
    else
      buttons[
        Math.min(buttons.length - 1, at + (event.key === "ArrowDown" ? 1 : -1))
      ].focus();
  });
  // Ctrl+Shift+F: the search box, with a short selection as the query.
  function focusSearch(text = "") {
    filterBox.focus();
    if (text && text !== filterBox.value) {
      filterBox.value = text;
      filterBox.oninput({ target: filterBox });
    }
    filterBox.select();
  }
  // Notes changed on disk: search again, keeping the list where it was.
  function researchText() {
    const filter = $("#file-filter"),
      q = filter.value.trim();
    if (!q || !api) return;
    keepScroll = true;
    run(() => search(q, ++searchEpoch).finally(() => (keepScroll = false)))();
  }
  // A change on disk (another program added, renamed or removed notes): rebuild
  // with the same folders open and the same scroll position; a filter in use
  // is searched again instead.
  async function refresh() {
    const filter = $("#file-filter"),
      tree = $("#tree");
    if (filter.value.trim()) return filter.oninput({ target: filter });
    const open = new Set(
      [...tree.querySelectorAll("details.folder[open]")].map(
        (el) => el.dataset.path,
      ),
    );
    const top = tree.scrollTop;
    await renderTree(open);
    tree.scrollTop = top;
    markCurrentFile();
  }
  // ── The tree's own file operations (right-click, F2, Delete) ──
  // A name typed in place: in a new row at the top of a folder, or over the
  // entry being renamed. Enter or leaving the box takes it, Esc cancels.
  function askName({ place, value = "", label, selectTo = value.length }) {
    return new Promise((resolve) => {
      const input = element("input", "tree-name");
      input.value = value;
      input.setAttribute("aria-label", label);
      input.spellcheck = false;
      const restore = place(input);
      let done = false;
      const finish = (name) => {
        if (done) return;
        done = true;
        restore();
        resolve(name);
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
      // Inside a folder's name: clicks stay in the box.
      input.addEventListener("click", (event) => event.preventDefault());
      input.addEventListener("blur", () => finish(input.value.trim() || null));
      input.focus();
      input.setSelectionRange(0, selectTo);
    });
  }
  const folderOf = (el) => el.closest("details.folder");
  const parentFolderOf = (details) =>
    details.parentElement.closest("details.folder");
  const baseLength = (name) => {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? dot : name.length;
  };
  // kind: "note" | "folder"; under: a note of the folder whose child page
  // the new note becomes (the folder's index lists it under that note).
  async function create(details, kind, under = null) {
    await details.load();
    const folder = folderInfo(details);
    if (under) {
      const index = await ensureIndex(folder);
      if (!index) return;
      if (
        indexBusy(index, (name) =>
          t("{name} 有未保存的修改，请先保存，再调整目录", { name }),
        )
      )
        return;
    }
    // The parent's row, found again after an index was started.
    const parentRow = () => {
      const row = [...$("#tree").querySelectorAll("button.file")].find(
        (el) => el.title === under.path,
      );
      return row?.closest(".page") || row;
    };
    const name = await askName({
      label: under
        ? t("新子页名称")
        : kind === "folder"
          ? t("新文件夹名称")
          : t("新笔记名称"),
      place: (input) => {
        const row = element("div", "tree-new");
        row.dataset.kind = under ? "child" : kind;
        row.append(input);
        const parent = under && parentRow();
        if (parent) parent.after(row);
        else
          [...$("#tree").querySelectorAll("details.folder")]
            .find((el) => el.dataset.id === folder.id)
            ?.querySelector(":scope > summary")
            .after(row);
        return () => row.remove();
      },
    });
    if (!name) return;
    const full =
      kind === "folder" || /\.[a-z0-9]+$/i.test(name) ? name : name + ".md";
    const made = await api.createEntry(
      folder.id,
      full,
      kind,
      kind === "folder" ? "" : newNoteText(full),
      { under: under?.name ?? null, drafts: drafts() },
    );
    if (made.index?.draft) patchDrafts({ moves: [], drafts: [made.index] });
    await refresh();
    if (kind === "folder") await revealFolder(made.path);
    else openNew(made);
    if (made.index?.error) report(made.index.error);
  }
  // The rename or move last made, for its undo (the menu offers it).
  let lastMove = null;
  const refreshLastMove = () =>
    api?.lastMove?.().then(
      (value) => (lastMove = value),
      () => {},
    );
  refreshLastMove();
  // The notes whose links a rename or move changes: on disk (from main),
  // with the open drafts' own counts in their place.
  function withDrafts(affected, moves) {
    const own = draftLinks(moves);
    const keys = new Set(own.map((note) => note.path.toLowerCase()));
    return [
      ...affected.filter((note) => !keys.has(note.path.toLowerCase())),
      ...own,
    ].sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  }
  // After a rename, move or undo: drafts patched, tabs and folds follow.
  function followMoves(result, links) {
    const patched = patchDrafts({
      moves: result.moves || [],
      links,
      drafts: result.drafts || [],
    });
    renamed(result.files || []);
    const moves = result.moves || [];
    for (const page of [...closedPages]) {
      const next = movedPathOf(page, moves);
      if (next !== page) {
        closedPages.delete(page);
        closedPages.add(next);
      }
    }
    // Folders kept in the settings by path (left out of search, open to
    // AI) and library folders inside what moved follow it.
    if (moves.length) {
      const settings = getSettings();
      const patch = {};
      for (const key of ["searchExclude", "aiLibraries"]) {
        const list = settings[key];
        if (!Array.isArray(list)) continue;
        const next = list.map((p) => movedPathOf(p, moves));
        if (next.some((p, i) => p !== list[i])) patch[key] = next;
      }
      if (Object.keys(patch).length) changeSettings(patch);
      let rooted = false;
      for (const root of roots) {
        const next = movedPathOf(root.path, moves);
        if (next === root.path) continue;
        root.path = next;
        root.name = next.split(/[\\/]/).filter(Boolean).pop() || next;
        rooted = true;
      }
      if (rooted) changed();
    }
    return patched || 0;
  }
  // The toast after a rename or move, with its undo.
  function reportMove(message, result) {
    const failed = (result.failed || []).map((f) =>
      f.path ? f.path.split(/[\\/]/).pop() : f.error,
    );
    if (failed.length)
      message +=
        t("；") +
        t("{count} 个文件未能更新：{names}", {
          count: failed.length,
          names: failed.join(", "),
        });
    report(message, [t("撤销"), run(undoMove)]);
  }
  async function rename(target) {
    const isFolder = target.matches("summary");
    const details = folderOf(target);
    const folder = isFolder ? parentFolderOf(details) : details;
    const old = isFolder ? details.dataset.name : target.textContent;
    const name = await askName({
      value: old,
      selectTo: isFolder ? old.length : baseLength(old),
      label: t("新名称"),
      place: (input) => {
        if (isFolder) {
          const text = target.textContent;
          target.replaceChildren(input);
          return () => (target.textContent = text);
        }
        target.hidden = true;
        target.after(input);
        return () => {
          input.remove();
          target.hidden = false;
        };
      },
    });
    if (!name || name === old) return;
    const full = isFolder || /\.[a-z0-9]+$/i.test(name) ? name : name + ".md";
    const plan = api.planRename
      ? await api.planRename(folder.dataset.id, old, full)
      : { moves: [], affected: [] };
    const affected = withDrafts(plan.affected, plan.moves);
    let links = true;
    if (affected.length) {
      const choice = await askLinks({
        kind: "rename",
        title: t("把“{name}”改名为“{to}”", { name: old, to: full }),
        affected,
        indexing: plan.indexing,
      });
      if (!choice) return;
      links = choice.links;
    }
    const result = await api.renameEntry(folder.dataset.id, old, full, {
      links,
      drafts: drafts(),
    });
    const patched = followMoves(result, links);
    await refresh();
    await refreshLastMove();
    const count = (result.rewritten || 0) + patched;
    if (!result.moves?.length) return;
    if (links && count)
      reportMove(t("已改名，{count} 篇笔记中的链接已更新", { count }), result);
    else if (!links)
      reportMove(
        t("已重命名。{count} 篇笔记中的链接仍指向旧名称", {
          count: affected.length,
        }),
        result,
      );
    else reportMove(t("已改名为“{name}”", { name: full }), result);
  }
  // A note or folder (moved: { folder: id, folderPath, name, path,
  // directory }) moved to another folder (dest: its path; asked for when
  // not given), with its child pages if the reader keeps them along.
  async function moveEntry(moved, dest = null) {
    if (!api.planMove) return;
    if (!dest) {
      const folders = await api.libraryFolders();
      dest = await pickFolder({
        title: t("把“{name}”移动到…", { name: moved.name }),
        folders,
        exclude: (p) =>
          samePath(p, moved.folderPath) ||
          (moved.directory && within(p, moved.path)),
      });
      if (!dest) return;
    }
    const plan = await api.planMove(moved.folder, moved.name, dest);
    const to = plan.to.split(/[\\/]/).filter(Boolean).pop() || plan.to;
    const affected = withDrafts(plan.affected, plan.moves);
    const along = plan.children.length
      ? {
          children: plan.children,
          affected: withDrafts(plan.affectedWith, plan.movesWith),
        }
      : null;
    let choice = { links: true, children: false };
    if (affected.length || along || plan.childrenError) {
      choice = await askLinks({
        kind: "move",
        title: t("把“{name}”移到“{to}”", { name: moved.name, to }),
        affected,
        with: along,
        indexing: plan.indexing,
        childrenError: plan.childrenError,
      });
      if (!choice) return;
    }
    const result = await api.moveEntry(moved.folder, moved.name, dest, {
      ...choice,
      drafts: drafts(),
    });
    const patched = followMoves(result, choice.links);
    await refresh();
    await refreshLastMove();
    const count = (result.rewritten || 0) + patched;
    reportMove(
      choice.links && count
        ? t("已移到“{folder}”，{count} 篇笔记中的链接已更新", {
            folder: to,
            count,
          })
        : t("已移到“{folder}”", { folder: to }),
      result,
    );
  }
  // The row's entry as moveEntry takes it.
  function movingOf(target) {
    const isFolder = target.matches("summary");
    const details = folderOf(target);
    const folder = isFolder ? parentFolderOf(details) : details;
    return {
      folder: folder.dataset.id,
      folderPath: folder.dataset.path,
      name: isFolder ? details.dataset.name : target.textContent,
      path: isFolder ? details.dataset.path : target.title,
      directory: isFolder,
    };
  }
  // The last rename or move taken back: names, index entries and links.
  async function undoMove() {
    const result = await api.undoMove(drafts());
    // Links are written back only where the move rewrote them.
    followMoves(result, result.links !== false);
    await refresh();
    await refreshLastMove();
    const skipped = (result.skipped || []).map((p) => p.split(/[\\/]/).pop());
    report(
      skipped.length
        ? t(
            "已撤销上次改名/移动；{count} 个文件之后又有修改，未还原：{names}",
            {
              count: skipped.length,
              names: skipped.join(", "),
            },
          )
        : t("已撤销上次改名/移动"),
    );
  }
  // What the menu says undo would take back.
  function lastMoveItem() {
    const label = lastMove?.label;
    const detail = !label
      ? undefined
      : label.kind === "rename"
        ? t("“{name}”改名为“{to}”", { name: label.name, to: label.to })
        : label.kind === "repair"
          ? t("修复了“{name}”中指向“{to}”的链接", label)
          : t("“{name}”移到“{to}”", { name: label.name, to: label.to });
    return [t("撤销上次改名/移动"), run(undoMove), !lastMove, detail];
  }
  // ── Repair after changes made elsewhere (desktop/note-repair.mjs) ──
  // One link of a note (its path; href as written) whose target is gone:
  // the reader chooses, nothing is guessed. index: an index entry.
  async function repairLink(note, href, { index = false } = {}) {
    const options = await api.repairOptions(note, href);
    if (!options.missing) {
      report(t("链接的目标存在，不需要修复"));
      return;
    }
    const action = await askRepair({
      name: options.name,
      rel: href.replace(/[#?].*$/, ""),
      candidates: options.candidates,
      creatable: options.creatable,
      index,
    });
    if (!action) return;
    const result = await api.repairLink(note, href, action, drafts());
    if (result.draft) repaired(result.draft);
    else patchDrafts({ moves: [], drafts: [], reread: true });
    await refresh();
    await refreshLastMove();
    if (result.unchanged) return;
    const message =
      action.kind === "create"
        ? t("已新建“{name}”", { name: options.name })
        : action.kind === "remove"
          ? t("已移除指向“{name}”的链接", { name: options.name })
          : t("链接已改为指向“{name}”", {
              name: action.to.split(/[\\/]/).pop(),
            });
    // A draft patched in memory is undone in its editor.
    report(message, result.draft ? null : [t("撤销"), run(undoMove)]);
  }
  // The index's entries whose note is gone: one is chosen (when there are
  // several), then repaired like a link.
  async function repairIndex(details) {
    const issues = await api.indexIssues(details.dataset.id);
    if (!issues.missing?.length) {
      report(t("目录中的条目都存在"));
      return;
    }
    let entry = issues.missing[0];
    if (issues.missing.length > 1) {
      const chosen = await pickFolder({
        title: t("修复目录中不存在的条目"),
        folders: issues.missing.map((m) => ({
          path: String(m.line),
          name: m.title || m.name,
          rel: m.name,
        })),
        filterLabel: t("筛选条目"),
        emptyText: t("没有匹配的条目"),
        actionLabel: t("修复这一项"),
      });
      if (chosen === null) return;
      entry = issues.missing.find((m) => String(m.line) === chosen);
    }
    await repairLink(issues.index, entry.href, { index: true });
  }
  async function trash(target) {
    const isFolder = target.matches("summary");
    const details = folderOf(target);
    const folder = isFolder ? parentFolderOf(details) : details;
    const name = isFolder ? details.dataset.name : target.textContent;
    const at = isFolder ? details.dataset.path : target.title;
    const unsaved = unsavedUnder(at);
    if (unsaved.length) {
      report(t("{name} 有未保存的修改，请先保存或关闭", { name: unsaved[0] }));
      return;
    }
    const question = isFolder
      ? t("把文件夹“{name}”及其中的全部内容移到回收站？", { name })
      : t("把“{name}”移到回收站？", { name });
    if (!window.confirm(question)) return;
    const result = await api.trashEntry(folder.dataset.id, name, drafts());
    if (result.index?.draft) patchDrafts({ moves: [], drafts: [result.index] });
    trashed(result.path);
    await refresh();
  }
  async function moveRoot(details, step) {
    const at = roots.findIndex((root) => root.id === details.dataset.id);
    const to = at + step;
    if (at < 0 || to < 0 || to >= roots.length) return;
    [roots[at], roots[to]] = [roots[to], roots[at]];
    await refresh();
    changed();
  }
  async function removeRoot(details) {
    const at = roots.findIndex((root) => root.id === details.dataset.id);
    if (at < 0) return;
    roots.splice(at, 1);
    await refresh();
    changed();
  }
  function exclusionItem(path) {
    const list = getSettings().searchExclude || [];
    const own = list.some((p) => samePath(p, path));
    if (own)
      return [
        t("恢复参与搜索和反向链接"),
        () =>
          changeSettings({
            searchExclude: list.filter((p) => !samePath(p, path)),
          }),
      ];
    if (excludedBy(list)(path))
      return [t("上级文件夹已不参与搜索"), () => {}, true];
    return [
      t("不参与搜索和反向链接"),
      () => changeSettings({ searchExclude: [...list, path] }),
    ];
  }
  // The right-click menu for an entry of the tree, or null.
  function menuFor(el) {
    const file = el.closest("#tree button.file");
    if (file) {
      const folder = folderOf(file);
      // The index file itself has no child pages and does not move.
      const own = folder && file.dataset.indexName;
      return [
        [t("打开"), () => file.click()],
        [t("复制链接"), () => copyLink(file.title)],
        null,
        [
          t("新建子页"),
          run(() =>
            create(folder, "note", {
              name: file.dataset.indexName,
              path: file.title,
            }),
          ),
          !own,
        ],
        [t("重命名…"), run(() => rename(file)), !folder],
        [t("移动到…"), run(() => moveEntry(movingOf(file))), !own],
        // The folder's index: its entries whose note is gone.
        ...(folder && file.dataset.indexFile !== undefined
          ? [
              [
                t("修复不存在的条目…"),
                run(() => repairIndex(folder)),
                !file.dataset.missing,
              ],
            ]
          : []),
        [
          t("在资源管理器中显示"),
          run(() => api.revealEntry(folder.dataset.id, file.textContent)),
          !folder,
        ],
        null,
        lastMoveItem(),
        null,
        [t("移到回收站"), run(() => trash(file)), !folder],
      ];
    }
    const summary = el.closest("#tree details.folder > summary");
    if (!summary) return null;
    const details = summary.parentElement;
    const own = [
      [t("新建笔记"), run(() => create(details, "note"))],
      [t("新建文件夹"), run(() => create(details, "folder"))],
      null,
    ];
    const reveal = [
      t("在资源管理器中显示"),
      run(() => api.revealEntry(details.dataset.id)),
    ];
    if (details.classList.contains("outside"))
      return [
        ...own,
        reveal,
        [t("加入笔记库"), run(() => addRoot(outsideFolder()))],
      ];
    if (details.classList.contains("root")) {
      const at = roots.findIndex((root) => root.id === details.dataset.id);
      return [
        ...own,
        reveal,
        null,
        [t("上移"), run(() => moveRoot(details, -1)), at <= 0],
        [t("下移"), run(() => moveRoot(details, 1)), at >= roots.length - 1],
        [
          t("移出笔记库"),
          run(() => removeRoot(details)),
          false,
          t("只是不再列出，文件不会删除"),
        ],
        null,
        lastMoveItem(),
      ];
    }
    return [
      ...own,
      [t("重命名…"), run(() => rename(summary))],
      [t("移动到…"), run(() => moveEntry(movingOf(summary)))],
      reveal,
      exclusionItem(details.dataset.path),
      null,
      lastMoveItem(),
      null,
      [t("移到回收站"), run(() => trash(summary))],
    ];
  }
  // F2 renames the entry in focus, Delete moves it to the Recycle Bin.
  $("#tree").addEventListener("keydown", (event) => {
    if (event.key !== "F2" && event.key !== "Delete") return;
    const target = event.target.closest?.(
      "#tree button.file, #tree details.folder > summary",
    );
    if (!target) return;
    // A library folder itself is neither renamed nor deleted here.
    if (
      target.matches("summary")
        ? folderOf(target).classList.contains("root")
        : !folderOf(target)
    )
      return;
    event.preventDefault();
    run(() => (event.key === "F2" ? rename(target) : trash(target)))();
  });
  $("#tree-refresh").onclick = run(async () => {
    $("#file-filter").value = "";
    searchEpoch++;
    await renderTree();
  });
  return {
    openFolder,
    renderTree,
    followCurrentFolder,
    refresh,
    focusSearch,
    researchText,
    showExcluded,
    menuFor,
    repairLink,
    revealPath,
  };
}
