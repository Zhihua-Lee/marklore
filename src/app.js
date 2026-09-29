import { createNavigationHistory } from "./navigation-history.js";
import { createTabBar } from "./tab-bar.js";
import { insertDerivedTab } from "./tab-groups.js";
import { watchTableLayout } from "./table-layout.js";
import { defaultSettings, normalizeSettings } from "./settings.js";
import { createLibrary } from "./library.js";
import { wireSplitPane } from "./split-pane.js";
import { createDocumentSync } from "./document-sync.js";
import { createMenus } from "./menus.js";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  openSearchPanel,
  setSearchQuery,
  SearchQuery,
} from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import {
  renderMarkdown,
  parseHeadings,
  renderHeadingLabel,
  loadMath,
  mathReady,
  mayContainMath,
} from "./markdown.js";
import { onHighlighterReady, mayContainCode } from "./highlighting.js";
import {
  atPoint,
  visibleAnchor,
  restoreAnchor,
  navigateToAnchor,
  findPosition,
  unfold,
  selectionSource,
  constrainWordSelection,
} from "./positions.js";
import { icon } from "./icons.js";
import { setSectionCollapsed } from "./sections.js";
import {
  appearanceMarkup,
  applyAppearance,
  wireAppearance,
} from "./appearance.js";
import { createPreviewCache } from "./render-cache.js";
import { renderDiagrams } from "./diagrams.js";
import { createLinkPreview, splitLink } from "./link-preview.js";
import { wireDesktopSettings } from "./desktop-settings.js";
import { wireCodeBlocks } from "./code-blocks.js";
import { wireFileDrop } from "./file-drop.js";
import { wireEditing, editingHighlight } from "./editing.js";
import { createBlockEditor } from "./block-editing.js";
import { createSelectionTools } from "./selection-tools.js";
import { createImageInsertion } from "./image-insertion.js";
import { wireImageErrors } from "./image-errors.js";
import {
  configureColorTools,
  refreshColorButtons,
  closeColorPicker,
} from "./color-picker.js";
import "./tables.css";
import "./find-bar.css";
import { createFindBar } from "./find-bar.js";
import { wireSourceCopy } from "./copy-source.js";
import folioLogo from "./folio.svg?raw";
import "@fontsource-variable/literata/standard.css";
import "@fontsource-variable/literata/standard-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import "./style.css";
import "./diagrams.css";
import "./layout.css";
import "./code-blocks.css";

const $ = (s) => document.querySelector(s);
const api = window.folio;
const tabs = [],
  roots = [];
let active = null,
  lastScrollAt = 0,
  selectionTools,
  view,
  switching = false,
  renderingTimer,
  sessionTimer,
  maxSessionTimer,
  toastTimer,
  restoring = false;
let settings = defaultSettings(),
  currentAnchor = null;
const previewCache = createPreviewCache();
const readingHistory = createNavigationHistory();
let replayingHistory = false,
  pendingLocation = null,
  locationVersion = 0;
configureColorTools(
  () => settings,
  (patch) => {
    Object.assign(settings, patch);
    scheduleSession();
  },
);
let editingKeys = [];
let blockEditor, imageInsertion;
$("#app").innerHTML = `
<header class="topbar"><div id="panel-controls-left" class="panel-controls"><button id="sidebar-toggle" class="icon" title="切换文件夹浏览" aria-label="切换文件夹浏览">${icon("folder")}</button></div><button id="app-menu-toggle" class="icon brand-menu" title="Folio Notes 菜单" aria-label="应用菜单" aria-haspopup="menu" aria-expanded="false">${icon("eye")}</button><button id="tabs-back" class="icon tab-nav" aria-label="向左浏览标签">${icon("chevronLeft")}</button><div id="tabs" role="tablist" aria-label="打开的笔记"></div><button id="tabs-forward" class="icon tab-nav" aria-label="向右浏览标签">${icon("chevronRight")}</button><button id="new" class="icon" aria-label="新笔记" title="新笔记 Ctrl+N">${icon("plus")}</button><div id="panel-controls-right" class="panel-controls"><button id="outline-toggle" class="icon" title="切换本文目录" aria-label="切换本文目录">${icon("outline")}</button></div></header>
<div class="workspace"><aside id="sidebar" class="dock" aria-label="左侧栏"><section id="library-panel" class="side-panel"><div class="sidebar-top"><span class="eyebrow">笔记库</span><span><button id="tree-refresh" class="icon" aria-label="刷新文件树" title="刷新文件树">${icon("refresh")}</button><button id="folder" class="icon" aria-label="打开文件夹" title="打开文件夹">${icon("plus")}</button></span></div><input id="file-filter" type="search" placeholder="搜索笔记…" aria-label="筛选文件" title="搜索文件名，包含子文件夹"><div id="tree"><div class="empty-tree">尚未添加文件夹<br><button id="folder-empty">打开文件夹</button></div></div></section><section id="outline-panel" class="side-panel"><div class="sidebar-top"><span class="eyebrow">本文目录</span></div><nav id="outline" aria-label="本文目录"></nav></section></aside>
<main><div class="toolbar"><div class="toolbar-group document-tools" role="group" aria-label="文件操作"><button id="open" class="icon" aria-label="打开文件" title="打开文件 Ctrl+O">${icon("open")}</button><button id="save" class="icon" aria-label="保存" title="保存 Ctrl+S">${icon("save")}</button></div><div class="modes" role="group" aria-label="查看模式"><button data-mode="read">阅读</button><button data-mode="edit">编辑</button><button data-mode="source">源码</button></div><div class="toolbar-group reading-tools" role="group" aria-label="阅读设置"><button id="width-toggle" class="icon" aria-label="切换阅读宽度" title="切换阅读宽度" aria-pressed="false">${icon("width")}</button><button id="weight" class="icon" title="外观与布局" aria-label="外观与布局">Aa</button></div></div>
<section id="home" aria-labelledby="home-title" hidden><div class="start-page"><div class="start-brand">${folioLogo}<h1 id="home-title">Folio Notes</h1></div><p>打开一篇笔记，或选择一个文件夹。</p><div class="start-actions"><button id="start-open">${icon("open")}<span>打开文件</span><kbd>Ctrl O</kbd></button><button id="start-folder">${icon("folder")}<span>打开文件夹</span><kbd>Ctrl Shift O</kbd></button><button id="start-new">${icon("plus")}<span>新建笔记</span><kbd>Ctrl N</kbd></button></div><section class="start-recent" aria-labelledby="recent-title" hidden><div class="start-recent-head"><h2 id="recent-title">最近打开</h2><button id="recent-clear" type="button">清除记录</button></div><ul id="recent-list"></ul></section></div></section>
<div id="conflict" role="alert" hidden></div><div id="panes" data-mode="read"><div id="editor-pane"><div class="pane-caption">MARKDOWN <span id="editor-position"></span></div><div id="editor"></div></div><div id="split" role="separator" aria-label="调整编辑预览比例" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50" tabindex="0"></div><div id="reader" tabindex="0" aria-label="笔记预览"><article id="content" class="prose"></article></div></div>
<span id="status" class="sr-only" role="status"></span></main><aside id="right-sidebar" class="dock" aria-label="右侧栏"></aside></div>
<div id="toast" role="status" hidden></div><div id="context" class="context" role="menu" hidden></div>
<div id="app-menu" class="context app-menu" role="menu" aria-label="应用菜单" hidden></div>${appearanceMarkup}
<dialog id="confirm"><form method="dialog"><h2 id="confirm-title"></h2><p id="confirm-detail"></p><div class="dialog-actions"><button value="cancel">取消</button><button value="discard">放弃修改</button><button value="save" class="primary">保存</button></div></form></dialog>`;

