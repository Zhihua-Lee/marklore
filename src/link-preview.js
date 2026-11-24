import { t } from "../desktop/i18n.mjs";
import { renderMarkdown, loadMath, mayContainMath } from "./markdown.js";
import { loadHighlighter, mayContainCode } from "./highlighting.js";
import { renderDiagrams } from "./diagrams.js";
import { restoreAnchor, visibleAnchor, unfold } from "./positions.js";
import { setSectionCollapsed, watchSections } from "./sections.js";
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
//
// Restrained by default (Settings → Navigation & scrolling → Link preview):
// the pointer has to rest on a link for a while, and never while a mouse
// button is held (a drag or a selection being made), shortly after a
// selection was made or changed, or with selected text under or near the
// pointer. "ctrl": only while Ctrl is held over the link; "off": never on
// its own. Keyboard focus (Tab) opens it as before, unless off.
export const PREVIEW_MODES = ["hover", "ctrl", "off"];
// The pointer at rest on a link this long (moving more than REST_SLOP
// pixels starts it again).
const REST_DELAY = 700;
const REST_SLOP = 4;
// Ctrl held over a link: asked for, so sooner.
const CTRL_DELAY = 250;
// Keyboard focus on a link.
const FOCUS_DELAY = 220;
// After a selection was made or changed.
const SELECTION_QUIET = 1000;
// Selected text this close to the pointer keeps the preview away.
const SELECTION_NEAR = 40;
// Leaving the link and the card: time to move from one to the other.
const LEAVE_GRACE = 240;

