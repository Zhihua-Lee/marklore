// Resting the pointer on a tab shows a card under it, as in a browser: the
// note's full name, where its file is, and, for another tab, the part of the
// note it was left at. The card is passive: it takes no pointer or focus, and
// never changes the current tab, its position or the history.
import { t } from "../desktop/i18n.mjs";
import { renderMarkdown, loadMath, mayContainMath } from "./markdown.js";
import { loadHighlighter, mayContainCode } from "./highlighting.js";
import "./tab-preview.css";

// Long enough not to open while the pointer crosses the tab bar.
const OPEN_DELAY = 450;
// Once a card is up (or was a moment ago), moving along the tabs follows at once.
const FOLLOW_DELAY = 40;
const FOLLOW_WINDOW = 400;
// About a card's worth of a note is rendered, never the whole of a long one.
const LIMIT = 3000;

// The part of a note a card shows: from the top-level block holding `from`
// to a block boundary about LIMIT characters later. Blocks start after a
// blank line with an unindented line, outside fenced code and $$ formulas.
export function excerpt(text, from = 0) {
  let start = 0,
    end = text.length,
    fence = null,
    blank = true;
  for (let at = 0; at < text.length;) {
    let next = text.indexOf("\n", at);
    if (next < 0) next = text.length;
    const line = text.slice(at, next);
    if (fence) {
      if (fence.test(line)) fence = null;
    } else {
      if (blank && /^\S/.test(line)) {
        if (at <= from) start = at;
        else if (at - start >= LIMIT) {
          end = at;
          break;
        }
      }
      const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (open)
        fence = new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`);
      else if (line.trim() === "$$") fence = /^\s*\$\$\s*$/;
    }
    blank = !line.trim();
    at = next + 1;
  }
  // One enormous block (a long code listing): a card's worth of its lines.
  if (end - start > LIMIT * 4) {
    const cut = text.lastIndexOf("\n", start + LIMIT * 4);
    end = cut > start ? cut : start + LIMIT * 4;
  }
  return { start, text: text.slice(start, end) };
}

export function createTabPreview({ host, find, active, dirty }) {
  const card = document.createElement("div");
  card.id = "tab-preview";
  card.setAttribute("role", "tooltip");
  card.hidden = true;
  card.innerHTML = `<strong class="tab-preview-name"></strong><div class="tab-preview-path"></div><div class="tab-preview-state"></div><div class="tab-preview-page"><article class="prose"></article></div>`;
  document.body.append(card);
  const name = card.querySelector(".tab-preview-name"),
    path = card.querySelector(".tab-preview-path"),
    state = card.querySelector(".tab-preview-state"),
    page = card.querySelector(".tab-preview-page"),
    article = card.querySelector("article");
  let origin = null, // the tab the card is for, or is waiting to open for
    timer = 0,
    generation = 0,
    hiddenAt = -Infinity,
    // After a press on a tab, no card for it until the pointer leaves it.
    quiet = null,
    shown = null;
  const rendered = new Map(); // id + position + text -> { html, hydrate }

  function hide() {
    clearTimeout(timer);
    generation++;
    if (!card.hidden) hiddenAt = performance.now();
    shown?.hydrate?.deactivate?.();
    shown = null;
    origin?.querySelector(".tab-label")?.removeAttribute("aria-describedby");
    origin = null;
    card.hidden = true;
    article.replaceChildren();
  }
  function place(node) {
    const r = node.getBoundingClientRect(),
      width = card.offsetWidth;
    card.style.left =
      Math.max(8, Math.min(r.left, innerWidth - width - 8)) + "px";
    card.style.top = r.bottom + 6 + "px";
  }
  function renderedPage(doc, part) {
    const key = doc.id + "|" + part.start + "|" + part.text;
    let entry = rendered.get(key);
    if (!entry) {
      const result = renderMarkdown(part.text, doc.fileId, {
        deferMath: true,
        progressive: true,
        base: part.start,
      });
      entry = { html: result.html, hydrate: result.hydrate };
    }
    rendered.delete(key);
    rendered.set(key, entry);
    while (rendered.size > 6) rendered.delete(rendered.keys().next().value);
    return entry;
  }
  async function show(node, token) {
    if (token !== generation) return;
    const doc = find(node.dataset.id);
    if (!doc || !node.isConnected) return hide();
    name.textContent = doc.name;
    path.textContent = doc.path || t("未保存的笔记");
    state.textContent = dirty(doc) ? t("● 未保存") : "";
    state.hidden = !dirty(doc);
    // The current tab's page is in view already: name and place only.
    const current = active() === doc;
    page.hidden = current || !doc.text.trim();
    article.replaceChildren();
    card.hidden = false;
    node.querySelector(".tab-label")?.setAttribute("aria-describedby", card.id);
    place(node);
    if (page.hidden) return;
    // Where the tab was left, as switching to it would show.
    const part = excerpt(doc.text, doc.anchor?.top ? 0 : doc.anchor?.from),
      { text } = part;
    if (mayContainMath(text) || mayContainCode(text)) {
      await Promise.all([
        mayContainMath(text) && loadMath(),
        mayContainCode(text) && loadHighlighter(),
      ]).catch(() => {});
      if (token !== generation || origin !== node) return;
    }
    shown?.hydrate?.deactivate?.();
    shown = renderedPage(doc, part);
    article.innerHTML = shown.html;
    // Its headings are no link targets: the note's own keep their ids alone.
    for (const el of article.querySelectorAll("[id]")) el.removeAttribute("id");
    page.scrollTop = 0;
    shown.hydrate?.activate?.(article);
  }
  function enter(node) {
    if (node === origin) return;
    hide();
    if (node === quiet) return;
    origin = node;
    const token = generation;
    const following =
      !card.hidden || performance.now() - hiddenAt < FOLLOW_WINDOW;
    timer = setTimeout(
      () => show(node, token),
      following ? FOLLOW_DELAY : OPEN_DELAY,
    );
  }
  host.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch" || e.buttons) return;
    const node = e.target.closest?.(".tab");
    if (quiet && node !== quiet) quiet = null;
    if (!node || host.classList.contains("dragging")) return hide();
    enter(node);
  });
  host.addEventListener("pointerleave", () => {
    quiet = null;
    hide();
  });
  // A press (a switch, a close, a drag), a scroll of the bar, a key or the
  // window going to the back: the card goes.
  host.addEventListener("pointerdown", (e) => {
    quiet = e.target.closest?.(".tab") || null;
    hide();
  });
  host.addEventListener("wheel", hide, { passive: true });
  host.addEventListener("scroll", hide, { passive: true });
  addEventListener("keydown", hide, true);
  addEventListener("blur", hide);
  // A card whose tab went away (closed, or folded into its group) goes with it.
  new MutationObserver(() => {
    if (origin && (!origin.isConnected || origin.hidden)) hide();
  }).observe(host, { childList: true, subtree: true, attributes: true });
  return { hide };
}