// Keep document controls beside the tabs instead of consuming a second row.
$(".topbar").insertBefore($(".toolbar"), $("#panel-controls-right"));
$(".topbar").insertBefore($(".document-tools"), $("#tabs-back"));
// File actions, tabs and reading actions form three compact groups.
$(".document-tools").append($("#app-menu-toggle"));
$("#app-menu-toggle").innerHTML = icon("export");
$("#app-menu-toggle").title = "导出";
$("#app-menu-toggle").setAttribute("aria-label", "导出");
$("#app-menu").setAttribute("aria-label", "导出");
const tabStrip = document.createElement("div");
tabStrip.className = "tab-strip";
$(".topbar").insertBefore(tabStrip, $("#tabs-back"));
tabStrip.append($("#tabs-back"), $("#tabs"), $("#tabs-forward"), $("#new"));
for (const side of ["left", "right"])
  $("main").prepend($("#panel-controls-" + side));
$(".reading-tools").insertBefore($("#theme"), $("#weight"));

const historyControls = document.createElement("div");
historyControls.className = "history-controls";
historyControls.setAttribute("role", "group");
historyControls.setAttribute("aria-label", "阅读历史");
historyControls.innerHTML = `<button id="history-back" class="icon" aria-label="后退" title="后退 · Alt+←">${icon("chevronLeft")}</button><button id="history-forward" class="icon" aria-label="前进" title="前进 · Alt+→">${icon("chevronRight")}</button>`;
$(".topbar").insertBefore(historyControls, $(".document-tools"));
// Desktop (Windows): compact window controls drawn by the page, set apart at
// the toolbar's right end. main.mjs removes the system title bar.
const windowControls = document.createElement("div");
windowControls.className = "window-controls";
windowControls.setAttribute("role", "group");
windowControls.setAttribute("aria-label", "窗口");
windowControls.hidden = true;
windowControls.innerHTML = ["fullScreen", "minimize", "maximize", "close"]
  .map(
    (action) =>
      `<button class="window-button" data-window="${action}"></button>`,
  )
  .join("");
