import { t } from "../desktop/i18n.mjs";
export const textColors = [
  [t("红色"), "#b23c36", "#ee9991"],
  [t("橙色"), "#9a511f", "#e7b182"],
  [t("绿色"), "#28704a", "#8dccaa"],
  [t("蓝色"), "#286ba0", "#8fc6ee"],
  [t("紫色"), "#7950a0", "#c5a7e8"],
  [t("灰色"), "#626965", "#b1bbb5"],
];
export const highlightColors = [
  [t("黄色"), "#f2d878", "#655628"],
  [t("桃色"), "#f3c69b", "#694c35"],
  [t("绿色"), "#bde0bf", "#355a40"],
  [t("蓝色"), "#bddcee", "#345369"],
  [t("紫色"), "#dcc8ee", "#574267"],
  [t("粉色"), "#efc4d1", "#69424f"],
];
export function highlightInk(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => {
      const c = parseInt(v, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#000000"
    : "#ffffff";
}
export function decorateTextColors(fragment) {
  const rgb = (hex) =>
    `rgb(${hex
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16))
      .join(", ")})`;
  for (const element of fragment.querySelectorAll("span[style],mark[style]")) {
    const highlight = element.tagName === "MARK",
      property = highlight ? "background-color" : "color";
    const colors = highlight ? highlightColors : textColors;
    const index = colors.findIndex(
      ([, value]) => element.style.getPropertyValue(property) === rgb(value),
    );
    if (index < 0) continue;
    element.style.setProperty(
      property,
      `var(--folio-${highlight ? "highlight" : "color"}-${index}, ${colors[index][1]})`,
    );
    if (highlight) element.style.color = "var(--folio-highlight-ink, #000000)";
  }
}
