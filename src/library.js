import { t } from "../desktop/i18n.mjs";
// Folder browser: lazily loaded tree, current-folder following and search.
export function createLibrary({
  api,
  roots,
  getActive,
  getSettings,
  add,
  run,
  report,
  changed,
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
  $("#file-filter").oninput = (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim(),
      epoch = ++searchEpoch;
    if (!q) {
      run(renderTree)();
      return;
    }
    if (!api || !browsingRoots().length) return;
    searchTimer = setTimeout(
      () =>
        run(async () => {
          const result = await api.search(
            browsingRoots()
              .slice(0, 10)
              .map((r) => r.id),
            q,
          );
          if (epoch !== searchEpoch) return;
          const tree = $("#tree");
          tree.replaceChildren();
          for (const file of result.items) {
            const b = document.createElement("button");
            b.className = "file";
            b.textContent = file.name;
            b.title = file.path;
            b.onclick = run(async () =>
              add(await api.openChild(file.parent, file.name)),
            );
            tree.append(b);
          }
          const info = document.createElement("p");
          info.className = "search-info";
          info.textContent = result.items.length
            ? result.truncated
              ? t("结果较多，仅显示前 200 项")
              : t("共 {count} 项", { count: result.items.length })
            : t("没有匹配的笔记");
          tree.append(info);
        })(),
      250,
    );
  };
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
  return { openFolder, renderTree, followCurrentFolder, refresh };
}