windowControls.addEventListener("click", (event) => {
  const action = event.target.closest("[data-window]")?.dataset.window;
  if (action) api.windowAction(action).catch(() => {});
});
$(".topbar").append(windowControls);
function showWindowState({ fullScreen, maximized, own } = {}) {
  if (own !== undefined) windowControls.hidden = !own;
  const labels = {
    fullScreen: fullScreen ? ["退出全屏", "F11"] : ["全屏", "F11"],
    minimize: ["最小化"],
    maximize: maximized ? ["还原"] : ["最大化"],
    close: ["关闭"],
  };
  const icons = {
    fullScreen: fullScreen ? "exitFullScreen" : "fullScreen",
    minimize: "minimize",
    maximize: maximized ? "restore" : "maximize",
    close: "close",
  };
  for (const button of windowControls.children) {
    const action = button.dataset.window,
      [label, key] = labels[action];
    button.innerHTML = icon(icons[action]);
    button.title = key ? label + " " + key : label;
    button.setAttribute("aria-label", label);
  }
  windowControls
    .querySelector("[data-window=fullScreen]")
    .setAttribute("aria-pressed", String(Boolean(fullScreen)));
  document.documentElement.dataset.fullScreen = String(Boolean(fullScreen));
}
showWindowState();
const tabBar = createTabBar({
  tabs,
  groups: () => settings.tabGroups,
  active: () => active,
  activate: activateTab,
  close: closeTab,
  dirty,
  changed: scheduleSession,
  report: (error) => toast(error.message || String(error)),
  context: (event, actions, doc) =>
    actions ? showContext(event, actions) : contextMenu(event, doc),
});
const scheduleTableLayout = watchTableLayout($("#content"), $("#reader"));
wireSourceCopy({
  host: $("#content"),
  source: () => active?.previewText,
  skip: () => !active || blockEditor?.active,
});
const findBar = createFindBar({
  panes: $("#panes"),
  content: $("#content"),
  reader: $("#reader"),
  // Regex, case, whole-word and replace live in the editor's search panel.
  openInSource: (query) => {
    if (!active) return;
    if (active.mode === "read") setMode("edit");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        openSearchPanel(view);
        if (query)
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: query })),
          });
      }),
    );
  },
});

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5000);
}
function run(fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((e) =>
        toast(
          (e.message || String(e)).replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            "",
          ),
        ),
      );
}
function dirty(doc) {
  return doc.text !== doc.base;
}
function docFrom(file = {}) {
  return {
    id: crypto.randomUUID(),
    fileId: file.id || null,
    path: file.path || null,
    name: file.name || "未命名.md",
    text: file.text || "",
    base: file.text || "",
    version: file.version || null,
    mode: "read",
    pane: "preview",
    anchor: { from: 0, top: true },
    folds: [],
    details: [],
    state: null,
    html: null,
    htmlText: null,
    conflict: null,
    epoch: 0,
    checking: false,
  };
}
function add(file, { activate = true, opener = null } = {}) {
  const existing =
    file?.id && tabs.find((t) => t.fileId === file.id || t.path === file.path);
  if (existing) {
    if (activate) activateTab(existing);
    return existing;
  }
  if (tabs.length >= 100) {
    toast("最多同时打开 100 个标签页，请先关闭一些笔记。");
    return null;
  }
  const doc = docFrom(file);
  insertDerivedTab(tabs, settings.tabGroups, doc, opener);
  if (activate) activateTab(doc);
  return doc;
}
function stateFor(doc) {
  return EditorState.create({
    doc: doc.text,
    extensions: [
      basicSetup,
      editingHighlight,
      editingKeys,
      markdown(),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            run(save)();
            return true;
          },
        },
        {
          key: "Mod-Shift-s",
          run: () => {
            run(() => save(true))();
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (!active || switching) return;
        if (update.docChanged) {
          selectionTools?.hide();
          readingHistory.map(active.id, update.changes);
          blockEditor?.sourceChanged();
          active.text = update.state.doc.toString();
          active.state = update.state;
          active.epoch++;
          active.htmlText = null;
          updateTabs();
          updateStatus();
          scheduleSession();
          clearTimeout(renderingTimer);
          const refreshEditedPreview = () => {
            if (
              (active?.text.length > 80000 || active?.formulaCount > 200) &&
              performance.now() - lastScrollAt < 140
            ) {
              renderingTimer = setTimeout(refreshEditedPreview, 150);
              return;
            }
            if (active?.mode === "source") {
              active.headings = parseHeadings(active.text);
              updateOutline(active.headings);
            } else render(true);
          };
          renderingTimer = setTimeout(
            refreshEditedPreview,
            active.text.length > 80000 || active.formulaCount > 200 ? 320 : 160,
          );
        }
        if (update.selectionSet) updateStatus();
      }),
      EditorView.domEventHandlers({
        wheel: () => {
          if (active) active.pane = "editor";
          currentAnchor = null;
        },
        mousedown: () => {
          if (active) active.pane = "editor";
        },
        keydown: () => {
          if (active) active.pane = "editor";
          currentAnchor = null;
        },
        dblclick: () => {
          requestAnimationFrame(sourceToPreview);
        },
      }),
    ],
  });
}
// Programmatic state swaps must not look like user edits to the update listener.
function setEditorState(state) {
  switching = true;
  view.setState(state);
  switching = false;
}
view = new EditorView({ state: stateFor(docFrom()), parent: $("#editor") });
editingKeys = wireEditing({
  view,
  getDocument: () => active,
  insertImage: () => imageInsertion.pick(),
});
blockEditor = createBlockEditor({
  content: $("#content"),
  reader: $("#reader"),
  sourceView: view,
  getDocument: () => active,
  report: toast,
  insertImage: () => imageInsertion.pick(),
  onFinish: (anchor) => {
    clearTimeout(renderingTimer);
    render(false);
    navigateToAnchor($("#reader"), anchor, { expand: true });
    if (active) {
      active.anchor = anchor;
      active.pane = "preview";
    }
    scheduleSession();
  },
});
imageInsertion = createImageInsertion({
  view,
  getDocument: () => active,
  getBlockEditor: () => blockEditor,
  api,
  report: toast,
});
selectionTools = createSelectionTools({
  content: $("#content"),
  reader: $("#reader"),
  view,
  getDocument: () => active,
  blocked: () => blockEditor.active,
  report: toast,
  render: () => {
    clearTimeout(renderingTimer);
    render(true);
  },
});
function editorAnchor() {
  if (view.scrollDOM.scrollTop < 2) return { from: 0, top: true };
  const r = view.contentDOM.getBoundingClientRect(),
    host = view.scrollDOM.getBoundingClientRect();
  const pos = view.posAtCoords(
    { x: Math.max(host.left + 48, r.left + 6), y: host.top + 32 },
    false,
  );
  return {
    from: pos ?? view.lineBlockAtHeight(view.scrollDOM.scrollTop + 32).from,
    y: 32,
  };
}
function capture() {
  if (!active) return;
  active.state = view.state;
  active.anchor =
    blockEditor?.anchor() ||
    (active.mode === "source" ||
    (active.mode === "edit" && active.pane === "editor")
      ? editorAnchor()
      : visibleAnchor($("#reader")));
  active.folds = [
    ...$("#content").querySelectorAll(".note-section.collapsed"),
  ].map((el) => el.dataset.foldKey);
  active.details = [...$("#content").querySelectorAll("details")]
    .map((el, i) => (el.open ? i : -1))
    .filter((i) => i >= 0);
}
function restore(
  doc,
  anchor = doc.anchor,
  { expand = false, select = false, behavior = "instant" } = {},
) {
  if (doc !== active) return;
  restoring = true;
  currentAnchor = { id: doc.id, anchor };
  if (doc.mode !== "source")
    navigateToAnchor($("#reader"), anchor, { expand, behavior });
  if (doc.mode !== "read") {
    const from = Math.min(anchor.from || 0, view.state.doc.length);
    view.dispatch({
      ...(select ? { selection: { anchor: from } } : {}),
      effects: EditorView.scrollIntoView(from, {
        y: "start",
        yMargin: anchor.top ? 0 : 32,
      }),
    });
  }
  requestAnimationFrame(() => {
    restoring = false;
    updateStatus();
  });
}
function navigationSnapshot() {
  if (!active) return null;
  if (pendingLocation?.id === active.id)
    return { id: active.id, anchor: { ...pendingLocation.anchor } };
  capture();
  return { id: active.id, anchor: { ...active.anchor } };
}
function restoreSoon(doc, anchor, options = {}) {
  const version = ++locationVersion;
  doc.anchor = { ...anchor };
  pendingLocation = { id: doc.id, anchor: { ...anchor } };
  requestAnimationFrame(() => {
    if (active !== doc || version !== locationVersion) return;
    pendingLocation = null;
    restore(doc, anchor, options);
  });
}
function updateHistoryButtons() {
  historyControls.hidden = !settings.showHistoryButtons;
  for (const [id, direction] of [
    ["history-back", -1],
    ["history-forward", 1],
  ])
    $("#" + id).disabled =
      !active ||
      !readingHistory.can(
        direction,
        active.id,
        settings.navigationScope === "current",
      );
}
function travelHistory(direction) {
  if (!active || $("dialog[open]")) return;
  closeColorPicker();
  blockEditor?.finish();
  const destination = readingHistory.go(
    direction,
    navigationSnapshot(),
    settings.navigationScope === "current",
  );
  if (!destination) return;
  const doc = tabs.find((t) => t.id === destination.id);
  if (!doc) return;
  replayingHistory = true;
  try {
    tabBar.reveal(doc);
    activateTab(doc);
    updateTabs();
    restoreSoon(
      doc,
      {
        ...destination.anchor,
        from: Math.min(destination.anchor.from || 0, doc.text.length),
      },
      { expand: true },
    );
  } finally {
    replayingHistory = false;
  }
  updateHistoryButtons();
  scheduleSession();
}
$("#history-back").onclick = () => travelHistory(-1);
$("#history-forward").onclick = () => travelHistory(1);
let lastNavigationInput = null;
function hardwareNavigation(direction, source) {
  const now = performance.now();
  // Some drivers deliver both an OS browser command and a mouse button event.
  if (
    lastNavigationInput?.direction === direction &&
    lastNavigationInput.source !== source &&
    now - lastNavigationInput.time < 150
  )
    return;
  lastNavigationInput = { direction, source, time: now };
  travelHistory(direction);
}
for (const name of ["mousedown", "mouseup", "auxclick"])
  document.addEventListener(
    name,
    (event) => {
      if (![3, 4].includes(event.button)) return;
      event.preventDefault();
      event.stopPropagation();
      if (name === "mouseup")
        hardwareNavigation(event.button === 3 ? -1 : 1, "mouse");
    },
    true,
  );
