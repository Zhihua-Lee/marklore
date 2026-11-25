import { t } from "../desktop/i18n.mjs";
import labCss from "./typo-lab.css?raw";

const ITEMS = [
  {
    key: "lineHeight",
    attr: "labLineHeight",
    label: t("行高：v0.6.4 1.7–1.8 ↔ 新 1.7"),
  },
  {
    key: "spacing",
    attr: "labSpacing",
    label: t("块距：v0.6.4 多套边距 ↔ 新 4 档节奏"),
  },
  {
    key: "headingScale",
    attr: "labHeadingScale",
    label: t("标题字阶：v0.6.4 1.85–0.95 ↔ 新 1.60–0.94"),
  },
  {
    key: "fluidSize",
    attr: "labFluidSize",
    label: t("宽屏字号：v0.6.4 固定 ↔ 新 1366→1920 渐大 9%"),
  },
  {
    key: "columnWidth",
    attr: "labColumnWidth",
    label: t("正文栏宽：v0.6.4 固定 680 px ↔ 新 当前栏宽"),
  },
  {
    key: "autoWeight",
    attr: "labAutoWeight",
    label: t("自动浓度：v0.6.4 恒为 400 ↔ 新 按屏幕 400/450"),
  },
  {
    key: "chineseFont",
    attr: "labChineseFont",
    label: t("中文字体：v0.6.4 系统字体 ↔ 新 内置思源黑体"),
  },
];

// Each switch stores true for "新" (default) and false for "v0.6.4".
export function normalizeLab(saved) {
  const out = {};
  for (const { key } of ITEMS) out[key] = saved?.[key] !== false;
  return out;
}

export function injectStyle() {
  if (document.getElementById("typo-lab-style")) return;
  const style = document.createElement("style");
  style.id = "typo-lab-style";
  style.textContent = labCss;
  document.head.append(style);
}

// The switches float beside the note (a modal Settings dialog would hide the
// very text being compared); Settings only opens them.
export function mount(settings, change) {
  injectStyle();
  const fieldset = document.getElementById("settings-reading");
  if (!fieldset || document.getElementById("typo-lab")) return;
  const row = document.createElement("div");
  row.className = "setting";
  row.innerHTML = `<span class="setting-text"><span>${t("排版对照（测试版）")}</span><small>${t("浮在正文旁，边拨开关边看笔记；Ctrl+Alt+L 开关")}</small></span><span class="setting-actions"><button id="typo-lab-open" type="button">${t("打开对照面板")}</button></span>`;
  fieldset.append(row);
  const section = document.createElement("aside");
  section.id = "typo-lab";
  section.className = "typo-lab";
  section.hidden = true;
  section.setAttribute("aria-label", t("排版对照（测试版）"));
  section.innerHTML = `<div class="typo-lab-head"><h3>${t("排版对照（测试版）")}</h3><span class="typo-lab-bulk"><button id="typo-lab-all-old" type="button">${t("全部旧")}</button><button id="typo-lab-all-new" type="button">${t("全部新")}</button><button id="typo-lab-close" type="button" aria-label="${t("关闭对照面板")}">×</button></span></div><p class="typo-lab-hint">${t("开 = 新，关 = v0.6.4")}</p>${ITEMS.map(
    ({ key, label }) => {
      // "行高：v0.6.4 … ↔ 新 …": the name on one line, the two values under it.
      const [name, values = ""] = label.split(/：|: /);
      return `<div class="setting"><label for="lab-${key}" class="typo-lab-label"><span>${name}</span><small>${values}</small></label><input id="lab-${key}" type="checkbox" class="switch" data-lab-key="${key}"></div>`;
    },
  ).join("")}`;
  document.body.append(section);
  const show = (open) => {
    section.hidden = !open;
    if (open) document.getElementById("appearance")?.close();
  };
  row.querySelector("#typo-lab-open").onclick = () => show(true);
  section.querySelector("#typo-lab-close").onclick = () => show(false);
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.altKey && event.code === "KeyL") {
      event.preventDefault();
      show(section.hidden);
    }
  });

  const update = (patch) => {
    const next = { ...normalizeLab(settings()), ...patch };
    change({ typoLab: next });
  };
  for (const input of section.querySelectorAll("input[data-lab-key]")) {
    input.onchange = () => update({ [input.dataset.labKey]: input.checked });
  }
  section.querySelector("#typo-lab-all-old").onclick = () =>
    change({
      typoLab: Object.fromEntries(ITEMS.map(({ key }) => [key, false])),
    });
  section.querySelector("#typo-lab-all-new").onclick = () =>
    change({
      typoLab: Object.fromEntries(ITEMS.map(({ key }) => [key, true])),
    });
}

export function apply(settings) {
  injectStyle();
  const state = normalizeLab(settings?.typoLab);
  const root = document.documentElement;
  for (const { key, attr } of ITEMS) {
    if (state[key]) delete root.dataset[attr];
    else root.dataset[attr] = "old";
    const input = document.getElementById("lab-" + key);
    if (input) input.checked = state[key];
  }
  return {
    autoRule: state.autoWeight ? "new" : "v064",
    oldChineseFont: !state.chineseFont,
  };
}
