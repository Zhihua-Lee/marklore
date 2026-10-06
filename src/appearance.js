import { t } from "../desktop/i18n.mjs";
import { icon } from "./icons.js";
import { readingWeight } from "./typography.js";
import { desktopSettingsMarkup } from "./desktop-settings.js";
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
// Settings: a fixed title bar (changes apply at once; close with × or Esc),
// section links on the left, one scrolling pane on the right.
const sections = [
  ["settings-reading", t("阅读排版")],
  ["settings-theme", t("主题与语言")],
  ["settings-tables", t("表格")],
  ["settings-layout", t("布局与侧栏")],
  ["settings-navigation", t("导航与滚动")],
  ["settings-annotation", t("批注")],
  ["desktop-settings", t("后台与系统")],
];
export const appearanceMarkup = `
<dialog id="appearance" aria-labelledby="appearance-title">
  <header class="settings-title"><h2 id="appearance-title">${t("设置")}</h2><button id="appearance-close" class="icon" aria-label="${t("关闭设置")}" title="${t("关闭 Esc")}">${icon("close")}</button></header>
  <div class="settings-body">
  <nav class="settings-nav" aria-label="${t("设置分类")}">${sections.map(([id, label]) => `<button type="button" data-section="${id}">${label}</button>`).join("")}</nav>
  <div class="settings-pane">
  <fieldset id="settings-reading"><legend>${t("阅读排版")}</legend>
    ${row("typeface", t("正文字体"), `<select id="typeface"><option value="literata">${t("Literata / 思源黑体")}</option><option value="balanced">${t("思源黑体")}</option><option value="classic">${t("Arial / 微软雅黑")}</option><option value="book">${t("Cambria / 宋体")}</option></select>`)}
    <div class="setting"><span class="setting-text"><span>${t("字号")}</span></span><div class="zoom-control" role="group" aria-label="${t("字号")}"><button id="zoom-out" aria-label="${t("缩小字号")}">${icon("minus")}</button><button id="zoom-reset" title="${t("重置字号")}">100%</button><button id="zoom-in" aria-label="${t("放大字号")}">${icon("plus")}</button></div></div>
    ${row("text-weight", t("正文浓度"), `<select id="text-weight"><option value="auto">${t("自然")}</option><option value="400">${t("标准")}</option><option value="450">${t("适中")}</option><option value="500">${t("较浓")}</option><option value="600">${t("浓")}</option></select>`)}
    <div class="setting"><span class="setting-text"><span>${t("书页排版")}</span><small>${t("Literata 与自然浓度，保留字号和布局")}</small></span><span class="setting-actions"><button id="reading-preset" type="button">${t("恢复")}</button></span></div>
  </fieldset>
  <fieldset id="settings-theme"><legend>${t("主题与语言")}</legend>
    ${row("color-theme", t("界面颜色"), `<select id="color-theme"><option value="light">${t("浅色")}</option><option value="dark">${t("深色")}</option></select><button id="theme" class="icon" aria-label="${t("切换深浅主题")}" title="${t("切换深浅主题")}">${icon("theme")}</button>`)}
    ${row("interface-language", t("界面语言"), `<select id="interface-language"><option value="auto">${t("跟随系统")}</option>${nativeNames.map(([value, name]) => `<option value="${value}">${name}</option>`).join("")}</select>`)}
  </fieldset>
  <fieldset id="settings-tables"><legend>${t("表格")}</legend>
    ${row("table-style", t("表格风格"), `<select id="table-style"><option value="soft">${t("柔和卡片")}</option><option value="plain">${t("简洁横线")}</option><option value="grid">${t("经典网格")}</option></select>`)}
    ${row("table-width", t("表格宽度"), `<select id="table-width"><option value="auto">${t("自适应内容")}</option><option value="full">${t("铺满正文")}</option></select>`)}
  </fieldset>
  <fieldset id="settings-layout"><legend>${t("布局与侧栏")}</legend>
    ${row("library-placement", t("文件夹浏览"), `<select id="library-placement"><option value="left">${t("左侧")}</option><option value="right">${t("右侧")}</option><option value="hidden">${t("隐藏")}</option></select>`)}
    ${row("outline-placement", t("本文目录"), `<select id="outline-placement"><option value="right">${t("右侧")}</option><option value="left">${t("左侧")}</option><option value="hidden">${t("隐藏")}</option></select>`)}
    ${row("outline-anchors", t("目录中的引用点"), `<select id="outline-anchors"><option value="off">${t("关")}</option><option value="referenced">${t("被引用的位置")}</option><option value="all">${t("所有锚点")}</option></select>`, t("定义、定理等用锚点标出的位置，以及被引用的次数"))}
    <div class="setting setting-list"><span class="setting-text"><span id="excluded-label">${t("不参与搜索的文件夹")}</span><small>${t("在笔记库中右键文件夹即可排除，适合实验输出、数据等不放笔记的文件夹")}</small></span></div>
    <ul id="excluded-folders" class="excluded-folders" aria-labelledby="excluded-label"></ul>
    <div class="layout-sample" aria-hidden="true"><span data-panel="library">${t("文件夹")}</span><span class="layout-page">${t("笔记")}</span><span data-panel="outline">${t("目录")}</span></div>
    ${row("navigation-size", t("文件夹与目录字号"), `<select id="navigation-size"><option value="10">10 px</option><option value="11">11 px</option><option value="12">12 px</option><option value="13">13 px</option><option value="14">14 px</option></select>`)}
    ${row("tab-size", t("标签页字号"), `<select id="tab-size"><option value="10">10 px</option><option value="11">11 px</option><option value="12">12 px</option><option value="13">13 px</option></select>`)}
  </fieldset>
  <fieldset id="settings-navigation"><legend>${t("导航与滚动")}</legend>
    ${row("navigation-scope", t("导航范围"), `<select id="navigation-scope"><option value="all">${t("全部笔记")}</option><option value="current">${t("仅当前笔记")}</option></select>`)}
    ${row("history-buttons", t("前进 / 后退按钮"), `<select id="history-buttons"><option value="hidden">${t("隐藏")}</option><option value="visible">${t("显示")}</option></select>`, t("隐藏后仍可用鼠标侧键或 Alt+← / →"))}
    ${row("smooth-scroll", t("平滑滚动"), `<select id="smooth-scroll"><option value="off">${t("关")}</option><option value="touchpad">${t("仅触控板")}</option><option value="all">${t("触控板、滚轮与滚动条")}</option></select>`, t("速度更均匀，跟手稍慢"))}
  </fieldset>
  <fieldset id="settings-annotation"><legend>${t("批注")}</legend>
    ${row("reading-format", t("阅读模式中的格式栏"), '<input id="reading-format" type="checkbox" class="switch">', t("划选文字即可高亮、标色和加粗；Alt+双击跳到源码"))}
  </fieldset>
${desktopSettingsMarkup}
  </div>
  </div>
</dialog>`;