document.addEventListener(
  "keydown",
  (event) => {
    const direction =
      event.key === "BrowserBack" || (event.altKey && event.key === "ArrowLeft")
        ? -1
        : event.key === "BrowserForward" ||
            (event.altKey && event.key === "ArrowRight")
          ? 1
          : 0;
    if (
      !direction ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      $("dialog[open]")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key.startsWith("Browser")) hardwareNavigation(direction, "key");
    else travelHistory(direction);
  },
  true,
);

function activateTab(doc, { revealGroup = true } = {}) {
  if (active === doc) {
    if (revealGroup) {
      tabBar.reveal(doc);
      updateTabs();
      scheduleSession();
    }
    return;
  }
  selectionTools?.hide();
  closeColorPicker();
  blockEditor?.finish();
  linkPreview.hide();
  clearTimeout(renderingTimer);
  const origin = navigationSnapshot();
  active = doc;
  if (revealGroup) tabBar.reveal(doc);
  $("main").dataset.empty = "false";
  $("#home").hidden = true;
  setEditorState(doc.state || stateFor(doc));
  $("#panes").dataset.mode = doc.mode;
  render(false);
  updateTabs();
  updateModes();
  showConflict();
  restoreSoon(doc, doc.anchor);
  if (!replayingHistory)
    readingHistory.visit({ id: doc.id, anchor: doc.anchor }, origin);
  updateHistoryButtons();
  scheduleSession();
  run(() => checkDisk(doc))();
  if (settings.sidebar) run(followCurrentFolder)();
}
function setMode(mode, { anchor: destination } = {}) {
  if (!active || active.mode === mode) return;
  selectionTools?.hide();
  closeColorPicker();
  blockEditor?.finish();
  linkPreview.hide();
  clearTimeout(renderingTimer);
  capture();
  const doc = active,
    anchor = destination || doc.anchor;
  doc.anchor = anchor;
  doc.mode = mode;
  $("#panes").dataset.mode = mode;
  render(false);
  updateModes();
  requestAnimationFrame(() => {
    if (active === doc && doc.mode === mode)
      restore(doc, anchor, { expand: true, select: mode !== "read" });
  });
  scheduleSession();
}
function render(preserve) {
  if (!active) return;
  if (blockEditor?.active) return;
  blockEditor?.resetHover();
  const doc = active,
    host = $("#reader");
  const anchor = preserve && doc.mode !== "source" ? visibleAnchor(host) : null;
  let fragment = null;
  if (doc.htmlText !== doc.text) {
    linkPreview.hide();
    const result = renderMarkdown(doc.text, doc.fileId, {
      deferMath: true,
      interactiveTasks: true,
    });
    doc.html = result.html;
    doc.headings = result.headings;
    doc.htmlText = doc.text;
    doc.hydrate = result.hydrate;
    doc.renderBytes = result.bytes;
    doc.formulaCount = result.formulaCount;
    fragment = result.fragment;
  }
  const container = $("#content");
  const changed = previewCache.update(container, doc.id, doc.html, fragment, {
    hydrate: doc.hydrate,
    bytes: doc.renderBytes,
  });
  doc.previewText = doc.text;
  if (changed) {
    for (const el of container.querySelectorAll(".note-section"))
      if (doc.folds.includes(el.dataset.foldKey)) {
        setSectionCollapsed(el, true);
      }
    [...container.querySelectorAll("details")].forEach((el, i) => {
      el.open = doc.details.includes(i);
    });
    updateOutline(doc.headings || []);
  }
  if (anchor) restoreAnchor(host, anchor);
  updateStatus();
  renderDiagrams(container, settings.theme, () => {
    if (currentAnchor?.id === active?.id)
      restoreAnchor(host, currentAnchor.anchor);
  });
  scheduleTableLayout();
}
let outlineSignature = "";
function updateOutline(headings) {
  const signature = JSON.stringify(
    headings.map(({ label, id, level }) => ({ label, id, level })),
  );
  if (outlineSignature === signature) {
    [...$("#outline").children].forEach((button, i) => {
      button.dataset.from = String(headings[i].from);
    });
    return;
  }
  outlineSignature = signature;
  $("#outline").replaceChildren(
    ...headings.map((h) => {
      const b = document.createElement("button");
      b.innerHTML = renderHeadingLabel(h.label);
      b.title = h.label;
      b.style.paddingLeft = 12 + (h.level - 1) * 12 + "px";
      b.dataset.from = String(h.from);
      b.onclick = () => jump(Number(b.dataset.from));
      return b;
    }),
  );
  // Math in headings renders as TeX until KaTeX loads; then redraw this outline.
  if (!mathReady() && headings.some((h) => mayContainMath(h.label)))
    loadMath().then(() => {
      if (outlineSignature !== signature) return;
      outlineSignature = "";
      updateOutline(headings);
    });
}
function updateTabs() {
  tabBar.update();
}
function updateModes() {
  for (const b of document.querySelectorAll("[data-mode]"))
    if (b.tagName === "BUTTON")
      b.setAttribute("aria-pressed", String(b.dataset.mode === active?.mode));
  updateStatus();
}
function updateStatus() {
  if (!active) {
    for (const id of ["status", "editor-position"])
      $("#" + id).textContent = "";
    document.title = "Folio Notes";
    return;
  }
  setText(
    "#status",
    dirty(active) ? "● 未保存" : active.fileId ? "已保存" : "本地草稿",
  );
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  setText("#editor-position", `行 ${line.number} / ${view.state.doc.lines}`);
  const title = (dirty(active) ? "● " : "") + active.name + " — Folio Notes";
  if (document.title !== title) document.title = title;
}
function setText(selector, text) {
  const node = $(selector);
  if (node.textContent !== text) node.textContent = text;
}
function showHome() {
  blockEditor?.finish();
  clearTimeout(renderingTimer);
  linkPreview.hide();
  active = null;
  currentAnchor = null;
  pendingLocation = null;
  locationVersion++;
  updateHistoryButtons();
  setEditorState(stateFor(docFrom()));
  $("#content").replaceChildren();
  previewCache.clear();
  $("#outline").replaceChildren();
  outlineSignature = "";
  $("#conflict").hidden = true;
  $("main").dataset.empty = "true";
  $("#home").hidden = false;
  if (findBar.isOpen) findBar.close();
  updateTabs();
  updateModes();
  run(showRecent)();
}
// The start page lists recently opened notes (the jump list mirrors them).
async function showRecent() {
  const section = $(".start-recent");
  if (!api?.recentFiles) return;
  const items = (await api.recentFiles()).slice(0, 8);
  $("#recent-list").replaceChildren(
    ...items.map((item) => {
      const entry = document.createElement("li"),
        button = document.createElement("button"),
        name = document.createElement("span"),
        folder = document.createElement("span");
      button.type = "button";
      button.className = "recent-item";
      button.title = item.path;
      name.className = "recent-name";
      name.textContent = item.name;
      folder.className = "recent-folder";
      folder.textContent = item.folder;
      button.append(name, folder);
      button.onclick = run(async () => add(await api.openRecent(item.path)));
      entry.append(button);
      return entry;
    }),
  );
  section.hidden = !items.length;
}
$("#recent-clear").onclick = run(async () => {
  await api.clearRecent();
  await showRecent();
});
async function closeTab(doc) {
  if (!doc || doc.closing) return;
  if (doc === active) blockEditor?.finish();
  if (doc.saving) {
    toast("正在保存，请保存完成后再关闭。");
    return;
  }
  doc.closing = true;
  try {
    if (dirty(doc)) {
      $("#confirm-title").textContent = "保存修改？";
      $("#confirm-detail").textContent = doc.name;
      const modal = $("#confirm");
      modal.showModal();
      const choice = await new Promise((resolve) =>
        modal.addEventListener("close", () => resolve(modal.returnValue), {
          once: true,
        }),
      );
      if (choice === "cancel" || !choice) return;
      if (choice === "save") {
        if (!(await save(false, doc))) return;
        // The editor remains usable during disk I/O; only the captured snapshot was saved.
        if (dirty(doc)) {
          toast("保存期间有新的修改，已保留标签页，请再次保存或确认关闭。");
          return;
        }
      }
    }
    const index = tabs.indexOf(doc);
    if (index < 0) return;
    if (doc === active) {
      capture();
      active = null;
    }
    tabs.splice(index, 1);
    readingHistory.remove(doc.id);
    updateHistoryButtons();
    previewCache.release(doc.id);
    if (!active) {
      const next = tabs[Math.min(index, tabs.length - 1)];
      if (next) activateTab(next);
      else showHome();
    }
    updateTabs();
    scheduleSession();
  } finally {
    doc.closing = false;
  }
}
const { save, checkDisk, showConflict } = createDocumentSync({
  api,
  tabs,
  getActive: () => active,
  dirty,
  run,
  report: toast,
  conflictBar: $("#conflict"),
  capture,
  finishEditing: () => blockEditor?.finish(),
  redisplay: (doc) => {
    setEditorState(stateFor(doc));
    render(false);
    restore(doc);
  },
  updateStatus,
  updateTabs,
  changed: scheduleSession,
});
function jump(from, { record = true } = {}) {
  if (!active) return;
  blockEditor?.finish();
  const origin = navigationSnapshot();
  const anchor = { from, y: 32 };
  restoreSoon(active, anchor, {
    expand: true,
    select: true,
    behavior: navigationMotion(),
  });
  if (record) readingHistory.visit({ id: active.id, anchor }, origin);
  updateHistoryButtons();
  scheduleSession();
}
function navigationMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";
}
async function navigateLink(href, source = active) {
  const origin = navigationSnapshot();
  source ||= active;
  // Capture the initiating context before asynchronous file access or tab switches.
  const parent = source?.opener || source;
  const opener = { id: parent?.id, groupId: parent?.groupId };
  const { target, anchor } = splitLink(href);
  if (/^https?:\/\//i.test(href)) {
    if (api && source.fileId) await api.link(source.fileId, href);
    else toast("请在桌面版已打开的笔记中使用外部链接");
    return;
  }
  if (target) {
    if (!api) return toast("请在桌面版打开文件链接");
    if (!source.fileId) return toast("请先保存当前笔记");
    const file = await api.link(source.fileId, target);
    if (!file) return;
    if (!add(file, { opener })) return;
  } else if (source !== active) {
    const existing = tabs.find(
      (t) =>
        t.id === source.id || (source.fileId && t.fileId === source.fileId),
    );
    if (existing) activateTab(existing);
    else if (
      !add(
        {
          id: source.fileId,
          path: source.path,
          name: source.name,
          text: source.text,
          version: source.version,
        },
        { opener },
      )
    )
      return;
  }
  if (!anchor) return;
  const line = anchor.match(/^L(\d+)(?:C(\d+))?$/i);
  if (line) {
    const n = Math.max(1, Math.min(Number(line[1]), view.state.doc.lines)),
      l = view.state.doc.line(n);
    jump(Math.min(l.to, l.from + Math.max(0, Number(line[2] || 1) - 1)), {
      record: active.id === origin?.id,
    });
    if (active.id !== origin?.id)
      readingHistory.update({ id: active.id, anchor: active.anchor });
    updateHistoryButtons();
    return;
  }
  const el = $("#content").querySelector("#" + CSS.escape(anchor));
  if (el) {
    unfold(el);
    const from = Number(
      el.dataset.from ?? el.closest("[data-from]")?.dataset.from ?? 0,
    );
    const destination = { from, y: 32, targetId: anchor };
    restoreSoon(active, destination, {
      expand: true,
      behavior: navigationMotion(),
    });
    if (active.id !== origin?.id)
      readingHistory.update({ id: active.id, anchor: destination });
    else readingHistory.visit({ id: active.id, anchor: destination }, origin);
    updateHistoryButtons();
    scheduleSession();
  } else toast("没有找到锚点：" + anchor);
}
const linkPreview = createLinkPreview({
  host: $("#content"),
  report: toast,
  getZoom: () => settings.previewZoom,
  saveZoom: (value) => {
    settings.previewZoom = value;
    scheduleSession();
  },
  navigate: navigateLink,
  load: async (href) => {
    const source = active,
      { target } = splitLink(href);
    const opener = { id: source?.id, groupId: source?.groupId };
    if (!target) return { ...source, draft: dirty(source) };
    if (!api?.preview) throw Error("请在桌面版中预览本地文件");
    if (!source?.fileId) throw Error("请先保存当前笔记以确定相对路径");
    const file = await api.preview(source.fileId, target);
    const existing = tabs.find(
      (t) => t.fileId === file.id || t.path === file.path,
    );
    if (existing) {
      if (dirty(existing)) return { ...existing, draft: true, opener };
      // Clean tabs may be stale while inactive: preview reads the latest disk bytes.
      const latest = await api.read(file.id);
      return { ...file, ...latest, fileId: file.id, opener };
    }
    const latest =
      typeof file.text === "string"
        ? file
        : { ...file, ...(await api.read(file.id)) };
    return { ...latest, fileId: file.id, opener };
  },
});
wireCodeBlocks($("#content"), toast);
wireImageErrors(api, toast);
let locationTimer;
function highlightLocation(from, to = from + 1) {
  clearTimeout(locationTimer);
  CSS.highlights?.delete("folio-location");
  $("#content")
    .querySelectorAll(".located")
    .forEach((el) => el.classList.remove("located"));
  const first = findPosition($("#content"), from);
  const last = findPosition($("#content"), Math.max(from, to - 1));
  if (first?.range && last?.range && CSS.highlights) {
    const range = document.createRange();
    range.setStart(first.range.startContainer, first.range.startOffset);
    range.setEnd(last.range.endContainer, last.range.endOffset);
    CSS.highlights.set("folio-location", new Highlight(range));
  } else first?.element.classList.add("located");
  locationTimer = setTimeout(() => {
    CSS.highlights?.delete("folio-location");
    first?.element.classList.remove("located");
  }, 1800);
}
function sourceToPreview() {
  if (!active || active.mode === "read") return;
  render(false);
  const { from, to } = view.state.selection.main;
  navigateToAnchor($("#reader"), { from, y: 32 }, { expand: true });
  highlightLocation(from, to);
  active.pane = "editor";
}
// Task boxes in the preview edit the source ("[ ]" <-> "[x]") exactly as typing
// would, so the change marks the note dirty, saves normally and can be undone.
const TASK_MARKER = /^([ \t>]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/;
$("#content").addEventListener("change", (event) => {
  const box = event.target.closest?.("input.task-list-item-checkbox");
  if (!box || !active) return;
  const from = Number(
    box.closest("li.task-list-item[data-from]")?.dataset.from,
  );
  const doc = view.state.doc;
  const match =
    !blockEditor?.active &&
    Number.isInteger(from) &&
    from <= doc.length &&
    doc.sliceString(from, doc.lineAt(from).to).match(TASK_MARKER);
  if (!match) {
    box.checked = !box.checked;
    toast("无法定位该任务的源码，未修改");
    return;
  }
  const at = from + match[1].length + 1;
  view.dispatch({
    changes: { from: at, to: at + 1, insert: box.checked ? "x" : " " },
    userEvent: "input.task",
  });
});
$("#content").addEventListener("dblclick", (event) => {
  if (blockEditor?.active || event.target.closest(".block-editor")) return;
  if (event.target.closest("button,a,summary,input")) return;
  const hit = atPoint($("#content"), event.clientX, event.clientY);
  if (!hit) return;
  constrainWordSelection($("#content"), hit);
  const selected = selectionSource($("#content"));
  // In split editing, a word selection belongs to the preview formatting tools.
  // Alt-double-click retains the explicit source-location gesture.
  if (active.mode === "edit" && selected && !event.altKey) {
    view.dispatch({
      selection: { anchor: selected.from, head: selected.to },
      effects: EditorView.scrollIntoView(selected.from, { y: "center" }),
    });
    active.pane = "preview";
    return;
  }
  const from = Math.min(selected?.from ?? hit.from, view.state.doc.length),
    to = Math.min(selected?.to ?? hit.to ?? from + 1, view.state.doc.length);
  const anchor = { from, y: 80 };
  if (active.mode === "read") setMode("edit", { anchor });
  const doc = active;
  requestAnimationFrame(() => {
    if (active !== doc || doc.mode === "read") return;
    navigateToAnchor($("#reader"), anchor, { expand: true });
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
    active.pane = "preview";
    active.anchor = anchor;
    currentAnchor = { id: doc.id, anchor };
    highlightLocation(from, to);
  });
});
$("#content").addEventListener(
  "click",
  run(async (event) => {
    const fold = event.target.closest(".fold, .section-rail, .section-summary");
    if (fold) {
      if (blockEditor?.active) {
        blockEditor.finish();
        return;
      }
      const section = fold.closest(".note-section"),
        collapsed = !section.classList.contains("collapsed");
      setSectionCollapsed(section, collapsed);
      capture();
      scheduleSession();
      return;
    }
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    await navigateLink(link.getAttribute("href") || "");
  }),
);
$("#reader").addEventListener(
  "load",
  () => {
    if (currentAnchor?.id === active?.id && !restoring)
      restoreAnchor($("#reader"), currentAnchor.anchor);
  },
  true,
);
$("#reader").addEventListener(
  "error",
  (e) => {
    if (e.target.tagName === "IMG") e.target.classList.add("image-error");
  },
  true,
);
for (const name of ["wheel", "pointerdown", "keydown"])
  $("#reader").addEventListener(
    name,
    () => {
      if (active) active.pane = "preview";
      currentAnchor = null;
    },
    { passive: true },
  );
let scrollFrame = 0;
function scrolled() {
  lastScrollAt = performance.now();
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateStatus();
    scheduleSession();
  });
}
$("#reader").addEventListener("scroll", scrolled, { passive: true });
view.scrollDOM.addEventListener("scroll", scrolled, { passive: true });
// Chromium re-hit-tests the page after every scroll step to update hover. With
// rendered formulas (KaTeX positions thousands of spans) each test took ~12 ms
// and made wheel scrolling stutter. While the reader scrolls, a transparent
// layer on top answers those tests immediately. Not during a drag: selecting
// past the edge auto-scrolls and needs the text underneath.
const scrollShield = document.createElement("div");
scrollShield.className = "scroll-shield";
scrollShield.setAttribute("aria-hidden", "true");
$("#reader").prepend(scrollShield);
let pointerHeld = false,
  shieldTimer = 0;
