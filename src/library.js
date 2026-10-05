import { t } from "../desktop/i18n.mjs";
import { MATH } from "../desktop/note-search.mjs";
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
}) {
  const $ = (s) => document.querySelector(s);
  let currentFolder = null;
  let folderEpoch = 0;
  let treeEpoch = 0;
  let searchTimer,
    searchEpoch = 0;
  async function openFolder() {
    if (!api) return report(t("请运行桌面版以访问文件夹"));
    const root = await api.pickFolder(getActive()?.fileId || null);
    if (root && !roots.some((r) => r.path === root.path)) {
      roots.push(root);
      await renderTree();
      changed();
    }
  }
  function browsingRoots() {
    return currentFolder
      ? [currentFolder, ...roots.filter((r) => r.path !== currentFolder.path)]
      : roots;
  }
  function markCurrentFile() {
    for (const button of $("#tree").querySelectorAll(".file")) {
      if (button.title === getActive()?.path)
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
    if (currentFolder?.path !== folder.path || $("#file-filter").value) {
      currentFolder = folder;
      $("#file-filter").value = "";
      ++searchEpoch;
      clearTimeout(searchTimer);
      await renderTree();
    }
    const currentBranch = [...$("#tree").children].find(
      (el) => el.dataset.path === folder.path,
    );
    if (currentBranch) currentBranch.open = true;
    markCurrentFile();
    $("#tree")
      .querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }
  // open: folder paths to reopen, so a rebuild keeps what the reader expanded.
  async function branch(entry, open = null) {
    const details = document.createElement("details");
    details.className = "folder";
    details.dataset.path = entry.path;
    const summary = document.createElement("summary");
    summary.textContent = entry.name;
    summary.title = entry.path;
    details.append(summary);
    let loaded = false;
    details.addEventListener(
      "toggle",
      run(async () => {
        if (!details.open || loaded) return;
        loaded = true;
        try {
          for (const child of await api.list(entry.id)) {
            if (child.directory) details.append(await branch(child, open));
            else {
              const b = document.createElement("button");
              b.className = "file";
              b.textContent = child.name;
              b.title = child.path;
              b.onclick = run(async () =>
                add(await api.openChild(entry.id, child.name)),
              );
              details.append(b);
            }
          }
          markCurrentFile();
          const selected = details.querySelector('[aria-current="page"]');
          if (details.isConnected && selected)
            selected.scrollIntoView({ block: "nearest" });
        } catch (e) {
          loaded = false;
          throw e;
        }
      }),
    );
    if (open?.has(entry.path)) details.open = true;
    return details;
  }
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
      fragment.append(el);
      el.open = true;
    }
    if (epoch === treeEpoch) tree.replaceChildren(fragment);
  }
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const info = (text) => element("p", "search-info", text);
  // Matches by file name, as before: the folders shown in the tree.
  function fileResults(result) {
    const group = document.createDocumentFragment();
    for (const file of result.items) {
      const b = element("button", "file", file.name);
      b.title = file.path;
      b.onclick = run(async () =>
        add(await api.openChild(file.parent, file.name)),
      );
      group.append(b);
    }
    group.append(
      info(
        result.items.length
          ? result.truncated
            ? t("结果较多，仅显示前 200 项")
            : t("共 {count} 项", { count: result.items.length })
          : t("没有匹配的文件名"),
      ),
    );
    return group;
  }
  // Matches in the notes' text (the library folders), grouped by note: the
  // section and the line around each hit, the words marked.
  function textResults(found) {
    const list = element("div", "text-results"),
      typeset = [];
    for (const note of found.results) {
      const item = element("div", "text-note");
      const name = element("button", "text-note-name");
      name.title = note.path;
      name.append(element("span", "text-note-title", note.name));
      if (note.count)
        name.append(element("span", "text-note-count", String(note.count)));
      name.onclick = run(() =>
        openResult(note.path, note.hits[0] || null, found.terms),
      );
      item.append(name);
      for (const hit of note.hits) {
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
        const source = hit.snippet.map(([text]) => text).join("");
        if (mayContainMath(source)) {
          line.dataset.markdown = snippetMarkdown(hit.snippet);
          typeset.push(line);
        }
        b.append(line);
        b.onclick = run(() => openResult(note.path, hit, found.terms));
        item.append(b);
      }
      list.append(item);
    }
    if (typeset.length)
      loadMath()
        .then(() => {
          for (const line of typeset)
            if (line.isConnected)
              line.innerHTML = renderMarkdown(line.dataset.markdown).html;
        })
        .catch(() => {});
    const group = document.createDocumentFragment();
    group.append(list);
    group.append(
      info(
        !found.total
          ? t("没有内容匹配的笔记")
          : found.total > found.results.length
            ? t("共 {count} 篇笔记，仅显示前 {shown} 篇", {
                count: found.total,
                shown: found.results.length,
              })
            : t("共 {count} 篇笔记", { count: found.total }),
      ),
    );
    return group;
  }
  async function search(q, epoch) {
    const tree = $("#tree");
    const top = tree.scrollTop;
    const [names, found] = await Promise.all([
      browsingRoots().length
        ? api.search(
            browsingRoots()
              .slice(0, 10)
              .map((r) => r.id),
            q,
          )
        : null,
      roots.length && api.searchText ? api.searchText(q) : null,
    ]);
    if (epoch !== searchEpoch) return;
    const fragment = document.createDocumentFragment();
    fragment.append(element("p", "search-group", t("文件名")));
    fragment.append(names ? fileResults(names) : info(t("没有匹配的文件名")));
    fragment.append(element("p", "search-group", t("内容")));
    fragment.append(
      found
        ? textResults(found)
        : info(t("用“打开文件夹”加入笔记库后，可以搜索笔记内容")),
    );
    tree.replaceChildren(fragment);
    if (keepScroll) tree.scrollTop = top;
  }
  let keepScroll = false;
  $("#file-filter").oninput = (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim(),
      epoch = ++searchEpoch;
    if (!q) {
      run(renderTree)();
      return;
    }
    if (!api) return;
    searchTimer = setTimeout(() => run(() => search(q, epoch))(), 250);
  };
  // Ctrl+Shift+F: the search box, with a short selection as the query.
  function focusSearch(text = "") {
    const filter = $("#file-filter");
    filter.focus();
    if (text && text !== filter.value) {
      filter.value = text;
      filter.oninput({ target: filter });
    }
    filter.select();
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
    // Reopened folders load their entries a moment later.
    setTimeout(() => (tree.scrollTop = top), 150);
  }
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
  };
}
