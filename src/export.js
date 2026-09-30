import { t } from "../desktop/i18n.mjs";
import { renderMarkdown, loadMath, mayContainMath } from "./markdown.js";
import { loadHighlighter, mayContainCode } from "./highlighting.js";
import { renderDiagrams } from "./diagrams.js";
import exportCSS from "./export.css?raw";
import tableCSS from "./tables.css?raw";
import katexCSS from "katex/dist/katex.min.css?raw";
import literataCSS from "@fontsource-variable/literata/standard.css?raw";
import literataItalicCSS from "@fontsource-variable/literata/standard-italic.css?raw";
import monoCSS from "@fontsource-variable/jetbrains-mono/index.css?raw";
import monoItalicCSS from "@fontsource-variable/jetbrains-mono/wght-italic.css?raw";

async function completeDiagrams(host) {
  const blocks = [...host.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return;
  await new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(Error(t("图表仍在渲染，请稍后再次导出")));
    }, 15000);
    function check() {
      if (
        !blocks.every(
          (code) => code.parentElement.dataset.diagramTheme === "light",
        )
      )
        return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    }
    observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    renderDiagrams(host, "light", check);
  });
}

export async function exportNote(format, { doc }) {
  if (!window.folio?.exportNote) throw Error(t("请在桌面版中导出笔记"));
  if (!doc || !["pdf", "html"].includes(format))
    throw Error(t("没有可导出的笔记"));
  const host = document.createElement("article");
  host.style.cssText =
    "position:fixed;left:-20000px;top:0;width:760px;visibility:hidden;pointer-events:none";
  host.setAttribute("aria-hidden", "true");
  await Promise.all([
    mayContainMath(doc.text) && loadMath(),
    mayContainCode(doc.text) && loadHighlighter(),
  ]);
  host.innerHTML = renderMarkdown(doc.text, doc.fileId).html;
  document.body.append(host);
  try {
    await completeDiagrams(host);
    for (const button of host.querySelectorAll("button, .section-summary"))
      button.remove();
    for (const block of host.querySelectorAll(".code-block"))
      block.replaceWith(block.querySelector("pre"));
    for (const details of host.querySelectorAll("details")) details.open = true;
    const tableStyle = ["soft", "plain", "grid"].includes(
      document.documentElement.dataset.tableStyle,
    )
      ? document.documentElement.dataset.tableStyle
      : "soft";
    for (const table of host.querySelectorAll(".table-scroll")) {
      table.classList.add("folio-table-" + tableStyle);
      if (document.documentElement.dataset.tableWidth === "full")
        table.classList.add("folio-table-full");
      table.removeAttribute("tabindex");
    }
    for (const element of host.querySelectorAll("*")) {
      element.classList.remove("collapsed", "located");
      for (const attribute of [...element.attributes])
        if (
          attribute.name.startsWith("data-") ||
          attribute.name.startsWith("on")
        )
          element.removeAttribute(attribute.name);
    }
    const images = [],
      warnings = [];
    for (const image of host.querySelectorAll("img")) {
      const source = image.getAttribute("src") || "";
      if (source.startsWith("folio-asset:")) {
        const url = new URL(source),
          key = crypto.randomUUID();
        if (url.hostname !== doc.fileId) throw Error(t("图片不属于当前笔记"));
        images.push({ key, path: url.searchParams.get("path") || "" });
        image.setAttribute("src", "folio-export-image:" + key);
      } else if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(source)) {
        const label =
          image.alt || t("有一张图片无法嵌入（远程图片不联网下载）");
        const placeholder = document.createElement("span");
        placeholder.textContent = label;
        placeholder.className = "export-image-note";
        image.replaceWith(placeholder);
        warnings.push(label);
      }
      image.removeAttribute("loading");
      image.removeAttribute("decoding");
    }
    const typeface = document.documentElement.dataset.typeface;
    const family =
      typeface === "literata"
        ? '"Literata Variable","Noto Sans SC","Microsoft YaHei",serif'
        : typeface === "classic"
          ? 'Arial,"Microsoft YaHei",sans-serif'
          : typeface === "book"
            ? "Cambria,SimSun,serif"
            : '"Noto Sans SC","Microsoft YaHei",sans-serif';
    const weight = Number(
      document.documentElement.style.getPropertyValue("--note-weight"),
    );
    warnings.push(
      ...[...host.querySelectorAll(".math-error,.diagram-error")].map(
        (element) => element.textContent,
      ),
    );
    return await window.folio.exportNote({
      format,
      name: doc.name,
      fileId: doc.fileId || null,
      html: host.innerHTML,
      css:
        katexCSS +
        "\n" +
        (typeface === "literata" ? literataCSS + literataItalicCSS : "") +
        monoCSS +
        monoItalicCSS +
        "\n" +
        exportCSS +
        tableCSS +
        `\nbody{font-family:${family};font-weight:${[400, 450, 500, 600].includes(weight) ? weight : 400}} strong{font-weight:${Math.max(600, weight + 100)}}`,
      images,
      warnings,
    });
  } finally {
    host.remove();
  }
}
