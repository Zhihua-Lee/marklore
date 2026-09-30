// Interface language, shared by the main process and the renderer (plain
// module, no Node APIs). The Chinese source text is the key: t("打开文件") is
// "打开文件" in Chinese and its entry in locales/en.mjs in English. Values fill
// {name} placeholders: t("关闭 {name}", { name }).
import en from "./locales/en.mjs";

const dictionaries = { en };
let current = "zh";

export const LANGUAGES = ["zh", "en"];

// A stored choice wins; "auto" (or none) follows the system locale.
export function resolveLanguage(choice, systemLocale = "") {
  if (LANGUAGES.includes(choice)) return choice;
  return /^zh\b/i.test(String(systemLocale)) ? "zh" : "en";
}

export function setLanguage(language) {
  current = LANGUAGES.includes(language) ? language : "zh";
}

export const getLanguage = () => current;

export function t(text, values) {
  const out = (current !== "zh" && dictionaries[current][text]) || text;
  return values
    ? out.replace(/\{(\w+)\}/g, (match, key) =>
        key in values ? String(values[key]) : match,
      )
    : out;
}