const lowerShield = () => {
  clearTimeout(shieldTimer);
  scrollShield.classList.remove("raised");
};
document.addEventListener(
  "pointerdown",
  () => {
    pointerHeld = true;
    lowerShield();
  },
  { capture: true, passive: true },
);
for (const name of ["pointerup", "pointercancel"])
  document.addEventListener(name, () => (pointerHeld = false), {
    capture: true,
    passive: true,
  });
// A real pointer move (hover, aiming a click) lowers it at once.
document.addEventListener("pointermove", lowerShield, {
  capture: true,
  passive: true,
});
// Raised by the reader's own wheel and scrolling keys only; jumps, restores
// and history returns scroll programmatically and never raise it. It stays
// up while that scroll (and its smooth animation) continues.
const scrollKeys = new Set([
  "PageDown",
  "PageUp",
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  " ",
]);
const raiseShield = () => {
  if (pointerHeld) return;
  scrollShield.classList.add("raised");
  clearTimeout(shieldTimer);
  shieldTimer = setTimeout(lowerShield, 150);
};
$("#reader").addEventListener("wheel", raiseShield, { passive: true });
$("#reader").addEventListener(
  "keydown",
  (event) => {
    if (scrollKeys.has(event.key) && !event.target.closest("input, textarea"))
      raiseShield();
  },
  { passive: true },
);
$("#reader").addEventListener(
  "scroll",
  () => {
    if (scrollShield.classList.contains("raised")) raiseShield();
  },
  { passive: true },
);

