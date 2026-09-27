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
    if (!api) return report("请运行桌面版以访问文件夹");
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
  async function branch(entry) {
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
            if (child.directory) details.append(await branch(child));
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
    return details;
  }
  async function renderTree() {
    const tree = $("#tree");
    const fragment = document.createDocumentFragment(),
      epoch = ++treeEpoch;
    const displayedRoots = browsingRoots();
    if (!displayedRoots.length) {
      const empty = document.createElement("div");
      empty.className = "empty-tree";
      empty.innerHTML = "尚未添加文件夹<br><button>打开文件夹</button>";
      empty.querySelector("button").onclick = run(openFolder);
      fragment.append(empty);
    }
    for (const root of displayedRoots) {
      const el = await branch(root);
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
              ? "结果较多，仅显示前 200 项"
              : "共 " + result.items.length + " 项"
            : "没有匹配的笔记";
          tree.append(info);
        })(),
      250,
    );
  };
  $("#tree-refresh").onclick = run(async () => {
    $("#file-filter").value = "";
    searchEpoch++;
    await renderTree();
  });
  return { openFolder, renderTree, followCurrentFolder };
}
