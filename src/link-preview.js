import { t } from "../desktop/i18n.mjs";
import { renderMarkdown, loadMath, mayContainMath } from "./markdown.js";
import { loadHighlighter, mayContainCode } from "./highlighting.js";
import { renderDiagrams } from "./diagrams.js";
import { restoreAnchor, visibleAnchor, unfold } from "./positions.js";
import { setSectionCollapsed } from "./sections.js";
import { wireCodeBlocks } from "./code-blocks.js";
import { icon } from "./icons.js";
import { watchTableLayout } from "./table-layout.js";
import "./link-preview.css";

export function splitLink(href) {
  const index = href.indexOf("#");
  return {
    target: index < 0 ? href : href.slice(0, index),
    anchor: index < 0 ? "" : decodeURIComponent(href.slice(index + 1)),
  };
}
function eligible(href) {
  try {
    const { target } = splitLink(href);
    return (
      (!target && href.startsWith("#")) ||
      (!/^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(target) &&
        /\.(md|markdown|mdown|mkd|txt)$/i.test(decodeURIComponent(target)))
    );
  } catch {
    return false;
  }
}

// Independent transient surface: never changes the active tab, editor or progress.
export function createLinkPreview({
  host,
  load,
  navigate,
  report,
  getZoom = () => 100,
  saveZoom = () => {},
}) {
  const card = document.createElement("section");
  card.id = "link-preview";
  card.role = "dialog";
  card.setAttribute("aria-label", t("链接预览"));
  card.tabIndex = -1;
  card.hidden = true;
  card.innerHTML = `<header class="preview-heading"><div><strong class="preview-title"></strong><div class="preview-path"></div></div><button class="preview-open">${t("打开 ↗")}</button><button class="preview-close icon" aria-label="${t("关闭链接预览")}">${icon("close")}</button></header><div class="preview-status" role="status"></div><div class="preview-scroll" tabindex="0" aria-label="${t("链接预览正文")}"><article class="prose"></article></div><footer class="preview-help"><span>${t("F2 进入 · Esc 关闭")}</span><div class="preview-zoom" role="group" aria-label="${t("预览字号")}"><button data-zoom="-10" aria-label="${t("缩小预览字号")}">A−</button><button data-zoom="0" aria-label="${t("重置预览字号")}">100%</button><button data-zoom="10" aria-label="${t("放大预览字号")}">A+</button></div></footer>`;
  document.body.append(card);
  const title = card.querySelector(".preview-title"),
    path = card.querySelector(".preview-path"),
    status = card.querySelector(".preview-status"),
    scroller = card.querySelector(".preview-scroll"),
    article = card.querySelector("article");
  wireCodeBlocks(article, report);
  watchTableLayout(article, scroller);
  function applyZoom() {
    const zoom = Math.max(50, Math.min(200, Number(getZoom()) || 100));
    card.style.setProperty("--note-size", (16 * zoom) / 100 + "px");
    card.querySelector('[data-zoom="0"]').textContent = zoom + "%";
    card.querySelector('[data-zoom="-10"]').disabled = zoom <= 50;
    card.querySelector('[data-zoom="10"]').disabled = zoom >= 200;
  }
  for (const button of card.querySelectorAll("[data-zoom]"))
    button.onclick = () => {
      const anchor = visibleAnchor(scroller),
        delta = Number(button.dataset.zoom);
      positioned = true;
      saveZoom(
        delta === 0 ? 100 : Math.max(50, Math.min(200, getZoom() + delta)),
      );
      applyZoom();
      requestAnimationFrame(() => restoreAnchor(scroller, anchor));
    };
  let origin = null,
    timer,
    leaveTimer,
    generation = 0,
    source = null,
    href = "",
    positioned = false,
    alignment = null;
  function hide({ focus = false } = {}) {
    generation++;
    clearTimeout(timer);
    clearTimeout(leaveTimer);
    const previous = origin;
    origin = null;
    source = null;
    alignment = null;
    card.hidden = true;
    article.replaceChildren();
    if (previous) {
      previous.removeAttribute("aria-controls");
      previous.removeAttribute("aria-expanded");
    }
    if (focus && previous?.isConnected) {
      // Focus first, then cancel the focus-triggered reopen.
      previous.focus({ preventScroll: true });
      clearTimeout(timer);
      origin = null;
    }
  }
  let placedAt = null;
  function place() {
    if (!origin) return;
    const r = origin.getBoundingClientRect();
    placedAt = { top: r.top, left: r.left };
    const height = Math.min(440, innerHeight - 24);
    const below = innerHeight - r.bottom - 20;
    const above = r.top - 20;
    const down = below >= Math.min(240, height) || below >= above;
    const available = Math.min(height, Math.max(140, down ? below : above));
    card.style.height = available + "px";
    card.style.left =
      Math.max(
        12,
        Math.min(r.left, innerWidth - Math.min(580, innerWidth - 24) - 12),
      ) + "px";
    card.style.top =
      Math.max(
        12,
        Math.min(
          innerHeight - available - 12,
          down ? r.bottom + 8 : r.top - available - 8,
        ),
      ) + "px";
  }
  function align() {
    if (!positioned && alignment && !card.hidden) alignment();
  }
  async function show(link, token) {
    if (origin !== link || token !== generation || !link.isConnected) return;
    href = link.getAttribute("href") || "";
    source = null;
    positioned = false;
    title.textContent = t("链接预览");
    path.textContent = splitLink(href).target || t("当前笔记");
    status.textContent = t("正在读取…");
    article.replaceChildren();
    scroller.scrollTop = 0;
    card.hidden = false;
    applyZoom();
    link.setAttribute("aria-controls", card.id);
    link.setAttribute("aria-expanded", "true");
    place();
    try {
      const doc = await load(href);
      if (token !== generation || origin !== link) return;
      if (!link.isConnected) return hide();
      source = doc;
      title.textContent = doc.name;
      path.textContent = doc.path || t("未保存的笔记");
      path.title = path.textContent;
      status.textContent = doc.draft
        ? t("当前编辑草稿 · 未保存")
        : t("当前文件内容");
      if (mayContainMath(doc.text) || mayContainCode(doc.text)) {
        await Promise.all([
          mayContainMath(doc.text) && loadMath(),
          mayContainCode(doc.text) && loadHighlighter(),
        ]);
        if (token !== generation || origin !== link) return;
        if (!link.isConnected) return hide();
      }
      article.innerHTML = renderMarkdown(doc.text, doc.fileId).html;
      const { anchor } = splitLink(href);
      // Leave room to align targets near EOF to the same top inset as other anchors.
      article.style.paddingBottom = anchor
        ? scroller.clientHeight + "px"
        : "60px";
      const line = anchor.match(/^L(\d+)(?:C(\d+))?$/i);
      if (line) {
        const lines = doc.text.split("\n"),
          n = Number(line[1]);
        const column = Number(line[2] || 1);
        if (
          n < 1 ||
          n > lines.length ||
          column < 1 ||
          column > lines[n - 1].length + 1
        ) {
          status.textContent += t(" · 行列锚点超出文档范围，显示开头");
        } else {
          const from =
            lines
              .slice(0, n - 1)
              .reduce((sum, item) => sum + item.length + 1, 0) +
            column -
            1;
          alignment = () =>
            restoreAnchor(scroller, { from, y: 12 }, { expand: true });
        }
      } else if (anchor) {
        const element = article.querySelector("#" + CSS.escape(anchor));
        if (element) {
          unfold(element);
          element.classList.add("preview-target");
          alignment = () => {
            scroller.scrollTop +=
              element.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top -
              12;
          };
        } else status.textContent += t(" · 未找到锚点：{anchor}", { anchor });
      }
      requestAnimationFrame(align);
      renderDiagrams(
        article,
        document.documentElement.dataset.theme || "light",
        align,
      );
    } catch (e) {
      if (token !== generation) return;
      status.textContent = t("无法预览：{message}", {
        message: e.message || String(e),
      });
    }
  }
  function begin(link) {
    if (
      !link ||
      !host.contains(link) ||
      !eligible(link.getAttribute("href") || "")
    )
      return;
    clearTimeout(leaveTimer);
    if (origin === link) return;
    hide();
    origin = link;
    const token = ++generation;
    timer = setTimeout(() => show(link, token), 350);
  }
  function leave(event) {
    if (
      card.contains(event.relatedTarget) ||
      origin?.contains(event.relatedTarget)
    )
      return;
    // Focus dropping to nothing is not leaving while the pointer is still on
    // the card or its link: newer Chromium blurs a button that disables
    // itself (Copy does, while it writes).
    if (
      event.type === "focusout" &&
      !event.relatedTarget &&
      (card.matches(":hover") || origin?.matches(":hover"))
    )
      return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => hide(), 240);
  }
  host.addEventListener("pointerover", (e) => begin(e.target.closest("a")));
  host.addEventListener("focusin", (e) => begin(e.target.closest("a")));
  host.addEventListener("pointerout", leave);
  host.addEventListener("focusout", leave);
  card.addEventListener("pointerenter", () => clearTimeout(leaveTimer));
  card.addEventListener("focusin", () => clearTimeout(leaveTimer));
  card.addEventListener("pointerleave", leave);
  card.addEventListener("focusout", leave);
  card.querySelector(".preview-close").onclick = () =>
    hide({ focus: card.contains(document.activeElement) });
  async function open(targetHref, targetSource) {
    hide();
    try {
      await navigate(targetHref, targetSource);
    } catch (e) {
      report(e.message);
    }
  }
  card.querySelector(".preview-open").onclick = () => open(href, null);
  article.addEventListener("click", (e) => {
    const link = e.target.closest("a"),
      fold = e.target.closest(".fold, .section-rail");
    if (link) {
      e.preventDefault();
      open(link.getAttribute("href") || "", source);
    } else if (fold) {
      const section = fold.closest(".note-section");
      setSectionCollapsed(section, !section.classList.contains("collapsed"));
      positioned = true;
    }
  });
  scroller.addEventListener("load", align, true);
  for (const event of ["wheel", "pointerdown", "keydown"])
    scroller.addEventListener(
      event,
      () => {
        positioned = true;
      },
      { passive: true },
    );
  host.addEventListener("click", () => hide());
  // Close when the reader scrolls the link away, not when layout-preserving
  // corrections (late fonts, lazy formulas and tables, diagrams) keep it put.
  host.parentElement.addEventListener(
    "scroll",
    () => {
      if (card.hidden || !origin?.isConnected || !placedAt) return hide();
      const r = origin.getBoundingClientRect();
      if (
        Math.abs(r.top - placedAt.top) > 4 ||
        Math.abs(r.left - placedAt.left) > 4
      )
        hide();
    },
    { passive: true },
  );
  document.addEventListener("pointerdown", (e) => {
    if (!card.contains(e.target) && !origin?.contains(e.target)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !card.hidden) {
      e.preventDefault();
      hide({ focus: card.contains(document.activeElement) });
    } else if (e.key === "F2" && !card.hidden) {
      e.preventDefault();
      scroller.focus({ preventScroll: true });
    }
  });
  window.addEventListener("resize", () => hide());
  // After the note re-renders: keep the preview while its link is still on the
  // page (unchanged blocks are kept), close it once the link was replaced.
  function release() {
    if (origin && !origin.isConnected) hide();
  }
  return { hide, release };
}