async function openFiles() {
  if (!api) return toast("请运行桌面版以访问本地文件");
  for (const file of await api.pickFiles()) add(file);
}
const { openFolder, renderTree, followCurrentFolder } = createLibrary({
  api,
  roots,
  getActive: () => active,
  getSettings: () => settings,
  add,
  run,
  report: toast,
  changed: scheduleSession,
});
function contextMenu(e, doc) {
  showContext(e, [
    ["在文件夹中显示", () => api.reveal(doc.fileId), !doc.fileId],
    ["刷新文件", () => checkDisk(doc, true), !doc.fileId],
    ...tabBar.actions(doc),
    ["关闭标签", () => closeTab(doc), false],
  ]);
}
const { showContext, dismiss: dismissMenus } = createMenus({
  run,
  appMenuEntries: () => [
    ["导出 PDF…", "", commands.exportPDF, !active || exporting],
    ["导出 HTML…", "", commands.exportHTML, !active || exporting],
  ],
});
wireFileDrop({
  insertImages: (files, event) => imageInsertion.insert(files, event),
  api,
  opened: (docs) => docs.forEach((doc) => add(doc)),
  report: toast,
});
function zoom(delta) {
  capture();
  settings.zoom = Math.max(
    50,
    Math.min(200, delta === 0 ? 100 : settings.zoom + delta),
  );
  applySettings();
  if (active) requestAnimationFrame(() => restore(active));
  scheduleSession();
}
function applySettings() {
  const themeChanged =
    document.documentElement.dataset.theme !== settings.theme;
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty(
    "--note-size",
    ((settings.typeface === "literata" ? 16 : 18) * settings.zoom) / 100 + "px",
  );
  document.documentElement.style.setProperty("--split", settings.split + "%");
  $("#split").setAttribute("aria-valuenow", String(settings.split));
  $("#zoom-reset").textContent = settings.zoom + "%";
  document.documentElement.dataset.wide = String(settings.wide);
  $("#width-toggle").setAttribute("aria-pressed", String(settings.wide));
  $("#width-toggle").title = settings.wide ? "切换为窄版" : "切换为宽版";
  applyAppearance(settings);
  refreshColorButtons();
  updateHistoryButtons();
  if (themeChanged) renderDiagrams($("#content"), settings.theme, () => {});
}
function changeSettings(patch) {
  const geometryChanged = Object.keys(patch).some((key) =>
    [
      "zoom",
      "typeface",
      "weight",
      "wide",
      "sidebar",
      "outline",
      "librarySide",
      "outlineSide",
      "split",
    ].includes(key),
  );
  if (geometryChanged) capture();
  Object.assign(settings, patch);
  applySettings();
  if (patch.sidebar === true) run(followCurrentFolder)();
  const doc = active;
  if (doc && geometryChanged)
    requestAnimationFrame(() => {
      if (active === doc) restore(doc);
    });
  scheduleSession();
}
function scheduleSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => run(flushSession)(), 700);
  maxSessionTimer ??= setTimeout(() => run(flushSession)(), 5000);
}
// Tab id -> epoch of the draft main last accepted. Unchanged drafts are not
// resent on every scroll/5 s flush; main keeps the last copy it received.
const sentDrafts = new Map();
async function flushSession() {
  clearTimeout(sessionTimer);
  clearTimeout(maxSessionTimer);
  maxSessionTimer = null;
  if (!api) return;
  capture();
  const drafts = new Map();
  const entries = tabs.map((t) => {
    const changed = dirty(t);
    if (changed) drafts.set(t.id, t.epoch);
    return {
      id: t.id,
      fileId: t.fileId,
      name: t.name,
      // A dirty untitled note travels once, as its draft.
      content: t.fileId || changed ? undefined : t.text,
      mode: t.mode,
      groupId: t.groupId || null,
      pane: t.pane,
      anchor: t.anchor,
      folds: t.folds,
      details: t.details,
      ...(!changed
        ? {}
        : sentDrafts.get(t.id) === t.epoch
          ? { keepDraft: true }
          : { draft: t.text, base: t.base, version: t.version }),
    };
  });
  try {
    await api.session({
      settings,
      roots: roots.map((r) => r.id),
      active: active?.path || active?.id,
      tabs: entries,
    });
  } catch (error) {
    // Never trust main's copy after a failure; retry once with every draft in full.
    sentDrafts.clear();
    if (entries.some((entry) => entry.keepDraft)) return flushSession();
    throw error;
  }
  sentDrafts.clear();
  for (const [id, epoch] of drafts) sentDrafts.set(id, epoch);
}
const commands = {
  back: () => hardwareNavigation(-1, "native"),
  forward: () => hardwareNavigation(1, "native"),
  open: openFiles,
  folder: openFolder,
  new: () => {
    if (!add({ name: "未命名.md" }, { opener: active })) return;
    setMode("edit");
    requestAnimationFrame(() => view.focus());
  },
  save: () => save(),
  saveAs: () => save(true),
  refresh: () => checkDisk(active, true),
  exportHTML: () => exportActive("html"),
  exportPDF: () => exportActive("pdf"),
  read: () => setMode("read"),
  edit: () => setMode("edit"),
  source: () => setMode("source"),
  zoomIn: () => zoom(10),
  zoomOut: () => zoom(-10),
  hide: () => commands.close("hide"),
  quit: () => commands.close("quit"),
  desktopSettings: () => openDesktopSettings(),
  close: async (intent = "close") => {
    if (tabs.some((t) => t.saving)) {
      toast("文件正在保存，请完成后再关闭");
      return;
    }
    // Report a failed recovery write instead of aborting: main asks whether to quit anyway.
    const failure = await flushSession().then(
      () => null,
      (error) => error.message || String(error),
    );
    await api.closeReady(intent, failure);
  },
};
let exporting = false;
async function exportActive(format) {
  if (!active || exporting) return;
  exporting = true;
  const doc = { text: active.text, fileId: active.fileId, name: active.name };
  try {
    const { exportNote } = await import("./export.js");
    const result = await exportNote(format, { doc });
    if (!result.canceled)
      toast(
        result.warnings?.length
          ? `已导出；${result.warnings.length} 项内容无法完整嵌入：${result.warnings[0]}`
          : `已导出 ${format.toUpperCase()}`,
      );
  } finally {
    exporting = false;
  }
}
for (const [id, fn] of Object.entries({
  open: openFiles,
  folder: openFolder,
  "folder-empty": openFolder,
  "start-open": openFiles,
  "start-folder": openFolder,
  "start-new": commands.new,
  new: commands.new,
  save: commands.save,
  "width-toggle": () => changeSettings({ wide: !settings.wide }),
  "zoom-out": () => zoom(-10),
  "zoom-in": () => zoom(10),
  "zoom-reset": () => zoom(0),
  theme: () => {
    changeSettings({ theme: settings.theme === "light" ? "dark" : "light" });
  },
  "sidebar-toggle": () => {
    changeSettings({ sidebar: !settings.sidebar });
  },
  "outline-toggle": () => changeSettings({ outline: !settings.outline }),
}))
  $("#" + id).onclick = run(fn);
