import { t } from "../desktop/i18n.mjs";
import { icon } from "./icons.js";
import { readingWeight, bodyFontWeight, emphasisWeight } from "./typography.js";
import { desktopSettingsMarkup } from "./desktop-settings.js";
import { aiSettingsMarkup } from "./ai-settings.js";
const $ = (selector) => document.querySelector(selector);
// Each language is listed under its own name.
const nativeNames = [
  ["zh", "中文"], // i18n-ignore
  ["en", "English"],
];

// One setting per row: its name (and at most one short line) on the left,
// the control on the right. Only the name labels the control.
const row = (id, name, control, note = "") =>
  `<div class="setting"><span class="setting-text"><label for="${id}">${name}</label>${note ? `<small>${note}</small>` : ""}</span>${control}</div>`;
const page = (id, title, desc, body) =>
  `<fieldset id="${id}"><legend>${title}</legend><p class="settings-page-desc">${desc}</p>${body}</fieldset>`;
// Settings: fixed-size dialog; each category opens as its own page beside the
// search bar and nav links.
const sections = [
  ["settings-reading", t("阅读排版")],
  ["settings-theme", t("主题与语言")],
  ["settings-tables", t("表格")],
  ["settings-layout", t("布局与侧栏")],
  ["settings-navigation", t("导航与滚动")],
  ["settings-export", t("导出")],
  ["settings-editing", t("编辑")],
  ["settings-annotation", t("批注")],
  ["settings-ai", t("AI 助手")],
  ["desktop-settings", t("后台与系统")],
];
export const appearanceMarkup = `
<dialog id="appearance" aria-labelledby="appearance-title">
  <header class="settings-title"><h2 id="appearance-title">${t("设置")}</h2><button id="appearance-close" class="icon" aria-label="${t("关闭设置")}" title="${t("关闭 Esc")}">${icon("close")}</button></header>
  <div class="settings-body">
  <aside class="settings-sidebar">
    <div class="settings-search-box">
      <input id="settings-search" type="text" placeholder="${t("搜索设置")}" aria-label="${t("搜索设置")}" autocomplete="off" spellcheck="false">
      <button id="settings-search-clear" type="button" class="icon" aria-label="${t("清空搜索")}" hidden>×</button>
    </div>
    <nav class="settings-nav" aria-label="${t("设置分类")}">${sections.map(([id, label]) => `<button type="button" data-section="${id}">${label}</button>`).join("")}</nav>
  </aside>
  <div class="settings-pane">
  <div id="settings-search-results" class="settings-search-results" hidden></div>
  ${page(
    "settings-reading",
    t("阅读排版"),
    t("正文字体、字号、浓度、排版风格与栏宽"),
    `
    ${row("typeface", t("正文字体"), `<select id="typeface"><option value="literata">${t("Literata + 思源宋体（内置）")}</option><option value="balanced">${t("思源黑体（内置）")}</option><option value="yahei">${t("微软雅黑（系统）")}</option><option value="classic">${t("Arial / 微软雅黑")}</option><option value="book">${t("Cambria / 宋体")}</option></select>`)}
    <div class="setting"><span class="setting-text"><span>${t("字号")}</span></span><div class="zoom-control" role="group" aria-label="${t("字号")}"><button id="zoom-out" aria-label="${t("缩小字号")}">${icon("minus")}</button><button id="zoom-reset" title="${t("重置字号")}">100%</button><button id="zoom-in" aria-label="${t("放大字号")}">${icon("plus")}</button></div></div>
    ${row("text-weight", t("正文浓度"), `<select id="text-weight"><option value="auto">${t("自动（按屏幕）")}</option><option value="300">${t("细 300")}</option><option value="350">${t("较细 350")}</option><option value="400">${t("标准 400")}</option><option value="450">${t("适中 450")}</option><option value="500">${t("较浓 500")}</option><option value="550">${t("浓 550")}</option></select>`, '<span id="weight-note"></span>')}
    ${row("reading-style", t("排版风格"), `<select id="reading-style"><option value="relaxed">${t("舒展")}</option><option value="standard">${t("标准（默认）")}</option><option value="compact">${t("紧凑")}</option></select>`, t("只改行高、段距和标题大小；栏宽在下面单独设置"))}
    ${row("column-width", t("正文栏宽"), `<select id="column-width"><option value="window">${t("随窗口")}</option><option value="measure">${t("按字数")}</option><option value="fixed">${t("固定（默认）")}</option></select>`)}
    ${row("cjk-emphasis", t("中文旁的粗体与斜体"), '<input id="cjk-emphasis" type="checkbox" class="switch">', t("**定义：**其中 这样标点收尾、紧接中文的写法也显示为粗体；其他严格遵循 CommonMark 的软件仍显示星号"))}
    <div class="setting"><span class="setting-text"><span>${t("默认排版")}</span></span><span class="setting-actions"><button id="reset-typography" type="button">${t("恢复默认排版")}</button></span></div>`,
  )}
  ${page(
    "settings-theme",
    t("主题与语言"),
    t("浅深外观颜色与界面显示语言"),
    `
    ${row("color-theme", t("界面颜色"), `<select id="color-theme"><option value="light">${t("浅色")}</option><option value="dark">${t("深色")}</option></select><button id="theme" class="icon" aria-label="${t("切换深浅主题")}" title="${t("切换深浅主题")}">${icon("theme")}</button>`)}
    ${row("interface-language", t("界面语言"), `<select id="interface-language"><option value="auto">${t("跟随系统")}</option>${nativeNames.map(([value, name]) => `<option value="${value}">${name}</option>`).join("")}</select>`)}
    <div class="setting" id="text-rendering-row" hidden><span class="setting-text"><label for="text-rendering">${t("文字抗锯齿")}</label><small id="text-rendering-note"></small></span><select id="text-rendering"><option value="auto">${t("自动（高缩放屏用灰度）")}</option><option value="grayscale">${t("灰度")}</option><option value="subpixel">${t("彩色（ClearType）")}</option></select></div>`,
  )}
  ${page(
    "settings-tables",
    t("表格"),
    t("笔记与导出中表格的边框样式和宽度"),
    `
    ${row("table-style", t("表格风格"), `<select id="table-style"><option value="soft">${t("柔和卡片")}</option><option value="plain">${t("简洁横线")}</option><option value="grid">${t("经典网格")}</option></select>`)}
    ${row("table-width", t("表格宽度"), `<select id="table-width"><option value="auto">${t("自适应内容")}</option><option value="full">${t("铺满正文")}</option></select>`)}`,
  )}
  ${page(
    "settings-layout",
    t("布局与侧栏"),
    t("文件夹与目录位置、排除目录和侧栏字号"),
    `
    ${row("library-placement", t("文件夹浏览"), `<select id="library-placement"><option value="left">${t("左侧")}</option><option value="right">${t("右侧")}</option><option value="hidden">${t("隐藏")}</option></select>`)}
    ${row("outline-placement", t("本文目录"), `<select id="outline-placement"><option value="right">${t("右侧")}</option><option value="left">${t("左侧")}</option><option value="hidden">${t("隐藏")}</option></select>`)}
    ${row("outline-anchors", t("目录中的引用点"), `<select id="outline-anchors"><option value="off">${t("关")}</option><option value="referenced">${t("被引用的位置")}</option><option value="all">${t("所有锚点")}</option></select>`, t("定义、定理等用锚点标出的位置，以及被引用的次数"))}
    <div class="setting setting-list"><span class="setting-text"><span id="excluded-label">${t("不参与搜索的文件夹")}</span><small>${t("在笔记库中右键文件夹即可排除，适合实验输出、数据等不放笔记的文件夹")}</small></span></div>
    <ul id="excluded-folders" class="excluded-folders" aria-labelledby="excluded-label"></ul>
    <div class="layout-sample" aria-hidden="true"><span data-panel="library">${t("文件夹")}</span><span class="layout-page">${t("笔记")}</span><span data-panel="outline">${t("目录")}</span></div>
    ${row("navigation-size", t("文件夹与目录字号"), `<select id="navigation-size"><option value="10">10 px</option><option value="11">11 px</option><option value="12">12 px</option><option value="13">13 px</option><option value="14">14 px</option></select>`)}
    ${row("group-counts", t("折叠的分组显示标签数"), '<input id="group-counts" type="checkbox" class="switch">', t("关闭时只在悬停提示中显示"))}
    ${row("tab-size", t("标签页字号"), `<select id="tab-size"><option value="10">10 px</option><option value="11">11 px</option><option value="12">12 px</option><option value="13">13 px</option></select>`)}`,
  )}
  ${page(
    "settings-navigation",
    t("导航与滚动"),
    t("跳转范围、路径导航、链接预览与滚动方式"),
    `
    ${row("navigation-scope", t("导航范围"), `<select id="navigation-scope"><option value="all">${t("全部笔记")}</option><option value="current">${t("仅当前笔记")}</option></select>`)}
    ${row("show-breadcrumb", t("显示路径导航"), '<input id="show-breadcrumb" type="checkbox" class="switch">', t("在笔记与目录页上方显示所属笔记库与层级路径"))}
    ${row("history-buttons", t("前进 / 后退按钮"), `<select id="history-buttons"><option value="hidden">${t("隐藏")}</option><option value="visible">${t("显示")}</option></select>`, t("隐藏后仍可用鼠标侧键或 Alt+← / →"))}
    ${row("link-preview-mode", t("链接预览"), `<select id="link-preview-mode"><option value="hover">${t("悬停（克制，默认）")}</option><option value="ctrl">${t("按住 Ctrl 悬停")}</option><option value="off">${t("关")}</option></select>`, t("指针停留片刻才打开；按着鼠标或刚选过文字时不打开"))}
    ${row("smooth-scroll", t("平滑滚动"), `<select id="smooth-scroll"><option value="off">${t("关")}</option><option value="touchpad">${t("仅触控板")}</option><option value="all">${t("触控板、滚轮与滚动条")}</option></select>`, t("速度更均匀，跟手稍慢"))}`,
  )}
  ${page(
    "settings-export",
    t("导出"),
    t("导出独立 HTML 时的目录选项"),
    `
    ${row("export-toc", t("HTML 附带目录"), '<input id="export-toc" type="checkbox" class="switch">', t("在页面一侧列出标题，点击跳转；PDF 总是带书签"))}`,
  )}
  ${page(
    "settings-editing",
    t("编辑"),
    t("所见即所得编辑、源码栏与新笔记属性模板"),
    `
    ${row("rich-edit", t("在渲染后的正文里编辑"), '<input id="rich-edit" type="checkbox" class="switch">', t("编辑模式里直接在排好版的笔记上打字；公式、表格和链接都就地编辑"))}
    ${row("literal-typing", t("字面输入（自动转义）"), '<input id="literal-typing" type="checkbox" class="switch">', t("打出的 Markdown 符号按原样显示，写入文件时自动加反斜杠；关闭时像 Typora，打完 **粗体** 就变粗"))}
    ${row("edit-split", t("编辑模式显示源码栏"), '<input id="edit-split" type="checkbox" class="switch">', t("在正文旁同时显示 Markdown 源码，两边同步"))}
    ${row("new-note-properties", t("新笔记自带属性"), '<input id="new-note-properties" type="checkbox" class="switch">', t("在 Marklore 里新建的笔记按下面的模板写好属性"))}
    <div class="setting setting-list"><span class="setting-text"><label for="property-template">${t("默认属性")}</label><small>${t("每行一项“名称: 值”；{title} 为文件名，{date}、{time}、{datetime} 为当时的日期和时间。右键笔记“添加默认属性”也用它，已有的属性不变")}</small></span></div>
    <textarea id="property-template" class="property-template" rows="4" spellcheck="false"></textarea>
    ${row("stamp-modified", t("保存时更新修改时间"), '<input id="stamp-modified" type="checkbox" class="switch">', t("只改笔记已有的 modified 或 updated，沿用它原来的写法；不添加"))}`,
  )}
  ${page(
    "settings-annotation",
    t("批注"),
    t("阅读模式下划选文字的格式标注"),
    `
    ${row("reading-format", t("阅读模式中的格式栏"), '<input id="reading-format" type="checkbox" class="switch">', t("划选文字即可高亮、标色和加粗；Alt+双击跳到源码"))}`,
  )}
${aiSettingsMarkup}
${desktopSettingsMarkup}
  </div>
  </div>
</dialog>`;

