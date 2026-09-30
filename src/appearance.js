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

// Settings: a fixed title bar (changes apply at once; close with × or Esc),
// section links on the left, one scrolling pane on the right.
const sections = [
  ["settings-reading", t("阅读排版")],
  ["settings-theme", t("主题与语言")],
  ["settings-tables", t("表格")],
  ["settings-layout", t("布局与侧栏")],
  ["settings-navigation", t("导航与滚动")],
  ["desktop-settings", t("后台与系统")],
];
export const appearanceMarkup = `
<dialog id="appearance" aria-labelledby="appearance-title">
  <header class="settings-title"><h2 id="appearance-title">${t("设置")}</h2><span class="settings-note">${t("更改立即生效")}</span><button id="appearance-close" class="icon" aria-label="${t("关闭设置")}" title="${t("关闭 Esc")}">${icon("close")}</button></header>
  <div class="settings-body">
  <nav class="settings-nav" aria-label="${t("设置分类")}">${sections.map(([id, label]) => `<button type="button" data-section="${id}">${label}</button>`).join("")}</nav>
  <div class="settings-pane">
  <fieldset id="settings-reading"><legend>${t("阅读排版")}</legend>
    <label for="typeface">${t("正文字体")}<select id="typeface"><option value="literata">${t("Literata / 思源黑体")}</option><option value="balanced">${t("思源黑体")}</option><option value="classic">${t("Arial / 微软雅黑")}</option><option value="book">${t("Cambria / 宋体")}</option></select></label>
    <div class="setting-row"><span>${t("字号")}</span><div class="zoom-control" role="group" aria-label="${t("字号")}"><button id="zoom-out" aria-label="${t("缩小字号")}">${icon("minus")}</button><button id="zoom-reset" title="${t("重置字号")}">100%</button><button id="zoom-in" aria-label="${t("放大字号")}">${icon("plus")}</button></div></div>
    <label for="text-weight">${t("正文浓度")}<select id="text-weight"><option value="auto">${t("自然")}</option><option value="400">${t("标准")}</option><option value="450">${t("适中")}</option><option value="500">${t("较浓")}</option><option value="600">${t("浓")}</option></select></label>
    <button id="reading-preset" type="button">${t("恢复书页排版")}</button>
    <p class="setting-hint">${t("Literata 与代码字体已内置；中文使用本机字体。公式保留专用字体和粗斜体含义。")}</p>
  </fieldset>
  <fieldset id="settings-theme"><legend>${t("主题与语言")}</legend>
    <label for="color-theme">${t("界面颜色")}<select id="color-theme"><option value="light">${t("浅色")}</option><option value="dark">${t("深色")}</option></select><button id="theme" class="icon" aria-label="${t("切换深浅主题")}" title="${t("切换深浅主题")}">${icon("theme")}</button></label>
    <label for="interface-language">${t("界面语言")}<select id="interface-language"><option value="auto">${t("跟随系统")}</option>${nativeNames.map(([value, name]) => `<option value="${value}">${name}</option>`).join("")}</select></label></fieldset>
  <fieldset id="settings-tables"><legend>${t("表格")}</legend>
    <label for="table-style">${t("表格风格")}<select id="table-style"><option value="soft">${t("柔和卡片")}</option><option value="plain">${t("简洁横线")}</option><option value="grid">${t("经典网格")}</option></select></label>
    <label for="table-width">${t("表格宽度")}<select id="table-width"><option value="auto">${t("自适应内容")}</option><option value="full">${t("铺满正文")}</option></select></label>
  </fieldset>
  <fieldset id="settings-layout"><legend>${t("布局与侧栏")}</legend>
    <label for="navigation-size">${t("文件夹与目录字号")}<select id="navigation-size"><option value="10">10 px</option><option value="11">11 px</option><option value="12">12 px</option><option value="13">13 px</option><option value="14">14 px</option></select></label>
    <label for="tab-size">${t("标签页字号")}<select id="tab-size"><option value="10">10 px</option><option value="11">11 px</option><option value="12">12 px</option><option value="13">13 px</option></select></label>
    <label for="library-placement">${t("文件夹浏览")}<select id="library-placement"><option value="left">${t("左侧")}</option><option value="right">${t("右侧")}</option><option value="hidden">${t("隐藏")}</option></select></label>
    <label for="outline-placement">${t("本文目录")}<select id="outline-placement"><option value="right">${t("右侧")}</option><option value="left">${t("左侧")}</option><option value="hidden">${t("隐藏")}</option></select></label>
    <div class="layout-sample" aria-hidden="true"><span data-panel="library">${t("文件夹")}</span><span class="layout-page">${t("笔记")}</span><span data-panel="outline">${t("目录")}</span></div>
  </fieldset>
  <fieldset id="settings-navigation"><legend>${t("导航与滚动")}</legend>
    <label for="navigation-scope">${t("导航范围")}<select id="navigation-scope"><option value="all">${t("全部笔记")}</option><option value="current">${t("仅当前笔记")}</option></select></label>
    <label for="history-buttons">${t("前进 / 后退按钮")}<select id="history-buttons"><option value="hidden">${t("隐藏")}</option><option value="visible">${t("显示")}</option></select></label>
    <label for="smooth-scroll" title="${t("由 Folio 按屏幕刷新逐帧移动页面，速度更均匀，跟手稍慢 1–3 帧")}">${t("平滑滚动")}<select id="smooth-scroll"><option value="off">${t("关")}</option><option value="touchpad">${t("仅触控板")}</option><option value="all">${t("触控板、滚轮与滚动条")}</option></select></label>
    <p class="setting-hint">${t("鼠标侧键或 Alt+← / → 返回阅读位置；隐藏按钮不影响快捷键。")}</p>
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
      pane.scrollTo({ top: target(link).offsetTop - 12 });
      mark();
    };
  pane.addEventListener("scroll", mark, { passive: true });
  $("#weight").onclick = () => {
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