for (const b of document.querySelectorAll("button[data-mode]"))
  b.onclick = () => setMode(b.dataset.mode);
wireAppearance(changeSettings);
const openDesktopSettings = wireDesktopSettings({
  api,
  close: (intent) => commands.close(intent),
  report: toast,
});
wireSplitPane({
  handle: $("#split"),
  panes: $("#panes"),
  getSettings: () => settings,
  capture,
  applySettings,
  restore: () => {
    if (active) restore(active);
  },
  changed: scheduleSession,
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismissMenus();
  if ($("dialog[open]")) return;
  if (e.key === "F3" && findBar.isOpen) {
    e.preventDefault();
    if (e.shiftKey) findBar.previous();
    else findBar.next();
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  // Ctrl+F in the editor opens CodeMirror's search (it handles the key first);
  // anywhere else it searches the rendered note.
  if (key === "f" && !e.shiftKey && !e.altKey) {
    if (e.defaultPrevented || e.target.closest?.("#editor")) return;
    if (!active || active.mode === "source") return;
    e.preventDefault();
    findBar.open();
    return;
  }
  const cmd = {
    o: e.shiftKey ? "folder" : "open",
    s: e.shiftKey ? "saveAs" : "save",
    n: "new",
    r: "refresh",
    1: "read",
    2: "edit",
    3: "source",
  }[key];
  if (cmd) {
    e.preventDefault();
    run(commands[cmd])();
  } else if (key === "w") {
    e.preventDefault();
    run(() => closeTab(active))();
  } else if (["+", "=", "-", "0"].includes(key)) {
    e.preventDefault();
    zoom(key === "0" ? 0 : key === "-" ? -10 : 10);
  }
});
// A non-passive wheel listener makes every wheel notch wait for the page's
// main thread (hit-testing a long, formula-heavy note), so scrolling stutters.
// The desktop app gets Ctrl+wheel from Electron instead ("zoom-changed" →
// zoomIn/zoomOut commands); only the browser demo listens here.
if (!api)
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoom(e.deltaY < 0 ? 10 : -10);
      }
    },
    { passive: false },
  );