export function applyAppearance(settings, typoLab = null) {
  const root = document.documentElement;
  const lab = typoLab
    ? typoLab.apply(settings)
    : { autoRule: "new", oldChineseFont: false, yahei: false };
  const effectiveTypeface = lab.yahei ? "yahei" : settings.typeface;
  root.dataset.typeface = effectiveTypeface;
  root.style.setProperty(
    "--typeface-scale",
    effectiveTypeface === "literata" ? "1" : "1.125",
  );
  root.dataset.readingStyle = settings.readingStyle || "standard";
  root.dataset.columnWidth = settings.columnWidth || "fixed";
  root.dataset.tableStyle = settings.tableStyle;
  root.dataset.tableWidth = settings.tableWidth;
  root.style.setProperty("--navigation-size", settings.navigationSize + "px");
  root.style.setProperty("--tab-size", settings.tabSize + "px");
  const targetWeight = readingWeight({
    weight: settings.weight,
    dpr: typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
    theme: settings.theme,
    autoRule: lab.autoRule,
  });
  const staticStack =
    effectiveTypeface === "yahei" ||
    effectiveTypeface === "classic" ||
    effectiveTypeface === "book";
  const staticCjk = staticStack || lab.oldChineseFont;
  const weight = staticCjk ? bodyFontWeight(targetWeight) : targetWeight;
  const boldWeight = emphasisWeight(staticCjk ? weight : targetWeight);
  root.style.setProperty("--note-weight", String(weight));
  root.style.setProperty("--note-wght", String(targetWeight));
  root.style.setProperty("--strong-weight", String(boldWeight));
  root.style.setProperty("--inline-code-weight", String(targetWeight));
  // Real font weights only. A weight jump should never make all math bold.
  root.style.setProperty("--heading-weight", String(boldWeight));
  $("#weight-note").textContent = staticCjk
    ? t("系统字体非可变字体，细微浓度不明显")
    : "";
  for (const [id, visible, side] of [
    ["library-panel", settings.sidebar, settings.librarySide],
    ["outline-panel", settings.outline, settings.outlineSide],
  ]) {
    const panel = $("#" + id),
      dock = $(side === "right" ? "#right-sidebar" : "#sidebar");
    if (panel.parentElement !== dock) dock.append(panel);
    panel.hidden = !visible;
  }
  for (const [id, side] of [
    ["sidebar-toggle", settings.librarySide],
    ["outline-toggle", settings.outlineSide],
  ]) {
    const button = $("#" + id),
      group = $("#panel-controls-" + side);
    if (button.parentElement !== group) group.append(button);
  }
  for (const dock of document.querySelectorAll(".dock")) {
    const visible = [...dock.children].filter((panel) => !panel.hidden);
    const hidden = visible.length === 0;
    if (dock.hidden && !hidden && dock.getAnimations().length) {
      // Reopening during the close transition would reverse nothing visible and
      // skip the slide-in. Settle the close (display:none) so @starting-style applies.
      for (const animation of dock.getAnimations()) animation.finish();
      getComputedStyle(dock).display;
    }
    dock.hidden = hidden;
    dock.dataset.stacked = String(visible.length > 1);
  }
  // For the styles that keep clear of the panel buttons: which docks are
  // closed, and how many buttons each corner holds.
  const workspace = $(".workspace");
  for (const side of ["left", "right"]) {
    workspace.dataset[side + "Dock"] = $(
      side === "right" ? "#right-sidebar" : "#sidebar",
    ).hidden
      ? "closed"
      : "open";
    workspace.dataset[side + "Buttons"] = String(
      $("#panel-controls-" + side).children.length,
    );
  }
  $("#sidebar-toggle").setAttribute("aria-expanded", String(settings.sidebar));
  $("#outline-toggle").setAttribute("aria-expanded", String(settings.outline));
  $("#typeface").value = settings.typeface;
  $("#reading-style").value = settings.readingStyle || "standard";
  $("#column-width").value = settings.columnWidth || "fixed";
  $("#table-style").value = settings.tableStyle;
  $("#table-width").value = settings.tableWidth;
  $("#navigation-scope").value = settings.navigationScope;
  $("#show-breadcrumb").checked = settings.showBreadcrumb;
  $("#history-buttons").value = settings.showHistoryButtons
    ? "visible"
    : "hidden";
  $("#smooth-scroll").value = settings.smoothScroll;
  $("#link-preview-mode").value = settings.linkPreview;
  $("#reading-format").checked = settings.readingFormat;
  $("#rich-edit").checked = settings.richEdit;
  $("#edit-split").checked = settings.editSplit;
  $("#literal-typing").checked = !settings.typeMarkdown;
  $("#new-note-properties").checked = settings.newNoteProperties;
  $("#stamp-modified").checked = settings.stampModified;
  // Not while it is being written in.
  if (document.activeElement !== $("#property-template"))
    $("#property-template").value = settings.propertyTemplate;
  $("#group-counts").checked = settings.groupCounts;
  $("#export-toc").checked = settings.exportToc;
  $("#outline-anchors").value = settings.outlineAnchors;
  // Folders left out of search and backlinks, each with a way back.
  const excluded = $("#excluded-folders");
  excluded.replaceChildren(
    ...(settings.searchExclude.length
      ? settings.searchExclude.map((folder) => {
          const item = document.createElement("li");
          item.dataset.path = folder;
          const name = document.createElement("span");
          name.textContent = folder;
          name.title = folder;
          const restore = document.createElement("button");
          restore.type = "button";
          restore.textContent = t("恢复");
          restore.setAttribute(
            "aria-label",
            t("恢复 {folder} 参与搜索", { folder }),
          );
          item.append(name, restore);
          return item;
        })
      : [
          Object.assign(document.createElement("li"), {
            className: "empty",
            textContent: t("没有排除的文件夹"),
          }),
        ]),
  );
  $("#interface-language").value = settings.language;
  $("#text-weight").value = String(settings.weight);
  $("#cjk-emphasis").checked = settings.cjkEmphasis;
  $("#navigation-size").value = String(settings.navigationSize);
  $("#tab-size").value = String(settings.tabSize);
  $("#library-placement").value = settings.sidebar
    ? settings.librarySide
    : "hidden";
  $("#outline-placement").value = settings.outline
    ? settings.outlineSide
    : "hidden";
  $("#color-theme").value = settings.theme;
  const sample = $(".layout-sample");
  sample.dataset.library = settings.sidebar ? settings.librarySide : "hidden";
  sample.dataset.outline = settings.outline ? settings.outlineSide : "hidden";
}