export function applyAppearance(settings) {
  const root = document.documentElement;
  root.dataset.typeface = settings.typeface;
  root.dataset.tableStyle = settings.tableStyle;
  root.dataset.tableWidth = settings.tableWidth;
  root.style.setProperty("--navigation-size", settings.navigationSize + "px");
  root.style.setProperty("--tab-size", settings.tabSize + "px");
  const weight = readingWeight(settings);
  root.style.setProperty("--note-weight", String(weight));
  root.style.setProperty(
    "--strong-weight",
    String(Math.max(600, weight + 100)),
  );
  root.style.setProperty("--inline-code-weight", String(weight));
  // Real font weights only. A weight jump should never make all math bold.
  root.style.setProperty(
    "--heading-weight",
    String(Math.max(600, weight + 100)),
  );
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
  $("#sidebar-toggle").setAttribute("aria-expanded", String(settings.sidebar));
  $("#outline-toggle").setAttribute("aria-expanded", String(settings.outline));
  $("#typeface").value = settings.typeface;
  $("#table-style").value = settings.tableStyle;
  $("#table-width").value = settings.tableWidth;
  $("#navigation-scope").value = settings.navigationScope;
  $("#history-buttons").value = settings.showHistoryButtons
    ? "visible"
    : "hidden";
  $("#smooth-scroll").value = settings.smoothScroll;
  $("#reading-format").checked = settings.readingFormat;
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

export function wireAppearance(change) {
  const dialog = $("#appearance"),
    pane = dialog.querySelector(".settings-pane"),
    links = [...dialog.querySelectorAll(".settings-nav button")];
  const target = (link) => document.getElementById(link.dataset.section);
  // A link the reader clicked stays current while its section is in view,
  // although short sections near the end cannot scroll to the top; the
  // reader's own scrolling hands the choice back to the position.
  let chosen = null;
  // The link of the section at the top of the pane is marked current.
  function mark() {
    const top = pane.getBoundingClientRect().top + 24;
    let current = links.find((link) => !link.hidden);
    for (const link of links)
      if (!link.hidden && target(link).getBoundingClientRect().top <= top)
        current = link;
    // At the very end, the last section is current even if it is short.
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2)
      current = links.filter((link) => !link.hidden).at(-1);
    if (chosen) {
      const box = target(chosen).getBoundingClientRect(),
        view = pane.getBoundingClientRect();
      if (box.top < view.bottom && box.bottom > view.top) current = chosen;
    }
    for (const link of links)
      link.setAttribute("aria-current", String(link === current));
  }
  function open() {
    // Background & system exists only in the desktop app.
    for (const link of links) link.hidden = target(link).hidden;
    if (!dialog.open) dialog.showModal();
    mark();
  }
  for (const link of links)
    link.onclick = () => {
      chosen = link;
      pane.scrollTo({ top: target(link).offsetTop - 12 });
      mark();
    };
  pane.addEventListener("scroll", mark, { passive: true });
  for (const event of ["wheel", "keydown", "pointerdown", "touchstart"])
    pane.addEventListener(event, () => (chosen = null), { passive: true });
  $("#weight").onclick = () => {
    chosen = null;
    open();
    pane.scrollTop = 0;
    mark();
    $("#typeface").focus();
  };
  dialog.addEventListener("folio:open-section", (event) => {
    open();
    target({ dataset: { section: event.detail } })?.scrollIntoView({
      block: "start",
    });
    mark();
  });
  $("#appearance-close").onclick = () => dialog.close();
  $("#typeface").onchange = (event) => change({ typeface: event.target.value });
  $("#table-style").onchange = (event) =>
    change({ tableStyle: event.target.value });
  $("#table-width").onchange = (event) =>
    change({ tableWidth: event.target.value });
  $("#navigation-scope").onchange = (event) =>
    change({ navigationScope: event.target.value });
  $("#history-buttons").onchange = (event) =>
    change({ showHistoryButtons: event.target.value === "visible" });
  $("#reading-format").onchange = (event) =>
    change({ readingFormat: event.target.checked });
  $("#smooth-scroll").onchange = (event) =>
    change({ smoothScroll: event.target.value });
  $("#text-weight").onchange = (event) =>
    change({
      weight:
        event.target.value === "auto" ? "auto" : Number(event.target.value),
    });
  $("#reading-preset").onclick = () =>
    change({ typeface: "literata", weight: "auto" });
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