window.addEventListener("focus", () => run(() => checkDisk())());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) run(() => checkDisk())();
});
window.addEventListener("beforeunload", () => {
  run(flushSession)();
});
async function untouchedLegacyWelcome(entry) {
  if (
    entry.document ||
    entry.name !== "欢迎.md" ||
    typeof entry.content !== "string" ||
    typeof entry.draft === "string"
  )
    return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(entry.content),
  );
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (
    hash === "fd9154e2926f7061c527b3d33011588e02f70e5b2137fdff7333b49fe28521b3"
  );
}
// Code rendered before highlight.js loaded is plain; re-render such notes once.
onHighlighterReady(() => {
  for (const t of tabs) if (mayContainCode(t.text)) t.htmlText = null;
  if (active && mayContainCode(active.text)) render(true);
});
if (api) {
  api.on("open", (docs) => docs.forEach((file) => add(file)));
  api.on("disk", () => run(() => checkDisk())());
  api.on("command", (cmd) => run(commands[cmd] || (() => {}))());
  api.on("window", showWindowState);
  api.windowState?.().then(showWindowState, () => {});
  run(async () => {
    const boot = await api.ready();
    // Changes made while booting (e.g. zoom) stay underneath the stored values.
    settings = normalizeSettings({ ...settings, ...boot.settings });
    applySettings();
    for (const entry of boot.restored || []) {
      // Retire only the exact unedited app-generated welcome. Never alter a user document.
      if (await untouchedLegacyWelcome(entry)) continue;
      const doc = add(
        entry.document || { name: entry.name, text: entry.content || "" },
        { activate: false },
      );
      if (!doc) break;
      doc.id = entry.id || doc.id;
      Object.assign(doc, {
        mode: ["read", "edit", "source"].includes(entry.mode)
          ? entry.mode
          : "read",
        pane: entry.pane || "preview",
        groupId: typeof entry.groupId === "string" ? entry.groupId : null,
        anchor: entry.anchor || doc.anchor,
        folds: entry.folds || [],
        details: entry.details || [],
      });
      if (typeof entry.draft === "string") {
        doc.text = entry.draft;
        doc.base = entry.base || "";
        doc.version = entry.version || doc.version;
        if (entry.document && entry.document.text !== doc.base)
          doc.conflict = {
            text: entry.document.text,
            version: entry.document.version,
          };
      }
    }
    roots.push(...(boot.roots || []));
    if (roots.length) await renderTree();
    for (const file of boot.incoming || []) add(file, { activate: false });
    if (tabs.length)
      activateTab(
        tabs.find((t) => t.path === boot.active || t.id === boot.active) ||
          tabs.at(-1),
        { revealGroup: false },
      );
    else showHome();
  })();
} else {
  applySettings();
  showHome();
}
