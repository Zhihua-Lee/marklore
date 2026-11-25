import "./reader.css";
import {
  applySettings,
  createWakeLockController,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "./prefs.js";
import { noteHashForPath, parseNoteHash } from "./paths.js";
import {
  renderNoteContent,
  scrollToAnchor,
  scrollToSourceLine,
} from "./note-view.js";
import { openOutlineSheet, openSettingsSheet } from "./sheets.js";
import { renderAccountScreen, renderHomeScreen } from "./views.js";
import { formatSyncProgress, STRINGS } from "./strings.js";

/**
 * Mounts the read-only iPhone Marklore interface into `root`.
 */
export function mountReader(root, { library, account }) {
  let settings = { ...DEFAULT_SETTINGS };
  let status = account.status();
  let progress = null;
  let searchQuery = "";
  let pickingFolder = false;
  const folderStack = [];

  let activeScreen = "loading"; // "account" | "home" | "note"
  let currentNotePath = null;
  let currentHeadings = [];
  let noteRenderToken = 0;
  let closeActiveSheet = null;
  let homeStale = false;
  let toastTimer = null;
  let lastPersistTimer = null;
  let pendingScrollSave = null;
  let topBarCleanup = null;

  const wakeLock = createWakeLockController();
  const scrollByHistoryKey = new Map();
  let currentEntryKey = String(Date.now());

  const viewHost = document.createElement("div");
  viewHost.className = "mobile-root";
  const toastEl = document.createElement("div");
  toastEl.className = "mobile-toast";
  toastEl.setAttribute("role", "status");
  toastEl.hidden = true;
  root.replaceChildren(viewHost, toastEl);

  function showToast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2200);
  }

  function syncWakeLock() {
    wakeLock.setState({
      keepAwake: settings.keepAwake,
      inNote: activeScreen === "note",
    });
  }

  function saveCurrentEntryScroll() {
    const scroll = Math.round(window.scrollY || 0);
    scrollByHistoryKey.set(currentEntryKey, scroll);
    const curState = window.history.state;
    if (curState && typeof curState === "object") {
      try {
        window.history.replaceState({ ...curState, scroll }, "");
      } catch {
        // Ignore history restrictions in synthetic contexts.
      }
    }
    return scroll;
  }

  async function persistLast(path, scroll) {
    if (!path) return;
    await library.state.set("last", { path, scroll: Math.round(scroll || 0) });
  }

  function scheduleLastPersist(path) {
    pendingScrollSave = { path, scroll: window.scrollY || 0 };
    if (lastPersistTimer) return;
    lastPersistTimer = setTimeout(() => {
      lastPersistTimer = null;
      const latest = pendingScrollSave;
      pendingScrollSave = null;
      if (
        latest &&
        activeScreen === "note" &&
        currentNotePath === latest.path
      ) {
        void persistLast(latest.path, latest.scroll);
      }
    }, 250);
  }

  function flushPendingLast() {
    if (lastPersistTimer) {
      clearTimeout(lastPersistTimer);
      lastPersistTimer = null;
    }
    if (pendingScrollSave && currentNotePath === pendingScrollSave.path) {
      const { path, scroll } = pendingScrollSave;
      pendingScrollSave = null;
      void persistLast(path, scroll);
    } else if (activeScreen === "note" && currentNotePath) {
      void persistLast(currentNotePath, window.scrollY || 0);
    }
  }

  async function pushRecent(path) {
    const existing = await library.state.get("recent", []);
    const list = Array.isArray(existing) ? existing : [];
    const next = [path, ...list.filter((item) => item !== path)].slice(0, 8);
    await library.state.set("recent", next);
  }

  function tearDownNoteScroll() {
    if (topBarCleanup) {
      topBarCleanup();
      topBarCleanup = null;
    }
  }

  function wireNoteScroll(topBarEl) {
    tearDownNoteScroll();
    let lastY = window.scrollY || 0;
    const onScroll = () => {
      const y = Math.max(0, window.scrollY || 0);
      if (activeScreen === "note" && currentNotePath) {
        scheduleLastPersist(currentNotePath);
      }
      const delta = y - lastY;
      if (y <= 48) {
        topBarEl.classList.remove("is-hidden");
        lastY = y;
        return;
      }
      if (delta > 10) {
        topBarEl.classList.add("is-hidden");
        lastY = y;
      } else if (delta < -6) {
        topBarEl.classList.remove("is-hidden");
        lastY = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    topBarCleanup = () => window.removeEventListener("scroll", onScroll);
  }

  function updateDocumentView(viewName, title = STRINGS.appName) {
    document.body.dataset.view = viewName;
    document.title = title ? `${title} · ${STRINGS.appName}` : STRINGS.appName;
  }

  function showAccountView(libraryInfo) {
    tearDownNoteScroll();
    closeActiveSheet?.();
    activeScreen = "account";
    currentNotePath = null;
    updateDocumentView("account", STRINGS.appName);
    syncWakeLock();

    renderAccountScreen(viewHost, {
      status,
      account,
      progress,
      pickingFolder,
      folderStack,
      onCancelPick: libraryInfo
        ? () => {
            pickingFolder = false;
            folderStack.length = 0;
            void goHome({ pushHistory: false });
          }
        : null,
      onToast: showToast,
      onChooseFolderDone: async (selectedFolder) => {
        pickingFolder = false;
        folderStack.length = 0;
        await account.chooseFolder(selectedFolder);
        await routeAfterSync();
      },
    });
  }

  async function showHomeView() {
    tearDownNoteScroll();
    closeActiveSheet?.();
    activeScreen = "home";
    currentNotePath = null;
    updateDocumentView("home", STRINGS.appName);
    syncWakeLock();

    await renderHomeScreen(viewHost, {
      library,
      account,
      status,
      progress,
      searchQuery,
      onSearchChange: (q) => {
        searchQuery = q;
      },
      onOpenNote: (path, options = {}) =>
        openNote(path, { ...options, historyMode: "push" }),
      onOpenSettings: () => {
        closeActiveSheet = openSettingsSheet({
          settings,
          status,
          wakeLockSupported: wakeLock.supported,
          onUpdateSettings: async (patch) => {
            settings = normalizeSettings({ ...settings, ...patch });
            applySettings(settings);
            syncWakeLock();
            await library.state.set("settings", settings);
          },
          onChangeFolder: () => {
            pickingFolder = true;
            folderStack.length = 0;
            void renderCurrentOnboardingOrHome();
          },
          onSignOut: () => {
            pickingFolder = false;
            folderStack.length = 0;
            account.signOut();
          },
          onSetClientId: (id) => account.setClientId(id),
          onSetOfflineImages: account.setOfflineImages
            ? (on) => void account.setOfflineImages(on)
            : null,
          onToast: showToast,
          onClose: () => {
            closeActiveSheet = null;
            if (homeStale && activeScreen === "home") {
              homeStale = false;
              void showHomeView();
            }
          },
        });
      },
    });
  }

  async function goHome({ pushHistory = true } = {}) {
    flushPendingLast();
    if (activeScreen === "note" || activeScreen === "home") {
      saveCurrentEntryScroll();
    }
    if (pushHistory) {
      currentEntryKey = `home:${Date.now()}:${Math.random()}`;
      window.history.pushState(
        { key: currentEntryKey, screen: "home", scroll: 0 },
        "",
        "#/",
      );
    } else {
      window.history.replaceState(
        {
          key: currentEntryKey,
          screen: "home",
          scroll: window.history.state?.scroll ?? 0,
        },
        "",
        "#/",
      );
    }
    await showHomeView();
    const restoreScroll = Number(window.history.state?.scroll ?? 0);
    requestAnimationFrame(() =>
      window.scrollTo({ top: restoreScroll, behavior: "auto" }),
    );
  }

  async function openNote(
    path,
    {
      scroll = 0,
      line = null,
      anchor = "",
      historyMode = "push",
      recordRecent = true,
    } = {},
  ) {
    const token = ++noteRenderToken;
    const text = await library.text(path);
    if (token !== noteRenderToken) return false;
    if (text === null) {
      showToast(STRINGS.noteMissingToast);
      return false;
    }

    if (activeScreen === "note" && currentNotePath) {
      flushPendingLast();
      saveCurrentEntryScroll();
    } else if (activeScreen === "home") {
      saveCurrentEntryScroll();
    }

    const entriesPromise = library.list();
    const prose = document.createElement("article");
    prose.className = "prose";

    const rendered = await renderNoteContent(prose, {
      path,
      text,
      library,
      onNavigateNote: (nextPath, nextAnchor) =>
        openNote(nextPath, { anchor: nextAnchor, historyMode: "push" }),
      onAnchor: (targetAnchor, host) => scrollToAnchor(host, targetAnchor),
      onToast: showToast,
    });
    if (token !== noteRenderToken) return false;

    const entries = await entriesPromise;
    if (token !== noteRenderToken) return false;
    const matched = entries.find((e) => e.path === path);
    const title =
      matched?.title ||
      path
        .split("/")
        .pop()
        ?.replace(/\.(?:md|markdown|mdown|mkd)$/i, "") ||
      path;

    if (historyMode === "push") {
      currentEntryKey = `note:${Date.now()}:${Math.random()}`;
      window.history.pushState(
        { key: currentEntryKey, screen: "note", path, scroll },
        "",
        noteHashForPath(path),
      );
    } else if (historyMode === "replace") {
      window.history.replaceState(
        { key: currentEntryKey, screen: "note", path, scroll },
        "",
        noteHashForPath(path),
      );
    } else if (historyMode === "none" && window.history.state?.key) {
      currentEntryKey = window.history.state.key;
    }

    tearDownNoteScroll();
    closeActiveSheet?.();
    activeScreen = "note";
    currentNotePath = path;
    currentHeadings = rendered.headings;
    updateDocumentView("note", title);
    syncWakeLock();

    const shell = document.createElement("div");
    shell.className = "mobile-note-shell";

    const topBar = document.createElement("header");
    topBar.className = "mobile-topbar";

    const homeBtn = document.createElement("button");
    homeBtn.type = "button";
    homeBtn.className = "mobile-topbar-btn";
    homeBtn.setAttribute("aria-label", STRINGS.backToHomeAria);
    homeBtn.textContent = `‹ ${STRINGS.homeLabel}`;
    homeBtn.addEventListener("click", () => {
      void goHome({ pushHistory: true });
    });

    const titleEl = document.createElement("h1");
    titleEl.className = "mobile-topbar-title";
    titleEl.textContent = title;

    const outlineBtn = document.createElement("button");
    outlineBtn.type = "button";
    outlineBtn.className = "mobile-topbar-btn";
    outlineBtn.textContent = STRINGS.outline;
    outlineBtn.addEventListener("click", () => {
      topBar.classList.remove("is-hidden");
      closeActiveSheet = openOutlineSheet({
        headings: currentHeadings,
        onSelect: (heading) => {
          topBar.classList.remove("is-hidden");
          scrollToAnchor(prose, heading.id);
        },
        onClose: () => {
          closeActiveSheet = null;
        },
      });
    });

    topBar.append(homeBtn, titleEl, outlineBtn);
    shell.append(topBar, prose);
    viewHost.replaceChildren(shell);
    wireNoteScroll(topBar);

    const applyTargetScroll = () => {
      if (anchor) {
        scrollToAnchor(prose, anchor);
      } else if (Number.isFinite(line) && line !== null) {
        scrollToSourceLine(prose, text, line);
      } else {
        window.scrollTo({
          top: Math.max(0, Number(scroll || 0)),
          behavior: "auto",
        });
      }
    };
    applyTargetScroll();
    if (
      anchor ||
      (Number.isFinite(line) && line !== null) ||
      Number(scroll || 0) > 0
    ) {
      requestAnimationFrame(() => {
        if (token === noteRenderToken) applyTargetScroll();
      });
    }

    if (recordRecent) void pushRecent(path);
    await persistLast(path, scroll);
    return true;
  }

  // Notes on the phone are readable without the account (sign-in lasts about
  // a day; it is needed only to sync). The account screens show when nothing
  // has been synced yet, or while choosing another folder.
  function needsAccountScreen(info) {
    return pickingFolder || !info;
  }

  async function renderCurrentOnboardingOrHome() {
    const info = await library.info();
    if (needsAccountScreen(info)) {
      showAccountView(info);
      return;
    }
    await showHomeView();
  }

  async function routeAfterSync() {
    const info = await library.info();
    if (needsAccountScreen(info)) {
      showAccountView(info);
      return;
    }
    await goHome({ pushHistory: false });
  }

  async function init() {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    settings = normalizeSettings(
      await library.state.get("settings", DEFAULT_SETTINGS),
    );
    applySettings(settings);

    const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    schemeQuery.addEventListener?.("change", () => {
      if (settings.theme === "system") applySettings(settings);
    });

    const info = await library.info();
    if (needsAccountScreen(info)) {
      showAccountView(info);
      return;
    }

    const hashPath = parseNoteHash(window.location.hash);
    if (hashPath) {
      const last = await library.state.get("last", null);
      const savedScroll = Number(
        window.history.state?.scroll ??
          (last?.path === hashPath ? last.scroll : 0),
      );
      const ok = await openNote(hashPath, {
        scroll: savedScroll,
        historyMode: "replace",
      });
      if (ok) return;
    }

    if (window.location.hash === "#/") {
      await goHome({ pushHistory: false });
      return;
    }

    const last = await library.state.get("last", null);
    if (last?.path) {
      const ok = await openNote(last.path, {
        scroll: Number(last.scroll || 0),
        historyMode: "replace",
      });
      if (ok) return;
    }

    await goHome({ pushHistory: false });
  }

  const unsubStatus = account.onStatus(async (nextStatus) => {
    const prevFolderId = status.folder?.id ?? null;
    status = nextStatus;
    const info = await library.info();

    if (needsAccountScreen(info)) {
      showAccountView(info);
      return;
    }

    if (
      activeScreen === "account" &&
      prevFolderId === status.folder?.id &&
      info
    ) {
      await goHome({ pushHistory: false });
      return;
    }

    if (activeScreen === "home") {
      // Settings open over home (a switch there changed the status): redraw
      // home when the sheet closes, not under the owner's finger.
      if (closeActiveSheet) homeStale = true;
      else await showHomeView();
    }
  });

  const unsubProgress = account.onProgress((nextProgress) => {
    progress = nextProgress;
    if (activeScreen === "home") {
      const footer = viewHost.querySelector(".mobile-status-footer");
      const statusText = footer?.querySelector(".mobile-status-text");
      const syncBtn = footer?.querySelector(".mobile-sync-btn");
      if (statusText && syncBtn) {
        if (nextProgress.phase === "error") {
          statusText.textContent = formatSyncProgress(nextProgress);
          statusText.classList.add("is-error");
          syncBtn.textContent = STRINGS.retry;
          syncBtn.disabled = false;
        } else if (nextProgress.phase !== "done") {
          statusText.textContent = formatSyncProgress(nextProgress);
          statusText.classList.remove("is-error");
          syncBtn.textContent = STRINGS.syncing;
          syncBtn.disabled = true;
        }
      }
    } else if (activeScreen === "account") {
      const card = viewHost.querySelector('[data-role="sync-progress"]');
      if (card) {
        card.textContent = formatSyncProgress(nextProgress);
        if (nextProgress.phase === "error") {
          void renderCurrentOnboardingOrHome();
        }
      }
    }
  });

  const unsubChange = library.onChange(async () => {
    const info = await library.info();
    if (needsAccountScreen(info)) {
      showAccountView(info);
      return;
    }
    if (activeScreen === "account") {
      await goHome({ pushHistory: false });
      return;
    }
    if (activeScreen === "home") {
      await showHomeView();
      return;
    }
    if (activeScreen === "note" && currentNotePath) {
      const savedScroll = window.scrollY || 0;
      const ok = await openNote(currentNotePath, {
        scroll: savedScroll,
        historyMode: "none",
        recordRecent: false,
      });
      if (!ok) {
        await goHome({ pushHistory: true });
      }
    }
  });

  const onPopState = async (event) => {
    const state = event.state;
    const hashPath = parseNoteHash(window.location.hash);
    if (state?.screen === "note" && state.path) {
      const scroll = Number(
        scrollByHistoryKey.get(state.key) ?? state.scroll ?? 0,
      );
      await openNote(state.path, {
        scroll,
        historyMode: "none",
        recordRecent: false,
      });
      return;
    }
    if (hashPath) {
      const key = state?.key;
      const scroll = Number(
        (key && scrollByHistoryKey.get(key)) ?? state?.scroll ?? 0,
      );
      await openNote(hashPath, {
        scroll,
        historyMode: "none",
        recordRecent: false,
      });
      return;
    }
    flushPendingLast();
    const scroll = Number(
      (state?.key && scrollByHistoryKey.get(state.key)) ?? state?.scroll ?? 0,
    );
    await showHomeView();
    requestAnimationFrame(() =>
      window.scrollTo({ top: scroll, behavior: "auto" }),
    );
  };

  const onPageHide = () => flushPendingLast();
  const onVisibilityHide = () => {
    if (document.visibilityState === "hidden") flushPendingLast();
  };

  window.addEventListener("popstate", onPopState);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityHide);

  void init();

  return {
    destroy() {
      unsubStatus();
      unsubProgress();
      unsubChange();
      tearDownNoteScroll();
      wakeLock.destroy();
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityHide);
      closeActiveSheet?.();
      clearTimeout(toastTimer);
      clearTimeout(lastPersistTimer);
    },
  };
}