export function wireAppearance(
  change,
  { getSettings, typoLab = null, api = null, report = () => {} } = {},
) {
  const PAGE_STORAGE_KEY = "folio.settingsPage";
  const DEFAULT_PAGE = "settings-reading";
  const dialog = $("#appearance"),
    nav = dialog.querySelector(".settings-nav"),
    pane = dialog.querySelector(".settings-pane"),
    links = [...nav.querySelectorAll("button")],
    pages = [...pane.querySelectorAll(":scope > fieldset")],
    searchInput = $("#settings-search"),
    clearSearchBtn = $("#settings-search-clear"),
    resultsEl = $("#settings-search-results");
  const target = (id) => document.getElementById(id);
  const isAvailable = (fs) =>
    Boolean(
      fs &&
      (!fs.hasAttribute("data-desktop-only") ||
        fs.dataset.available === "true"),
    );
  const visibleLinks = () => links.filter((link) => !link.hidden);
  const readSavedPage = () => {
    try {
      return sessionStorage.getItem(PAGE_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  };
  const writeSavedPage = (id) => {
    try {
      sessionStorage.setItem(PAGE_STORAGE_KEY, id);
    } catch {}
  };

  let activePageId = readSavedPage() || DEFAULT_PAGE;
  let highlightTimer = 0;

  function syncAvailability() {
    for (const link of links)
      link.hidden = !isAvailable(target(link.dataset.section));
    if (!isAvailable(target(activePageId))) activePageId = DEFAULT_PAGE;
  }

  function applyCurrentPage({ scrollTop = true } = {}) {
    if (!isAvailable(target(activePageId))) activePageId = DEFAULT_PAGE;
    const searching = Boolean(searchInput.value.trim());
    for (const fs of pages) fs.hidden = searching || fs.id !== activePageId;
    resultsEl.hidden = !searching;
    for (const link of links) {
      if (link.dataset.section === activePageId)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (scrollTop) pane.scrollTop = 0;
  }

  function selectPage(id, { persist = true, scrollTop = true } = {}) {
    syncAvailability();
    activePageId = isAvailable(target(id)) ? id : DEFAULT_PAGE;
    if (persist) writeSavedPage(activePageId);
    applyCurrentPage({ scrollTop });
  }

  function focusPageControl(id) {
    const fs = target(id),
      ctrl = fs?.querySelector(
        "select:not([disabled]), input:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      );
    (ctrl || links.find((l) => l.dataset.section === id))?.focus();
  }

  function clearSearch({ restore = true } = {}) {
    searchInput.value = "";
    clearSearchBtn.hidden = true;
    resultsEl.replaceChildren();
    resultsEl.hidden = true;
    if (restore) applyCurrentPage({ scrollTop: true });
  }

  function rowText(settingRow) {
    const textWrap = settingRow.querySelector(".setting-text");
    if (!textWrap) return null;
    const nameEl =
      textWrap.querySelector("label") ||
      textWrap.querySelector(":scope > span:first-child");
    const smallEl = textWrap.querySelector("small");
    const name = (nameEl?.textContent || "").trim();
    const note = (smallEl?.textContent || "").trim();
    if (!name && !note) return null;
    return { name: name || note, note: name ? note : "" };
  }

  function highlightRow(settingRow) {
    for (const el of dialog.querySelectorAll(".setting-highlight"))
      el.classList.remove("setting-highlight");
    clearTimeout(highlightTimer);
    if (!settingRow) return;
    settingRow.scrollIntoView({ block: "nearest" });
    void settingRow.offsetWidth;
    settingRow.classList.add("setting-highlight");
    const focusable = settingRow.querySelector(
      "select:not([disabled]), input:not([disabled]), button:not([disabled]), textarea:not([disabled])",
    );
    focusable?.focus();
    highlightTimer = setTimeout(
      () => settingRow.classList.remove("setting-highlight"),
      1600,
    );
  }

  function renderSearch() {
    const raw = searchInput.value.trim();
    clearSearchBtn.hidden = !raw;
    if (!raw) {
      resultsEl.replaceChildren();
      applyCurrentPage({ scrollTop: true });
      return;
    }
    const query = raw.toLowerCase();
    syncAvailability();
    for (const fs of pages) fs.hidden = true;
    resultsEl.replaceChildren();
    let total = 0;
    for (const fs of pages) {
      if (!isAvailable(fs)) continue;
      const matches = [];
      for (const settingRow of fs.querySelectorAll(".setting")) {
        if (settingRow.hidden) continue;
        const info = rowText(settingRow);
        if (!info) continue;
        if (
          info.name.toLowerCase().includes(query) ||
          info.note.toLowerCase().includes(query)
        )
          matches.push({ settingRow, ...info });
      }
      if (!matches.length) continue;
      const group = document.createElement("section");
      group.className = "settings-search-group";
      const heading = document.createElement("h3");
      heading.className = "settings-search-group-title";
      heading.textContent = (
        fs.querySelector("legend")?.textContent || ""
      ).trim();
      const list = document.createElement("ul");
      list.className = "settings-search-list";
      for (const hit of matches) {
        total++;
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "settings-search-item";
        const title = document.createElement("span");
        title.textContent = hit.name;
        button.append(title);
        if (hit.note) {
          const small = document.createElement("small");
          small.textContent = hit.note;
          button.append(small);
        }
        button.onclick = () => {
          clearSearch({ restore: false });
          selectPage(fs.id);
          highlightRow(hit.settingRow);
        };
        item.append(button);
        list.append(item);
      }
      group.append(heading, list);
      resultsEl.append(group);
    }
    if (!total) {
      const empty = document.createElement("p");
      empty.className = "settings-search-empty";
      empty.textContent = t("没有找到匹配的设置");
      resultsEl.append(empty);
    }
    resultsEl.hidden = false;
    pane.scrollTop = 0;
  }

  function open(sectionId) {
    syncAvailability();
    const saved = sectionId || readSavedPage() || activePageId;
    clearSearch({ restore: false });
    selectPage(saved, { persist: Boolean(sectionId), scrollTop: true });
    void refreshTextRendering();
    if (!dialog.open) dialog.showModal();
  }

  syncAvailability();
  applyCurrentPage({ scrollTop: false });

  for (const link of links)
    link.onclick = () => {
      clearSearch({ restore: false });
      selectPage(link.dataset.section);
    };

  nav.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const shown = visibleLinks();
    if (!shown.length) return;
    const focused = document.activeElement;
    const currentIdx = shown.indexOf(focused);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIdx =
      currentIdx === -1
        ? delta > 0
          ? 0
          : shown.length - 1
        : (currentIdx + delta + shown.length) % shown.length;
    event.preventDefault();
    shown[nextIdx].focus();
  });

  dialog.addEventListener(
    "keydown",
    (event) => {
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey &&
        (event.key === "PageDown" || event.key === "PageUp")
      ) {
        const shown = visibleLinks();
        if (!shown.length) return;
        event.preventDefault();
        const idx = shown.findIndex((l) => l.dataset.section === activePageId);
        const delta = event.key === "PageDown" ? 1 : -1;
        const base = idx === -1 ? 0 : idx;
        const next = shown[(base + delta + shown.length) % shown.length];
        const inNav = Boolean(document.activeElement?.closest(".settings-nav"));
        clearSearch({ restore: false });
        selectPage(next.dataset.section);
        if (inNav) next.focus();
        else focusPageControl(activePageId);
      }
    },
    { capture: true },
  );

  searchInput.addEventListener("input", renderSearch);
  clearSearchBtn.onclick = () => {
    clearSearch();
    searchInput.focus();
  };

  $("#weight").onclick = () => {
    open();
    focusPageControl(activePageId);
  };
  dialog.addEventListener("folio:open-section", (event) => {
    open(event.detail);
  });
  dialog.addEventListener("folio:settings-availability", () => {
    syncAvailability();
    applyCurrentPage({ scrollTop: false });
  });
  $("#appearance-close").onclick = () => dialog.close();
  $("#typeface").onchange = (event) => change({ typeface: event.target.value });
  $("#reading-style").onchange = (event) =>
    change({ readingStyle: event.target.value });
  $("#column-width").onchange = (event) =>
    change({ columnWidth: event.target.value });
  $("#table-style").onchange = (event) =>
    change({ tableStyle: event.target.value });
  $("#table-width").onchange = (event) =>
    change({ tableWidth: event.target.value });
  $("#navigation-scope").onchange = (event) =>
    change({ navigationScope: event.target.value });
  $("#show-breadcrumb").onchange = (event) =>
    change({ showBreadcrumb: event.target.checked });
  $("#history-buttons").onchange = (event) =>
    change({ showHistoryButtons: event.target.value === "visible" });
  $("#edit-split").onchange = (event) =>
    change({ editSplit: event.target.checked });
  $("#literal-typing").onchange = (event) =>
    change({ typeMarkdown: !event.target.checked });
  $("#rich-edit").onchange = (event) =>
    change({ richEdit: event.target.checked });
  $("#new-note-properties").onchange = (event) =>
    change({ newNoteProperties: event.target.checked });
  $("#stamp-modified").onchange = (event) =>
    change({ stampModified: event.target.checked });
  $("#property-template").onchange = (event) =>
    change({ propertyTemplate: event.target.value.slice(0, 2000) });
  $("#reading-format").onchange = (event) =>
    change({ readingFormat: event.target.checked });
  $("#group-counts").onchange = (event) =>
    change({ groupCounts: event.target.checked });
  $("#export-toc").onchange = (event) =>
    change({ exportToc: event.target.checked });
  $("#smooth-scroll").onchange = (event) =>
    change({ smoothScroll: event.target.value });
  $("#link-preview-mode").onchange = (event) =>
    change({ linkPreview: event.target.value });
  $("#cjk-emphasis").onchange = (event) =>
    change({ cjkEmphasis: event.target.checked });
  $("#text-weight").onchange = (event) =>
    change({
      weight:
        event.target.value === "auto" ? "auto" : Number(event.target.value),
    });
  $("#reset-typography").onclick = () =>
    change({
      typeface: "literata",
      zoom: 100,
      weight: "auto",
      readingStyle: "standard",
      columnWidth: "fixed",
    });
  const trRow = $("#text-rendering-row"),
    trSelect = $("#text-rendering"),
    trNote = $("#text-rendering-note");
  const desiredTextRendering = (mode, scale) => {
    if (mode === "grayscale" || mode === "subpixel") return mode;
    return typeof scale === "number" && scale >= 2 ? "grayscale" : "subpixel";
  };
  const paintTextRendering = (state) => {
    if (!state || !trRow) return;
    trRow.hidden = false;
    const mode = ["auto", "grayscale", "subpixel"].includes(state.mode)
      ? state.mode
      : "auto";
    const effective =
      state.effective === "grayscale" ? "grayscale" : "subpixel";
    trSelect.value = mode;
    const desired = desiredTextRendering(mode, state.scale);
    const label =
      effective === "grayscale" ? t("灰度") : t("彩色（ClearType）");
    trNote.textContent =
      desired !== effective
        ? t("当前生效：{mode}；重启后生效", { mode: label })
        : t("当前生效：{mode}", { mode: label });
  };
  const refreshTextRendering = async () => {
    if (!api?.textRendering) return;
    try {
      paintTextRendering(await api.textRendering());
    } catch {}
  };
  if (api?.textRendering) {
    void refreshTextRendering();
    trSelect.onchange = async () => {
      const next = trSelect.value;
      trSelect.disabled = true;
      try {
        paintTextRendering(await api.setTextRendering(next));
      } catch (error) {
        report(error.message);
        await refreshTextRendering();
      } finally {
        trSelect.disabled = false;
      }
    };
  }
  typoLab?.mount(getSettings, change, { api });
  $("#color-theme").onchange = (event) => change({ theme: event.target.value });
  $("#interface-language").onchange = (event) =>
    change({ language: event.target.value });
  $("#outline-anchors").onchange = (event) =>
    change({ outlineAnchors: event.target.value });
  $("#excluded-folders").onclick = (event) => {
    const item = event.target.closest("button")?.closest("li[data-path]");
    if (!item) return;
    const remaining = [...item.parentElement.querySelectorAll("li[data-path]")]
      .filter((li) => li !== item)
      .map((li) => li.dataset.path);
    change({ searchExclude: remaining });
  };
  $("#navigation-size").onchange = (event) =>
    change({ navigationSize: Number(event.target.value) });
  $("#tab-size").onchange = (event) =>
    change({ tabSize: Number(event.target.value) });
  for (const [id, visibility, side] of [
    ["library-placement", "sidebar", "librarySide"],
    ["outline-placement", "outline", "outlineSide"],
  ])
    $("#" + id).onchange = (event) => {
      const value = event.target.value;
      change({
        [visibility]: value !== "hidden",
        ...(value === "hidden" ? {} : { [side]: value }),
      });
    };
}