export function createLinkPreview({
  host,
  load,
  navigate,
  report,
  getZoom = () => 100,
  saveZoom = () => {},
  getMode = () => "hover",
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
  watchSections(article);
  function applyZoom() {
    const zoom = Math.max(50, Math.min(200, Number(getZoom()) || 100));
    card.style.setProperty("--note-zoom", String(zoom / 100));
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
  // dismiss: closed by the reader (Esc, ×, a press): not opened again for
  // the link under the pointer until the pointer leaves it.
  function hide({ focus = false, dismiss = false } = {}) {
    if (dismiss) dismissed = hovered;
    shown?.hydrate?.deactivate?.();
    shown = null;
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
  const rendered = new Map(); // note + text -> { html, hydrate }, newest last
  let shown = null;
  // The card shows a small part of a note: formulas are typeset as they come
  // near its view, the rest when idle (typesetting and laying out every
  // formula of a long note first took over a second). The same note,
  // unchanged, is not rendered twice.
  function renderedPreview(doc) {
    const key = (doc.fileId || doc.id) + "|" + doc.text;
    let entry = rendered.get(key);
    if (!entry) {
      const result = renderMarkdown(doc.text, doc.fileId, {
        deferMath: true,
        progressive: true,
      });
      entry = { html: result.html, hydrate: result.hydrate };
    }
    rendered.delete(key);
    rendered.set(key, entry);
    while (rendered.size > 8) rendered.delete(rendered.keys().next().value);
    return entry;
  }
  async function show(link, token) {
    if (origin !== link || token !== generation || !link.isConnected) return;
    href = link.getAttribute("href") || "";
    source = null;
    positioned = false;
    title.textContent = t("链接预览");
    path.textContent = splitLink(href).target || t("当前笔记");
    status.textContent = t("正在读取…");
    status.hidden = false;
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
      status.textContent = doc.draft ? t("当前编辑草稿 · 未保存") : "";
      status.hidden = !doc.draft;
      if (mayContainMath(doc.text) || mayContainCode(doc.text)) {
        await Promise.all([
          mayContainMath(doc.text) && loadMath(),
          mayContainCode(doc.text) && loadHighlighter(),
        ]);
        if (token !== generation || origin !== link) return;
        if (!link.isConnected) return hide();
      }
      shown?.hydrate?.deactivate?.();
      shown = renderedPreview(doc);
      article.innerHTML = shown.html;
      shown.hydrate?.activate?.(article);
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
          const note = t(" · 行列锚点超出文档范围，显示开头");
          status.textContent = status.textContent
            ? status.textContent + note
            : note.replace(/^\s*·\s*/, "");
          status.hidden = false;
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
        } else {
          const note = t(" · 未找到锚点：{anchor}", { anchor });
          status.textContent = status.textContent
            ? status.textContent + note
            : note.replace(/^\s*·\s*/, "");
          status.hidden = false;
        }
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
      status.hidden = false;
    }
  }
  // A link of the note that can be previewed.
  const previewable = (link) =>
    Boolean(link) &&
    host.contains(link) &&
    eligible(link.getAttribute("href") || "");
  // What the pointer and the reader are doing, for the restrained rules.
  let hovered = null, // the previewable link under the pointer
    dismissed = null, // closed by the reader while the pointer is on it
    pointer = { x: -1, y: -1 },
    restFrom = null, // where the pointer came to rest on the link
    held = false, // a mouse button is down
    dragging = false,
    ctrl = false,
    hadRange = false,
    selectedAt = -Infinity;
  const mode = () => {
    const value = getMode();
    return PREVIEW_MODES.includes(value) ? value : "hover";
  };
  // Selected text under or near the pointer, or holding the link.
  function selectionNear(link) {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount)
      return false;
    if (selection.containsNode(link, true)) return true;
    for (let i = 0; i < selection.rangeCount; i++)
      for (const r of selection.getRangeAt(i).getClientRects())
        if (
          pointer.x >= r.left - SELECTION_NEAR &&
          pointer.x <= r.right + SELECTION_NEAR &&
          pointer.y >= r.top - SELECTION_NEAR &&
          pointer.y <= r.bottom + SELECTION_NEAR
        )
          return true;
    return false;
  }
  // How long a preview by the pointer has to wait: 0 now, Infinity until
  // the pointer moves again (or Ctrl is pressed).
  function wait(link) {
    const how = mode();
    if (how === "off" || (how === "ctrl" && !ctrl)) return Infinity;
    if (held || dragging || selectionNear(link)) return Infinity;
    return Math.max(0, SELECTION_QUIET - (performance.now() - selectedAt));
  }
  // The preview of a link scheduled ("pointer" or "focus").
  function arm(link, delay, via) {
    clearTimeout(leaveTimer);
    if (origin !== link) {
      hide();
      origin = link;
    } else clearTimeout(timer);
    const token = ++generation;
    timer = setTimeout(() => fire(link, token, via), delay);
  }
  function fire(link, token, via) {
    if (origin !== link || token !== generation) return;
    if (via === "pointer") {
      const ms = wait(link);
      if (ms === Infinity) return;
      if (ms > 0) {
        timer = setTimeout(() => fire(link, token, via), ms);
        return;
      }
    }
    show(link, token);
  }
  // A preview waiting to open (none shown yet).
  const pending = () => Boolean(origin) && card.hidden;
  // The pointer over a link, moved or still: it rests from where it last
  // moved more than a few pixels.
  function rest(link, event) {
    const how = mode();
    const allowed =
      how !== "off" &&
      link !== dismissed &&
      !event.buttons &&
      !dragging &&
      (how === "hover" || event.ctrlKey || event.metaKey);
    if (!allowed) {
      if (origin === link && pending()) hide();
      return;
    }
    if (origin === link && !pending()) return; // shown: left as it is
    if (
      origin === link &&
      restFrom &&
      Math.hypot(event.clientX - restFrom.x, event.clientY - restFrom.y) <=
        REST_SLOP
    )
      return;
    restFrom = { x: event.clientX, y: event.clientY };
    arm(link, how === "ctrl" ? CTRL_DELAY : REST_DELAY, "pointer");
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
    // Not open yet: nothing to move into.
    if (pending()) return hide();
    leaveTimer = setTimeout(() => hide(), LEAVE_GRACE);
  }
  const track = (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    ctrl = event.ctrlKey || event.metaKey;
  };
  host.addEventListener("pointerover", (event) => {
    track(event);
    const link = event.target.closest("a");
    if (!previewable(link)) return;
    hovered = link;
    clearTimeout(leaveTimer);
    rest(link, event);
  });
  host.addEventListener("pointermove", (event) => {
    track(event);
    const link = event.target.closest("a");
    if (link && link === hovered) rest(link, event);
  });
  host.addEventListener("pointerout", (event) => {
    if (hovered && !hovered.contains(event.relatedTarget))
      hovered = dismissed = null;
    leave(event);
  });
  // Keyboard focus (Tab), not the focus a click gives a link.
  host.addEventListener("focusin", (event) => {
    const link = event.target.closest("a");
    if (!previewable(link) || mode() === "off") return;
    if (!link.matches(":focus-visible")) return;
    clearTimeout(leaveTimer);
    if (origin !== link) arm(link, FOCUS_DELAY, "focus");
  });
  host.addEventListener("focusout", leave);
  // Buttons, drags, Ctrl and selections, wherever they happen.
  document.addEventListener(
    "pointerdown",
    (event) => {
      track(event);
      held = true;
    },
    true,
  );
  for (const type of ["pointerup", "pointercancel"])
    document.addEventListener(type, () => (held = false), true);
  window.addEventListener("blur", () => {
    held = dragging = ctrl = false;
  });
  document.addEventListener("dragstart", () => (dragging = true), true);
  for (const type of ["dragend", "drop"])
    document.addEventListener(type, () => (dragging = false), true);
  document.addEventListener("selectionchange", () => {
    const selection = getSelection();
    const ranged = Boolean(selection && !selection.isCollapsed);
    // Made, changed or cleared; a caret moving alone does not count.
    if (ranged || hadRange) selectedAt = performance.now();
    hadRange = ranged;
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Control" && event.key !== "Meta") return;
      ctrl = true;
      if (event.repeat) return;
      // Ctrl pressed with the pointer already resting on a link.
      if (mode() === "ctrl" && hovered?.isConnected && !held && !dragging)
        if (origin !== hovered || pending()) {
          dismissed = null;
          arm(hovered, CTRL_DELAY, "pointer");
        }
    },
    true,
  );
  document.addEventListener(
    "keyup",
    (event) => {
      if (event.key !== "Control" && event.key !== "Meta") return;
      ctrl = false;
      // Let go before it opened: not asked for any more.
      if (mode() === "ctrl" && pending()) hide();
    },
    true,
  );
  card.addEventListener("pointerenter", () => clearTimeout(leaveTimer));
  card.addEventListener("focusin", () => clearTimeout(leaveTimer));
  card.addEventListener("pointerleave", leave);
  card.addEventListener("focusout", leave);
  card.querySelector(".preview-close").onclick = () =>
    hide({ focus: card.contains(document.activeElement), dismiss: true });
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
  // Formulas above the target are typeset after it was aligned: align again
  // until the reader scrolls the card themselves.
  article.addEventListener("folio:math-rendered", align);
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
  // A press anywhere but on the card (its link too: a click, or a drag
  // starting to select) closes it, or keeps it from opening.
  document.addEventListener("pointerdown", (e) => {
    if (!card.contains(e.target)) hide({ dismiss: true });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !card.hidden) {
      e.preventDefault();
      hide({ focus: card.contains(document.activeElement), dismiss: true });
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
