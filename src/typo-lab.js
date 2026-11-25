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

export function mount(settings, change) {
  injectStyle();
  const fieldset = document.getElementById("settings-reading");
  if (!fieldset || document.getElementById("typo-lab")) return;
  const section = document.createElement("section");
  section.id = "typo-lab";
  section.className = "typo-lab";
  section.innerHTML = `<div class="typo-lab-head"><h3>${t("排版对照（测试版）")}</h3><span class="typo-lab-bulk"><button id="typo-lab-all-old" type="button">${t("全部旧")}</button><button id="typo-lab-all-new" type="button">${t("全部新")}</button></span></div>${ITEMS.map(
    ({ key, label }) =>
      `<div class="setting"><span class="setting-text"><label for="lab-${key}">${label}</label></span><input id="lab-${key}" type="checkbox" class="switch" data-lab-key="${key}"></div>`,
  ).join("")}`;
  fieldset.append(section);

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
