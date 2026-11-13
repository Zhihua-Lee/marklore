import { t } from "../desktop/i18n.mjs";
import { MATH } from "../desktop/snippet.mjs";
import { excludedBy } from "../desktop/excluded.mjs";
import { renderMarkdown, loadMath, mayContainMath } from "./markdown.js";
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
  // A note or folder went to the Recycle Bin: close its tabs.
  trashed = () => {},
  copyLink = () => {},
  changeSettings = () => {},
  // A note just created in the tree: open it for writing.
  openNew = (doc) => add(doc),
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
  // another showing as its sub-item (depth); dragging rewrites the index.
  async function fillFolder(details, entry, children, open) {
    const indexFile = children.find((child) => child.index);
    const stack = [{ depth: -1, box: details }];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const depth = child.listed ? child.depth : 0;
      while (stack.length > 1 && stack.at(-1).depth >= depth) stack.pop();
      const box = stack.at(-1).box;
      if (child.directory) {
        const folder = await branch(child, open);
        if (indexFile) draggable(folder.firstChild, entry, child, indexFile);
        box.append(folder);
        continue;
      }
      const b = document.createElement("button");
      b.className = "file";
      b.textContent = child.name;
      b.title = child.path;
      b.onclick = run(async () =>
        add(await api.openChild(entry.id, child.name)),
      );
      if (indexFile) draggable(b, entry, child, indexFile);
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
  // Dragging in a folder with an index file: a drop before, after or (on a
  // note) into a listed entry moves the dragged one there in the index.
  const DRAG_TYPE = "application/x-marklore-tree";
  let dragging = null;
  const placeOf = (event, target, child) => {
    const box = target.getBoundingClientRect();
    const y = (event.clientY - box.top) / box.height;
    if (child.directory) return y < 0.5 ? "before" : "after";
    return y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
  };
  const clearDrop = () => {
    for (const el of $("#tree").querySelectorAll(".drop-target")) {
      el.classList.remove("drop-target");
      delete el.dataset.drop;
    }
  };
  function draggable(target, entry, child, indexFile) {
    if (child.index) {
      target.dataset.indexFile = "";
      return;
    }
    target.dataset.indexName = child.name;
    target.dataset.listed = String(Boolean(child.listed));
    target.draggable = true;
    target.addEventListener("dragstart", (event) => {
      dragging = { folder: entry.id, name: child.name };
      event.dataTransfer.setData(DRAG_TYPE, child.name);
      event.dataTransfer.effectAllowed = "move";
    });
    target.addEventListener("dragend", () => {
      dragging = null;
      clearDrop();
    });
    if (!child.listed) return;
    const accepts = () =>
      dragging?.folder === entry.id && dragging.name !== child.name;
    target.addEventListener("dragover", (event) => {
      if (!accepts()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const place = placeOf(event, target, child);
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
      if (!accepts()) return;
      event.preventDefault();
      const name = dragging.name;
      const place = placeOf(event, target, child);
      dragging = null;
      clearDrop();
      run(() => reorder(entry, indexFile, name, child.name, place))();
    });
  }
  async function reorder(entry, indexFile, name, target, place) {
    // An index open with unsaved changes is not rewritten under them.
    if (isUnsaved(indexFile.path)) {
      report(
        t("{name} 有未保存的修改，请先保存，再在文件树中拖动排序", {
          name: indexFile.name,
        }),
      );
      return;
    }
    if (!api.reorderIndex) return;
    await api.reorderIndex(entry.id, { name, target, place });
    await refresh();
  }
  // Alt+↑/↓ on a listed entry: the same move by keyboard, past the entry
  // before or after it at its level.
  $("#tree").addEventListener("keydown", (event) => {
    if (!event.altKey || !/^Arrow(Up|Down)$/.test(event.key)) return;
    const item = event.target.closest?.("[data-index-name]");
    if (!item) return;
    const own =
      item.matches("summary") || item.parentElement.matches(".page-row")
        ? item.parentElement.closest("details, .page")
        : item;
    const level = [...own.parentElement.children]
      .map((el) =>
        el.matches(".page")
          ? el.querySelector(".file")
          : el.matches("details")
            ? el.firstChild
            : el,
      )
      .filter((el) => el?.dataset.listed === "true");
    const at = level.indexOf(item);
    const up = event.key === "ArrowUp";
    const other = level[at + (up ? -1 : 1)];
    if (at < 0 || !other) return;
    event.preventDefault();
    const folder = own.parentElement.closest("details.folder");
    const indexFile = folder.querySelector(":scope > [data-index-file]");
    run(async () => {
      await reorder(
        { id: folder.dataset.id },
        { path: indexFile.title, name: indexFile.textContent },
        item.dataset.indexName,
        other.dataset.indexName,
        up ? "before" : "after",
      );
      // The rebuilt folders load their entries a moment later.
      for (let i = 0; i < 40; i++) {
        const again = [
          ...$("#tree").querySelectorAll("[data-index-name]"),
        ].find((el) => el.title === item.title);
        if (again) return again.focus();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
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
  async function create(details, kind) {
    await details.load();
    const name = await askName({
      label: kind === "folder" ? t("新文件夹名称") : t("新笔记名称"),
      place: (input) => {
        const row = element("div", "tree-new");
        row.dataset.kind = kind;
        row.append(input);
        details.querySelector(":scope > summary").after(row);
        return () => row.remove();
      },
    });
    if (!name) return;
    const full =
      kind === "folder" || /\.[a-z0-9]+$/i.test(name) ? name : name + ".md";
    const made = await api.createEntry(details.dataset.id, full, kind);
    await refresh();
    if (kind === "folder") await revealFolder(made.path);
    else openNew(made);
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
    const result = await api.renameEntry(folder.dataset.id, old, full);
    renamed(result.files);
    await refresh();
    if (result.links)
      report(
        t("已重命名。{count} 篇笔记中的链接仍指向旧名称", {
          count: result.links,
        }),
      );
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
    const result = await api.trashEntry(folder.dataset.id, name);
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
      return [
        [t("打开"), () => file.click()],
        [t("复制链接"), () => copyLink(file.title)],
        null,
        [t("重命名…"), run(() => rename(file)), !folder],
        [
          t("在资源管理器中显示"),
          run(() => api.revealEntry(folder.dataset.id, file.textContent)),
          !folder,
        ],
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
      ];
    }
    return [
      ...own,
      [t("重命名…"), run(() => rename(summary))],
      reveal,
      exclusionItem(details.dataset.path),
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
  };
}
