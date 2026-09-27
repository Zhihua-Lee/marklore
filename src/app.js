import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  renderMarkdown,
  parseHeadings,
  renderHeadingLabel,
} from "./markdown.js";
import {
  atPoint,
  visibleAnchor,
  restoreAnchor,
  findPosition,
  unfold,
  selectionSource,
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
  view,
  switching = false,
  renderingTimer,
  sessionTimer,
  maxSessionTimer,
  toastTimer,
  restoring = false;
let settings = {
    zoom: 100,
    previewZoom: 100,
    theme: "light",
    sidebar: true,
    split: 50,
    weight: "auto",
    navigationSize: 12,
    tabSize: 11,
    typeface: "literata",
    wide: false,
    outline: true,
    librarySide: "left",
    outlineSide: "right",
  },
  currentAnchor = null;
const previewCache = createPreviewCache();
let editingKeys = [];
$("#app").innerHTML = `
<header class="topbar"><div id="panel-controls-left" class="panel-controls"><button id="sidebar-toggle" class="icon" title="切换文件夹浏览" aria-label="切换文件夹浏览">${icon("folder")}</button></div><button id="app-menu-toggle" class="icon brand-menu" title="Folio Notes 菜单" aria-label="应用菜单" aria-haspopup="menu" aria-expanded="false">${icon("eye")}</button><button id="tabs-back" class="icon tab-nav" aria-label="向左浏览标签">${icon("chevronLeft")}</button><div id="tabs" role="tablist" aria-label="打开的笔记"></div><button id="tabs-forward" class="icon tab-nav" aria-label="向右浏览标签">${icon("chevronRight")}</button><button id="new" class="icon" aria-label="新笔记" title="新笔记 Ctrl+N">${icon("plus")}</button><div id="panel-controls-right" class="panel-controls"><button id="outline-toggle" class="icon" title="切换本文目录" aria-label="切换本文目录">${icon("outline")}</button></div></header>
<div class="workspace"><aside id="sidebar" class="dock" aria-label="左侧栏"><section id="library-panel" class="side-panel"><div class="sidebar-top"><span class="eyebrow">笔记库</span><span><button id="tree-refresh" class="icon" aria-label="刷新文件树" title="刷新文件树">${icon("refresh")}</button><button id="folder" class="icon" aria-label="打开文件夹" title="打开文件夹">${icon("plus")}</button></span></div><input id="file-filter" type="search" placeholder="搜索笔记…" aria-label="筛选文件" title="搜索文件名，包含子文件夹"><div id="tree"><div class="empty-tree">尚未添加文件夹<br><button id="folder-empty">打开文件夹</button></div></div></section><section id="outline-panel" class="side-panel"><div class="sidebar-top"><span class="eyebrow">本文目录</span></div><nav id="outline" aria-label="本文目录"></nav></section></aside>
<main><div class="toolbar"><div class="toolbar-group document-tools" role="group" aria-label="文件操作"><button id="open" class="icon" aria-label="打开文件" title="打开文件 Ctrl+O">${icon("open")}</button><button id="save" class="icon" aria-label="保存" title="保存 Ctrl+S">${icon("save")}</button></div><div class="modes" role="group" aria-label="查看模式"><button data-mode="read">阅读</button><button data-mode="edit">编辑</button><button data-mode="source">源码</button></div><div class="toolbar-group reading-tools" role="group" aria-label="阅读设置"><button id="width-toggle" class="icon" aria-label="切换阅读宽度" title="切换阅读宽度" aria-pressed="false">${icon("width")}</button><button id="weight" class="icon" title="外观与布局" aria-label="外观与布局">Aa</button></div></div>
<section id="home" aria-labelledby="home-title" hidden><div class="start-page"><div class="start-brand">${folioLogo}<h1 id="home-title">Folio Notes</h1></div><p>打开一篇笔记，或选择一个文件夹。</p><div class="start-actions"><button id="start-open">${icon("open")}<span>打开文件</span><kbd>Ctrl O</kbd></button><button id="start-folder">${icon("folder")}<span>打开文件夹</span><kbd>Ctrl Shift O</kbd></button><button id="start-new">${icon("plus")}<span>新建笔记</span><kbd>Ctrl N</kbd></button></div></div></section>
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
      .catch((e) => toast(e.message || String(e)));
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
function add(file, { activate = true } = {}) {
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
  tabs.push(doc);
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
          active.text = update.state.doc.toString();
          active.state = update.state;
          active.epoch++;
          active.htmlText = null;
          updateTabs();
          updateStatus();
          scheduleSession();
          clearTimeout(renderingTimer);
          renderingTimer = setTimeout(() => {
            if (active?.mode === "source") {
              active.headings = parseHeadings(active.text);
              updateOutline(active.headings);
            } else render(true);
          }, 160);
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
view = new EditorView({ state: stateFor(docFrom()), parent: $("#editor") });
editingKeys = wireEditing({
  view,
  getDocument: () => active,
  report: toast,
  api,
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
    active.mode === "source" ||
    (active.mode === "edit" && active.pane === "editor")
      ? editorAnchor()
      : visibleAnchor($("#reader"));
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
    restoreAnchor($("#reader"), anchor, { expand, behavior });
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
function activateTab(doc) {
  if (active === doc) return;
  linkPreview.hide();
  clearTimeout(renderingTimer);
  capture();
  active = doc;
  $("main").dataset.empty = "false";
  $("#home").hidden = true;
  switching = true;
  view.setState(doc.state || stateFor(doc));
  switching = false;
  $("#panes").dataset.mode = doc.mode;
  render(false);
  updateTabs();
  updateModes();
  showConflict();
  requestAnimationFrame(() => restore(doc));
  scheduleSession();
  run(() => checkDisk(doc))();
  if (settings.sidebar) run(followCurrentFolder)();
}
function setMode(mode) {
  if (!active || active.mode === mode) return;
  linkPreview.hide();
  clearTimeout(renderingTimer);
  capture();
  const doc = active,
    anchor = doc.anchor;
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
  const doc = active,
    host = $("#reader");
  const anchor = preserve && doc.mode !== "source" ? visibleAnchor(host) : null;
  if (doc.htmlText !== doc.text) {
    linkPreview.hide();
    const result = renderMarkdown(doc.text, doc.fileId);
    doc.html = result.html;
    doc.headings = result.headings;
    doc.htmlText = doc.text;
  }
  const container = $("#content");
  const changed = previewCache.update(container, doc.id, doc.html);
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
}
let outlineSignature = "";
function updateOutline(headings) {
  const signature = JSON.stringify(headings);
  if (outlineSignature === signature) return;
  outlineSignature = signature;
  $("#outline").replaceChildren(
    ...headings.map((h) => {
      const b = document.createElement("button");
      b.innerHTML = renderHeadingLabel(h.label);
      b.title = h.label;
      b.style.paddingLeft = 12 + (h.level - 1) * 12 + "px";
      b.onclick = () => jump(h.from);
      return b;
    }),
  );
}
let visibleTabId = null;
const tabElements = new Map();
function updateTabs() {
  const host = $("#tabs");
  for (const [id, node] of tabElements) {
    if (!tabs.some((doc) => doc.id === id)) {
      node.remove();
      tabElements.delete(id);
    }
  }
  for (const doc of tabs) {
    let wrap = tabElements.get(doc.id);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.dataset.id = doc.id;
      const b = document.createElement("button");
      b.className = "tab-label";
      b.setAttribute("role", "tab");
      b.onclick = () => {
        if (!dragged) activateTab(doc);
      };
      const close = document.createElement("button");
      close.className = "tab-close";
      close.innerHTML = icon("close");
      close.onclick = run(() => closeTab(doc));
      wrap.append(b, close);
      wrap.oncontextmenu = (e) => {
        e.preventDefault();
        contextMenu(e, doc);
      };
      tabElements.set(doc.id, wrap);
      host.append(wrap);
    }
    wrap.className = "tab" + (active === doc ? " active" : "");
    const b = wrap.querySelector(".tab-label");
    b.setAttribute("aria-selected", String(active === doc));
    b.tabIndex = active === doc ? 0 : -1;
    b.title = doc.path || doc.name;
    const label = (dirty(doc) ? "● " : "") + doc.name;
    if (b.textContent !== label) b.textContent = label;
    wrap
      .querySelector(".tab-close")
      .setAttribute("aria-label", "关闭 " + doc.name);
  }
  tabs.forEach((doc, index) => {
    const node = tabElements.get(doc.id);
    if (host.children[index] !== node)
      host.insertBefore(node, host.children[index] || null);
  });
  if (visibleTabId !== active?.id) {
    visibleTabId = active?.id;
    $(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  updateTabOverflow();
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
  clearTimeout(renderingTimer);
  linkPreview.hide();
  active = null;
  currentAnchor = null;
  switching = true;
  view.setState(stateFor(docFrom()));
  switching = false;
  $("#content").replaceChildren();
  previewCache.clear();
  $("#outline").replaceChildren();
  outlineSignature = "";
  $("#conflict").hidden = true;
  $("main").dataset.empty = "true";
  $("#home").hidden = false;
  updateTabs();
  updateModes();
}
async function closeTab(doc) {
  if (!doc || doc.closing) return;
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
async function save(as = false, doc = active) {
  if (!doc) return false;
  if (!api) {
    toast("浏览器演示不写入磁盘；请运行桌面版");
    return false;
  }
  if (doc.saving) return false;
  doc.saving = true;
  let conflict = false;
  try {
    const text = doc.text;
    if (as || !doc.fileId) {
      const excludedIds = tabs
        .filter((t) => t !== doc && t.fileId)
        .map((t) => t.fileId);
      const file = await api.saveAs(text, doc.name, excludedIds);
      if (!file) return false;
      const other = tabs.find(
        (t) => t !== doc && (t.fileId === file.id || t.path === file.path),
      );
      if (other) {
        toast(
          "目标已在另一标签中打开，未合并标签；两份编辑内容均已保留，请检查目标文件。",
        );
        run(() => checkDisk(other))();
        return false;
      }
      doc.fileId = file.id;
      doc.path = file.path;
      doc.name = file.name;
      doc.version = file.version;
    } else {
      const result = await api.save(doc.fileId, text, doc.version);
      if (result.conflict) {
        conflict = true;
        return false;
      }
      doc.version = result.version;
    }
    doc.base = text;
    doc.conflict = null;
    doc.epoch++;
    doc.htmlText = null;
    if (doc === active) {
      showConflict();
      updateStatus();
    }
    updateTabs();
    scheduleSession();
    return true;
  } finally {
    doc.saving = false;
    if (conflict) {
      // checkDisk deliberately ignores saves in flight; release that guard first.
      await checkDisk(doc, true);
      toast("磁盘内容已改变，未覆盖。请处理冲突或另存副本。");
    }
  }
}
async function checkDisk(doc = active, manual = false) {
  if (!api || !doc?.fileId || doc.checking || doc.saving) return;
  doc.checking = true;
  const epoch = doc.epoch,
    text = doc.text;
  try {
    const result = await api.read(doc.fileId, doc.version);
    if (
      !tabs.includes(doc) ||
      doc.epoch !== epoch ||
      doc.text !== text ||
      doc.saving
    )
      return;
    if (result.unchanged) {
      if (manual) toast("已是磁盘最新版本");
      return;
    }
    if (dirty(doc)) {
      doc.conflict = result;
      if (doc === active) showConflict();
      return;
    }
    if (doc === active) capture();
    doc.text = result.text;
    doc.base = result.text;
    doc.version = result.version;
    doc.epoch++;
    doc.htmlText = null;
    doc.state = null;
    if (doc === active) {
      switching = true;
      view.setState(stateFor(doc));
      switching = false;
      render(false);
      restore(doc);
      updateStatus();
    }
    scheduleSession();
    if (manual) toast("已从磁盘刷新");
  } catch (e) {
    if (manual || doc === active) toast("保留当前内容：" + e.message);
  } finally {
    doc.checking = false;
  }
}
function showConflict() {
  const bar = $("#conflict");
  bar.replaceChildren();
  bar.hidden = !active?.conflict;
  if (bar.hidden) return;
  const doc = active,
    label = document.createElement("span");
  label.textContent = "磁盘有新版本，你的未保存内容已保留。";
  bar.append(label);
  const load = document.createElement("button");
  load.textContent = "加载磁盘版本";
  load.onclick = async () => {
    // Destructive resolution uses an explicit confirmation, not a one-click discard.
    if (!window.confirm("放弃当前未保存修改，加载磁盘版本？建议先另存副本。"))
      return;
    capture();
    doc.text = doc.conflict.text;
    doc.base = doc.text;
    doc.version = doc.conflict.version;
    doc.conflict = null;
    doc.epoch++;
    doc.htmlText = null;
    doc.state = null;
    switching = true;
    view.setState(stateFor(doc));
    switching = false;
    render(false);
    restore(doc);
    showConflict();
    updateTabs();
    scheduleSession();
  };
  const copy = document.createElement("button");
  copy.textContent = "另存我的副本";
  copy.onclick = run(() => save(true, doc));
  const keep = document.createElement("button");
  keep.textContent = "继续编辑";
  keep.onclick = () => {
    bar.hidden = true;
    toast("保留编辑；原文件仍有冲突，保存时会再次检查。");
  };
  bar.append(load, copy, keep);
}
function jump(from) {
  if (!active) return;
  const anchor = { from, y: 32 };
  active.anchor = anchor;
  restore(active, anchor, {
    expand: true,
    select: true,
    behavior: navigationMotion(),
  });
  scheduleSession();
}
function navigationMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";
}
async function navigateLink(href, source = active) {
  source ||= active;
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
    if (!add(file)) return;
  } else if (source !== active) {
    const existing = tabs.find(
      (t) =>
        t.id === source.id || (source.fileId && t.fileId === source.fileId),
    );
    if (existing) activateTab(existing);
    else if (
      !add({
        id: source.fileId,
        path: source.path,
        name: source.name,
        text: source.text,
        version: source.version,
      })
    )
      return;
  }
  if (!anchor) return;
  const line = anchor.match(/^L(\d+)(?:C(\d+))?$/i);
  if (line) {
    const n = Math.max(1, Math.min(Number(line[1]), view.state.doc.lines)),
      l = view.state.doc.line(n);
    jump(Math.min(l.to, l.from + Math.max(0, Number(line[2] || 1) - 1)));
    return;
  }
  const el = $("#content").querySelector("#" + CSS.escape(anchor));
  if (el) {
    unfold(el);
    el.scrollIntoView({ block: "start", behavior: navigationMotion() });
    capture();
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
    if (!target) return { ...source, draft: dirty(source) };
    if (!api?.preview) throw Error("请在桌面版中预览本地文件");
    if (!source?.fileId) throw Error("请先保存当前笔记以确定相对路径");
    const file = await api.preview(source.fileId, target);
    const existing = tabs.find(
      (t) => t.fileId === file.id || t.path === file.path,
    );
    if (existing) {
      if (dirty(existing)) return { ...existing, draft: true };
      // Clean tabs may be stale while inactive: preview reads the latest disk bytes.
      const latest = await api.read(file.id);
      return { ...file, ...latest, fileId: file.id };
    }
    const latest =
      typeof file.text === "string"
        ? file
        : { ...file, ...(await api.read(file.id)) };
    return { ...latest, fileId: file.id };
  },
});
wireCodeBlocks($("#content"), toast);
function sourceToPreview() {
  if (!active || active.mode === "read") return;
  render(false);
  const from = view.state.selection.main.from;
  restoreAnchor($("#reader"), { from, y: 32 }, { expand: true });
  const hit = findPosition($("#content"), from);
  if (hit) {
    hit.element.classList.add("located");
    setTimeout(() => hit.element.classList.remove("located"), 1200);
  }
  active.pane = "editor";
}
$("#content").addEventListener("dblclick", (event) => {
  if (event.target.closest("button,a,summary")) return;
  const hit = atPoint($("#content"), event.clientX, event.clientY);
  if (!hit) return;
  const selected = selectionSource($("#content"));
  if (active.mode === "read") setMode("edit");
  const doc = active;
  requestAnimationFrame(() => {
    if (active !== doc || doc.mode === "read") return;
    const from = Math.min(selected?.from ?? hit.from, view.state.doc.length),
      to = Math.min(selected?.to ?? hit.to ?? from, view.state.doc.length);
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
    active.pane = "preview";
    toast(
      hit.exact ? "已定位对应文字" : "已定位对应源码块（公式与结构按块定位）",
    );
  });
});
$("#content").addEventListener(
  "click",
  run(async (event) => {
    const fold = event.target.closest(".fold, .section-rail");
    if (fold) {
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
  $("#reader").addEventListener(name, () => {
    if (active) active.pane = "preview";
    currentAnchor = null;
  });
let scrollFrame = 0;
function scrolled() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateStatus();
    scheduleSession();
  });
}
$("#reader").addEventListener("scroll", scrolled, { passive: true });
view.scrollDOM.addEventListener("scroll", scrolled, { passive: true });

async function openFiles() {
  if (!api) return toast("请运行桌面版以访问本地文件");
  for (const file of await api.pickFiles()) add(file);
}
async function openFolder() {
  if (!api) return toast("请运行桌面版以访问文件夹");
  const root = await api.pickFolder(active?.fileId || null);
  if (root && !roots.some((r) => r.path === root.path)) {
    roots.push(root);
    await renderTree();
    scheduleSession();
  }
}
let currentFolder = null;
let folderEpoch = 0;
let treeEpoch = 0;
function browsingRoots() {
  return currentFolder
    ? [currentFolder, ...roots.filter((r) => r.path !== currentFolder.path)]
    : roots;
}
function markCurrentFile() {
  for (const button of $("#tree").querySelectorAll(".file")) {
    if (button.title === active?.path)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
async function followCurrentFolder() {
  const doc = active,
    epoch = ++folderEpoch;
  if (!doc?.fileId || !api?.currentFolder) return;
  const folder = await api.currentFolder(doc.fileId);
  if (epoch !== folderEpoch || active !== doc || !settings.sidebar) return;
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
let searchTimer,
  searchEpoch = 0;
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
function contextMenu(e, doc) {
  const menu = $("#context");
  menu.replaceChildren();
  for (const [name, fn, disabled] of [
    ["在文件夹中显示", () => api.reveal(doc.fileId), !doc.fileId],
    ["刷新文件", () => checkDisk(doc, true), !doc.fileId],
    ["关闭标签", () => closeTab(doc), false],
  ]) {
    const b = document.createElement("button");
    b.textContent = name;
    b.setAttribute("role", "menuitem");
    b.disabled = disabled;
    b.onclick = run(() => {
      menu.hidden = true;
      return fn();
    });
    menu.append(b);
  }
  menu.style.left = Math.min(e.clientX, innerWidth - 210) + "px";
  menu.style.top = Math.min(e.clientY, innerHeight - 160) + "px";
  menu.hidden = false;
  menu.querySelector("button:not(:disabled)")?.focus();
}
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#context")) $("#context").hidden = true;
  if (!e.target.closest("#app-menu, #app-menu-toggle")) closeAppMenu();
});
function updateTabOverflow() {
  const host = $("#tabs");
  $(".topbar").dataset.overflow = String(
    host.scrollWidth > host.clientWidth + 1,
  );
  $("#tabs-back").disabled = host.scrollLeft < 1;
  $("#tabs-forward").disabled =
    host.scrollLeft >= host.scrollWidth - host.clientWidth - 1;
  const viewport = host.getBoundingClientRect();
  for (const tab of host.children) {
    const label = tab.querySelector(".tab-label").getBoundingClientRect();
    const close = tab.querySelector(".tab-close").getBoundingClientRect();
    tab.classList.toggle(
      "edge-clipped",
      Math.min(label.right, viewport.right) -
        Math.max(label.left, viewport.left) <
        28 ||
        close.left < viewport.left ||
        close.right > viewport.right,
    );
  }
}
let tabOverflowFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(tabOverflowFrame);
  tabOverflowFrame = requestAnimationFrame(updateTabOverflow);
}).observe($("#tabs"));
$("#tabs").addEventListener("scroll", updateTabOverflow, { passive: true });
for (const [id, direction] of [
  ["tabs-back", -1],
  ["tabs-forward", 1],
])
  $("#" + id).onclick = () =>
    $("#tabs").scrollBy({ left: direction * $("#tabs").clientWidth * 0.7 });
$("#tabs").addEventListener("keydown", (event) => {
  if (!event.target.matches(".tab-label")) return;
  const index = tabs.indexOf(active);
  if (
    event.ctrlKey &&
    event.shiftKey &&
    ["ArrowLeft", "ArrowRight"].includes(event.key)
  ) {
    event.preventDefault();
    moveTab(
      active.id,
      Math.max(
        0,
        Math.min(tabs.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)),
      ),
    );
    tabElements.get(active.id)?.querySelector(".tab-label").focus();
    return;
  }
  const next = {
    ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
    ArrowRight: tabs[(index + 1) % tabs.length],
    Home: tabs[0],
    End: tabs.at(-1),
  }[event.key];
  if (!next) return;
  event.preventDefault();
  activateTab(next);
  tabElements.get(next.id)?.querySelector(".tab-label").focus();
});
function moveTab(id, destination) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0 || index === destination) return;
  const [doc] = tabs.splice(index, 1);
  tabs.splice(destination, 0, doc);
  updateTabs();
  scheduleSession();
}
let drag = null,
  dragged = false,
  dragFrame;
$("#tabs").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest(".tab-close")) return;
  const node = e.target.closest(".tab");
  if (!node) return;
  drag = {
    x: e.clientX,
    current: e.clientX,
    node,
    id: e.pointerId,
    left: $("#tabs").scrollLeft,
  };
  dragged = false;
});
function paintTabDrag() {
  if (!drag || !dragged) return;
  const host = $("#tabs"),
    viewport = host.getBoundingClientRect();
  const edge =
    drag.current < viewport.left + 24
      ? -8
      : drag.current > viewport.right - 24
        ? 8
        : 0;
  if (edge) host.scrollLeft += edge;
  drag.node.style.transform = `translateX(${drag.current - drag.x + host.scrollLeft - drag.left}px)`;
  const others = [...host.children].filter((node) => node !== drag.node);
  drag.to = others.findIndex((node) => {
    const box = node.getBoundingClientRect();
    return drag.current < box.left + box.width / 2;
  });
  if (drag.to < 0) drag.to = others.length;
  for (const node of host.children)
    node.classList.remove("drop-before", "drop-after");
  if (others[drag.to]) others[drag.to].classList.add("drop-before");
  else others.at(-1)?.classList.add("drop-after");
  dragFrame = requestAnimationFrame(paintTabDrag);
}
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const delta = e.clientX - drag.x;
  drag.current = e.clientX;
  if (!dragged && Math.abs(delta) > 5) {
    dragged = true;
    $("#tabs").setPointerCapture(e.pointerId);
    $("#tabs").classList.add("dragging");
    drag.node.classList.add("reordering");
    paintTabDrag();
  }
  if (dragged) e.preventDefault();
});
function finishTabDrag(commit) {
  if (!drag) return;
  cancelAnimationFrame(dragFrame);
  const previous = drag;
  previous.node.style.transform = "";
  for (const node of $("#tabs").children)
    node.classList.remove("reordering", "drop-before", "drop-after");
  drag = null;
  $("#tabs").classList.remove("dragging");
  if (commit && dragged) moveTab(previous.node.dataset.id, previous.to);
  setTimeout(() => (dragged = false), 0);
}
window.addEventListener("pointerup", () => finishTabDrag(true));
window.addEventListener("pointercancel", () => finishTabDrag(false));
window.addEventListener("blur", () => finishTabDrag(false));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") finishTabDrag(false);
});
wireFileDrop({
  api,
  opened: (docs) => docs.forEach((doc) => add(doc)),
  report: toast,
});
$("#tabs").addEventListener(
  "wheel",
  (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      $("#tabs").scrollLeft += e.deltaY;
      e.preventDefault();
    }
  },
  { passive: false },
);
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
async function flushSession() {
  clearTimeout(sessionTimer);
  clearTimeout(maxSessionTimer);
  maxSessionTimer = null;
  if (!api) return;
  capture();
  await api.session({
    settings,
    roots: roots.map((r) => r.id),
    active: active?.path || active?.id,
    tabs: tabs.map((t) => ({
      id: t.id,
      fileId: t.fileId,
      name: t.name,
      content: t.fileId ? undefined : t.text,
      mode: t.mode,
      pane: t.pane,
      anchor: t.anchor,
      folds: t.folds,
      details: t.details,
      ...(dirty(t) ? { draft: t.text, base: t.base, version: t.version } : {}),
    })),
  });
}
const commands = {
  open: openFiles,
  folder: openFolder,
  new: () => {
    if (!add({ name: "未命名.md" })) return;
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
  hide: () => commands.close("hide"),
  quit: () => commands.close("quit"),
  desktopSettings: () => openDesktopSettings(),
  close: async (intent = "close") => {
    if (tabs.some((t) => t.saving)) {
      toast("文件正在保存，请完成后再关闭");
      return;
    }
    await flushSession();
    await api.closeReady(intent);
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
function closeAppMenu({ focus = false } = {}) {
  $("#app-menu").hidden = true;
  $("#app-menu-toggle").setAttribute("aria-expanded", "false");
  if (focus) $("#app-menu-toggle").focus();
}
$("#app-menu-toggle").onclick = () => {
  const menu = $("#app-menu");
  if (!menu.hidden) return closeAppMenu();
  menu.replaceChildren();
  for (const entry of [
    ["导出 PDF…", "", commands.exportPDF, !active || exporting],
    ["导出 HTML…", "", commands.exportHTML, !active || exporting],
  ]) {
    if (!entry) {
      menu.append(document.createElement("hr"));
      continue;
    }
    const [label, shortcut, action, disabled] = entry;
    const button = document.createElement("button"),
      key = document.createElement("kbd");
    button.textContent = label;
    button.setAttribute("role", "menuitem");
    button.disabled = !!disabled;
    key.textContent = shortcut;
    button.append(key);
    button.onclick = run(() => {
      closeAppMenu();
      return action();
    });
    menu.append(button);
  }
  menu.hidden = false;
  $("#app-menu-toggle").setAttribute("aria-expanded", "true");
  menu.querySelector("button")?.focus();
};
for (const menu of [$("#app-menu"), $("#context")])
  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement);
    const next = {
      ArrowDown: (index + 1) % buttons.length,
      ArrowUp: (index - 1 + buttons.length) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons[next]?.focus();
  });
$("#tree-refresh").onclick = run(async () => {
  $("#file-filter").value = "";
  searchEpoch++;
  await renderTree();
});
let resizing = false;
$("#split").onpointerdown = (e) => {
  resizing = true;
  capture();
  $("#split").setPointerCapture(e.pointerId);
};
$("#split").onpointermove = (e) => {
  if (!resizing) return;
  const r = $("#panes").getBoundingClientRect();
  settings.split = Math.max(
    25,
    Math.min(75, Math.round(((e.clientX - r.left) / r.width) * 100)),
  );
  document.documentElement.style.setProperty("--split", settings.split + "%");
  $("#split").setAttribute("aria-valuenow", String(settings.split));
};
$("#split").onpointerup = () => {
  resizing = false;
  if (active) restore(active);
  scheduleSession();
};
$("#split").onkeydown = (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  capture();
  settings.split = Math.max(
    25,
    Math.min(75, settings.split + (e.key === "ArrowLeft" ? -5 : 5)),
  );
  applySettings();
  if (active) restore(active);
  scheduleSession();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("#context").hidden = true;
    if (!$("#app-menu").hidden) closeAppMenu({ focus: true });
  }
  if ($("dialog[open]")) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase(),
    cmd = {
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
if (api) {
  api.on("open", (docs) => docs.forEach((file) => add(file)));
  api.on("disk", () => run(() => checkDisk())());
  api.on("command", (cmd) => run(commands[cmd] || (() => {}))());
  run(async () => {
    const boot = await api.ready();
    settings = { ...settings, ...boot.settings };
    // The old automatic sans-serif preset becomes the bundled reading preset.
    // Preserve alternatives explicitly stored by earlier versions.
    if (!settings.typographyVersion && settings.typeface === "balanced")
      settings.typeface = "literata";
    settings.typographyVersion = 1;
    settings.zoom = Math.max(50, Math.min(200, Number(settings.zoom) || 100));
    settings.previewZoom = Math.max(
      50,
      Math.min(200, Number(settings.previewZoom) || 100),
    );
    settings.typeface = ["literata", "balanced", "classic", "book"].includes(
      settings.typeface,
    )
      ? settings.typeface
      : "literata";
    settings.wide = settings.wide === true;
    settings.navigationSize = Math.max(
      10,
      Math.min(14, Number(settings.navigationSize) || 12),
    );
    settings.tabSize = Math.max(
      10,
      Math.min(13, Number(settings.tabSize) || 11),
    );
    settings.weight = [400, 450, 500, 600].includes(Number(settings.weight))
      ? Number(settings.weight)
      : "auto";
    settings.librarySide = settings.librarySide === "right" ? "right" : "left";
    settings.outlineSide = settings.outlineSide === "left" ? "left" : "right";
    settings.theme = settings.theme === "dark" ? "dark" : "light";
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
      );
    else showHome();
  })();
} else {
  applySettings();
  showHome();
}
