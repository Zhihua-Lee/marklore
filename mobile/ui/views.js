import { displayNoteTitle, folderOf } from "./paths.js";
import { loadIndexContext, renderIndexView } from "./index-view.js";
import { formatRelativeSync, formatSyncProgress, STRINGS } from "./strings.js";

// A search snippet as plain text: link text without its target, no heading,
// list, quote or task markers, no emphasis marks or formula dollars.
export function plainSnippet(line) {
  const inner = (_, text) => text;
  return String(line)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, inner)
    .replace(/\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, inner)
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/, "")
    .replace(/\*\*|__|\*|~~|`/g, "")
    .replace(/\$\$?([^$]*)\$\$?/g, inner)
    .trim();
}

function renderHighlightedText(container, text, query) {
  const words = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (words.length === 0) {
    container.textContent = text;
    return;
  }
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = String(text || "").split(regex);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 1) {
      const mark = document.createElement("mark");
      mark.className = "mobile-search-mark";
      mark.textContent = part;
      container.append(mark);
    } else {
      container.append(document.createTextNode(part));
    }
  }
}

function createSyncButton(text, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mobile-btn-secondary mobile-sync-btn";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * Renders onboarding states: unconfigured client ID, signed out, or folder picker.
 */
export function renderAccountScreen(
  container,
  {
    status,
    account,
    progress,
    pickingFolder,
    folderStack,
    onCancelPick,
    onToast,
    onChooseFolderDone,
  },
) {
  container.replaceChildren();
  const wrap = document.createElement("main");
  wrap.className = "mobile-onboard";

  const brand = document.createElement("h1");
  brand.className = "mobile-brand";
  brand.textContent = STRINGS.appName;
  wrap.append(brand);

  if (!status.configured) {
    const lead = document.createElement("p");
    lead.className = "mobile-onboard-lead";
    lead.textContent = STRINGS.unconfiguredHint;
    const form = document.createElement("form");
    form.className = "mobile-onboard-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mobile-input";
    input.placeholder = STRINGS.clientIdPlaceholder;
    input.setAttribute("aria-label", STRINGS.clientIdLabel);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "mobile-btn-primary";
    submit.textContent = STRINGS.clientIdSave;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const val = input.value.trim();
      if (!val) {
        onToast(STRINGS.clientIdRequired);
        input.focus();
        return;
      }
      account.setClientId(val);
    });
    form.append(input, submit);
    wrap.append(lead, form);
    container.append(wrap);
    return;
  }

  if (!status.signedIn) {
    const signBtn = document.createElement("button");
    signBtn.type = "button";
    signBtn.className = "mobile-btn-primary mobile-signin-btn";
    signBtn.textContent = STRINGS.signedOutAction;
    signBtn.addEventListener("click", () => account.signIn());

    const privacy = document.createElement("p");
    privacy.className = "mobile-onboard-note";
    privacy.textContent = STRINGS.privacyNote;

    const editDetails = document.createElement("details");
    editDetails.className = "mobile-onboard-disclosure";
    const summary = document.createElement("summary");
    summary.textContent = STRINGS.editClientId;
    const form = document.createElement("form");
    form.className = "mobile-onboard-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mobile-input";
    input.placeholder = STRINGS.clientIdPlaceholder;
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "mobile-btn-secondary";
    save.textContent = STRINGS.clientIdUpdate;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const val = input.value.trim();
      if (!val) {
        onToast(STRINGS.clientIdRequired);
        return;
      }
      account.setClientId(val);
      onToast(STRINGS.clientIdSaved);
    });
    form.append(input, save);
    editDetails.append(summary, form);

    wrap.append(signBtn, privacy, editDetails);
    container.append(wrap);
    return;
  }

  // Signed in: show folder picker or active initial sync progress.
  const heading = document.createElement("h2");
  heading.className = "mobile-picker-title";
  heading.textContent = STRINGS.chooseFolderTitle;
  wrap.append(heading);

  if (status.syncing && !pickingFolder) {
    const progressCard = document.createElement("div");
    progressCard.className = "mobile-sync-card";
    const text = document.createElement("p");
    text.className = "mobile-sync-card-text";
    text.dataset.role = "sync-progress";
    text.textContent = formatSyncProgress(progress);
    progressCard.append(text);
    if (progress?.phase === "error") {
      progressCard.append(
        createSyncButton(STRINGS.retry, () => account.sync()),
      );
    }
    wrap.append(progressCard);
    container.append(wrap);
    return;
  }

  const hint = document.createElement("p");
  hint.className = "mobile-picker-hint";
  hint.textContent = STRINGS.chooseFolderHint;
  wrap.append(hint);

  const breadcrumbs = document.createElement("nav");
  breadcrumbs.className = "mobile-breadcrumbs";
  breadcrumbs.setAttribute("aria-label", STRINGS.chooseFolderTitle);

  const listWrap = document.createElement("div");
  listWrap.className = "mobile-folder-picker-list";

  const footer = document.createElement("div");
  footer.className = "mobile-picker-footer";
  const chooseBtn = document.createElement("button");
  chooseBtn.type = "button";
  chooseBtn.className = "mobile-btn-primary";
  chooseBtn.textContent = STRINGS.chooseCurrentFolder;

  const currentFolder = () => folderStack.at(-1) || null;

  async function loadLevel() {
    breadcrumbs.replaceChildren();
    const rootCrumb = document.createElement("button");
    rootCrumb.type = "button";
    rootCrumb.className = "mobile-crumb-btn";
    rootCrumb.textContent = STRINGS.breadcrumbRoot;
    rootCrumb.disabled = folderStack.length === 0;
    rootCrumb.addEventListener("click", () => {
      folderStack.length = 0;
      void loadLevel();
    });
    breadcrumbs.append(rootCrumb);

    folderStack.forEach((folder, idx) => {
      const sep = document.createElement("span");
      sep.className = "mobile-crumb-sep";
      sep.textContent = "/";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mobile-crumb-btn";
      btn.textContent = folder.name;
      btn.disabled = idx === folderStack.length - 1;
      btn.addEventListener("click", () => {
        folderStack.length = idx + 1;
        void loadLevel();
      });
      breadcrumbs.append(sep, btn);
    });

    const active = currentFolder();
    chooseBtn.disabled = !active;
    listWrap.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mobile-picker-status";
    loading.textContent = STRINGS.loadingFolders;
    listWrap.append(loading);

    try {
      const items = await account.folders(active ? active.id : null);
      if (!listWrap.isConnected) return;
      listWrap.replaceChildren();
      if (!items || items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "mobile-picker-status";
        empty.textContent = STRINGS.emptySubfolders;
        listWrap.append(empty);
        return;
      }
      for (const folder of items) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "mobile-picker-row";
        const name = document.createElement("span");
        name.className = "mobile-picker-row-name";
        name.textContent = folder.name;
        const chev = document.createElement("span");
        chev.className = "mobile-picker-row-chev";
        chev.setAttribute("aria-hidden", "true");
        chev.textContent = "›";
        row.append(name, chev);
        row.addEventListener("click", () => {
          folderStack.push(folder);
          void loadLevel();
        });
        listWrap.append(row);
      }
    } catch {
      if (!listWrap.isConnected) return;
      listWrap.replaceChildren();
      const err = document.createElement("p");
      err.className = "mobile-picker-status is-error";
      err.textContent = STRINGS.loadFoldersError;
      listWrap.append(err);
    }
  }

  chooseBtn.addEventListener("click", async () => {
    const selected = currentFolder();
    if (!selected) return;
    chooseBtn.disabled = true;
    await onChooseFolderDone(selected);
  });

  footer.append(chooseBtn);
  if (onCancelPick) {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "mobile-btn-secondary";
    cancelBtn.textContent = STRINGS.cancel;
    cancelBtn.addEventListener("click", onCancelPick);
    footer.append(cancelBtn);
  }

  wrap.append(breadcrumbs, listWrap, footer);
  container.append(wrap);
  void loadLevel();
}

/**
 * Renders Home: brand bar + Settings button, Search, Recent, the folder index, and Sync footer.
 */
export async function renderHomeScreen(
  container,
  {
    library,
    account,
    status,
    progress,
    searchQuery,
    onSearchChange,
    onOpenNote,
    onOpenSettings,
  },
) {
  const [info, entries, recentPaths, indexContext] = await Promise.all([
    library.info(),
    library.list(),
    library.state.get("recent", []),
    loadIndexContext(library),
  ]);
  if (!container.isConnected) return;

  const entryMap = new Map(entries.map((e) => [e.path, e]));
  const shell = document.createElement("div");
  shell.className = "mobile-home";

  // Header
  const header = document.createElement("header");
  header.className = "mobile-home-header";
  const brand = document.createElement("h1");
  brand.className = "mobile-home-brand";
  brand.textContent = STRINGS.appName;
  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "mobile-icon-btn";
  settingsBtn.setAttribute("aria-label", STRINGS.settings);
  settingsBtn.textContent = STRINGS.settings;
  settingsBtn.addEventListener("click", onOpenSettings);
  header.append(brand, settingsBtn);

  // Search box
  const searchWrap = document.createElement("div");
  searchWrap.className = "mobile-search-box";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "mobile-search-input";
  searchInput.placeholder = STRINGS.searchPlaceholder;
  searchInput.setAttribute("aria-label", STRINGS.searchPlaceholder);
  searchInput.value = searchQuery;

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "mobile-search-clear";
  clearBtn.setAttribute("aria-label", STRINGS.clearSearch);
  clearBtn.textContent = "×";
  clearBtn.hidden = !searchQuery;

  searchWrap.append(searchInput, clearBtn);

  // Main browse/search container
  const contentArea = document.createElement("main");
  contentArea.className = "mobile-home-body";

  const renderBrowseContent = () => {
    contentArea.replaceChildren();
    const validRecent = (Array.isArray(recentPaths) ? recentPaths : [])
      .map((p) => entryMap.get(p))
      .filter(Boolean)
      .slice(0, 8);

    // Recent pages: one short row of chips above the table of contents.
    if (validRecent.length > 0) {
      const sec = document.createElement("section");
      sec.className = "mobile-home-section mobile-recent";
      sec.setAttribute("aria-label", STRINGS.recent);
      const h = document.createElement("h2");
      h.className = "mobile-recent-label";
      h.textContent = STRINGS.recent;
      const list = document.createElement("div");
      list.className = "mobile-recent-list";
      for (const entry of validRecent) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "mobile-recent-chip";
        chip.dataset.recentPath = entry.path;
        chip.textContent = displayNoteTitle(entry);
        chip.title = entry.path;
        chip.addEventListener("click", () => onOpenNote(entry.path));
        list.append(chip);
      }
      sec.append(h, list);
      contentArea.append(sec);
    }

    // The chosen folder's table of contents, as the desktop shows a
    // library's index.
    const indexSec = document.createElement("section");
    indexSec.className = "mobile-home-section mobile-home-index";
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "mobile-home-empty";
      empty.textContent = STRINGS.emptyLibrary;
      indexSec.append(empty);
    } else {
      indexSec.append(renderIndexView(indexContext, "", { onOpenNote }));
    }
    contentArea.append(indexSec);
  };

  let searchTimer = null;
  let searchSeq = 0;

  const runSearch = async (rawQuery) => {
    const q = rawQuery.trim();
    clearBtn.hidden = !rawQuery;
    onSearchChange(rawQuery);
    if (!q) {
      renderBrowseContent();
      return;
    }
    const seq = ++searchSeq;
    const results = await library.search(q, { limit: 50 });
    if (seq !== searchSeq || !contentArea.isConnected) return;

    contentArea.replaceChildren();
    const list = document.createElement("div");
    list.className = "mobile-search-results";
    if (!results || results.length === 0) {
      const empty = document.createElement("p");
      empty.className = "mobile-home-empty";
      empty.textContent = STRINGS.searchEmpty;
      list.append(empty);
      contentArea.append(list);
      return;
    }

    for (const hit of results) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mobile-search-item";
      btn.dataset.searchPath = hit.path;

      const title = document.createElement("div");
      title.className = "mobile-search-title";
      title.textContent = hit.title;
      btn.append(title);

      const dir = folderOf(hit.path);
      if (dir) {
        const sub = document.createElement("div");
        sub.className = "mobile-search-path";
        sub.textContent = dir;
        btn.append(sub);
      }

      if (hit.snippet) {
        const snip = document.createElement("div");
        snip.className = "mobile-search-snippet";
        renderHighlightedText(snip, plainSnippet(hit.snippet), q);
        btn.append(snip);
      }

      btn.addEventListener("click", () =>
        onOpenNote(hit.path, { line: hit.line }),
      );
      list.append(btn);
    }
    contentArea.append(list);
  };

  searchInput.addEventListener("input", () => {
    const val = searchInput.value;
    clearBtn.hidden = !val;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void runSearch(val);
    }, 150);
  });

  clearBtn.addEventListener("click", () => {
    clearTimeout(searchTimer);
    searchInput.value = "";
    void runSearch("");
    searchInput.focus();
  });

  // Status / Sync Footer
  const footer = document.createElement("footer");
  footer.className = "mobile-status-footer";
  const statusInfo = document.createElement("div");
  statusInfo.className = "mobile-status-text";

  const statsParts = [];
  if (info?.folderName) statsParts.push(info.folderName);
  if (info?.notes != null) statsParts.push(STRINGS.notesCount(info.notes));
  if (status.syncing) {
    statsParts.push(formatSyncProgress(progress));
  } else if (progress?.phase === "error") {
    statsParts.push(formatSyncProgress(progress));
  } else if (info?.lastSync) {
    statsParts.push(formatRelativeSync(info.lastSync));
  }
  statusInfo.textContent = statsParts.join(" · ");
  if (progress?.phase === "error") statusInfo.classList.add("is-error");

  // Signed out (or the day-long sign-in expired): the button signs in first.
  const needsSignIn = !status.signedIn || !status.configured;
  const syncBtn = createSyncButton(
    needsSignIn
      ? STRINGS.signInToSync
      : progress?.phase === "error" && !status.syncing
        ? STRINGS.retry
        : status.syncing
          ? STRINGS.syncing
          : STRINGS.sync,
    () =>
      needsSignIn
        ? status.configured
          ? account.signIn()
          : onOpenSettings()
        : account.sync(),
  );
  syncBtn.disabled = Boolean(status.syncing);
  footer.append(statusInfo, syncBtn);

  shell.append(header, searchWrap, contentArea, footer);
  container.replaceChildren(shell);

  if (searchQuery.trim()) {
    void runSearch(searchQuery);
  } else {
    renderBrowseContent();
  }
}
