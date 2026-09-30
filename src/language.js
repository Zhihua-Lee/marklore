// Fixes the interface language before any module builds its markup: app.js
// imports this module first. The desktop app asks main, which resolved the
// stored choice (Aa → 界面语言) against the system locale before the window
// opened; the browser demo follows the browser, or a choice kept in
// localStorage. Changing the language reloads the page.
import { setLanguage, resolveLanguage } from "../desktop/i18n.mjs";

function storedChoice() {
  try {
    return localStorage.getItem("folio-language");
  } catch {
    return null;
  }
}

const language =
  window.folio?.language || resolveLanguage(storedChoice(), navigator.language);
setLanguage(language);
document.documentElement.lang = language === "en" ? "en" : "zh-CN";

export { language };
