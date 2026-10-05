import { t } from "../desktop/i18n.mjs";
import { MATH } from "../desktop/snippet.mjs";
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
    if (currentFolder?.path !== folder.path) {
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
  const within = (p, folder) => {
    const a = p.toLowerCase().replace(/[\\/]+$/, ""),
      b = folder.toLowerCase().replace(/[\\/]+$/, "");
    return a === b || a.startsWith(b + "\\") || a.startsWith(b + "/");
  };
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
    if (epoch !== searchEpoch || !names.items.length) return;
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
