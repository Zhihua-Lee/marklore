// Backlinks where they belong: a small count beside each heading or anchored
// block that other notes link to, a card listing those notes (hover or click
// the count), the same counts in the outline, and broken links marked in
// place. Nothing is shown where nothing links in.
import { renderMarkdown, loadMath, mayContainMath } from "./markdown.js";
import { t } from "../desktop/i18n.mjs";
import { icon } from "./icons.js";
import "./backlinks.css";

const HEADINGS = "h1,h2,h3,h4,h5,h6";
const BLOCKS =
  "p,h1,h2,h3,h4,h5,h6,li,blockquote,table,pre,figure,.math-block,dl";
const arrowIn = icon("backlink");

// An author anchor (<a id="..."></a> on its own line) marks what follows it.
export function explicitAnchors(content) {
  return [...content.querySelectorAll("a[id]")].filter(
    (a) =>
      !a.textContent.trim() &&
      !a.closest(".footnote-ref,.footnotes") &&
      !a.closest(HEADINGS),
  );
}
export function markedBlock(anchor, content) {
  // Written inside a block with text of its own (a list item's first words):
  // it marks that block.
  const own = anchor.parentElement?.closest(BLOCKS);
  if (own && content.contains(own) && own.textContent.trim()) return own;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = anchor;
  for (let el = walker.nextNode(); el; el = walker.nextNode()) {
    if (el.contains(anchor) || !el.matches(BLOCKS)) continue;
    if (!el.textContent.trim() && !el.querySelector(".formula,img")) continue;
    return el;
  }
  return null;
}
// A short name for an anchored block: its bold lead, or its first words.
export function blockLabel(block) {
  if (block.matches(HEADINGS)) {
    // Without the fold control, the folded-section summary and our count.
    const copy = block.cloneNode(true);
    for (const extra of copy.querySelectorAll("button,.section-summary"))
      extra.remove();
    return copy.textContent.replace(/\s+/g, " ").trim();
  }
  // Our own count may already sit first in the block: look past it.
  const first = [...block.children].find(
    (child) => !child.matches(".backlink-badge"),
  );
  const lead =
    first?.matches("strong,b") &&
    !block.textContent.trim().indexOf(first.textContent.trim())
      ? first.textContent
      : block.textContent;
  const text = lead
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。．.:：，,；;]+$/, "");
  return text.length > 40 ? text.slice(0, 38) + "…" : text;
}
const precedingHeading = (el, content) =>
  [...content.querySelectorAll(HEADINGS)]
    .filter(
      (heading) =>
        heading === el ||
        heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
    .at(-1) || null;

export function createBacklinks({
  api,
  content,
  reader,
  outline,
  getActive,
  getHeadings,
  getSettings,
  navigate,
  run,
}) {
  const cache = new Map(); // fileId -> Promise<incoming[]>
  // fileId + href -> link status; cleared when the library changes.
  const statuses = new Map();
  let lastIncoming = null;
  let epoch = 0,
    targets = []; // { element, entries, title, label }
  const card = document.createElement("div");
  card.id = "backlinks-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  document.body.append(card);
  let openFor = null,
    openTimer = 0,
    closeTimer = 0;

  function load(doc) {
    if (!api?.backlinks || !doc?.fileId) return Promise.resolve([]);
    if (!cache.has(doc.fileId))
      cache.set(
        doc.fileId,
        api.backlinks(doc.fileId).catch(() => {
          cache.delete(doc.fileId);
          return [];
        }),
      );
    return cache.get(doc.fileId);
  }

  // Group incoming links by the block they point at.
  function resolve(incoming) {
    const title =
      content.querySelector("h1") || content.querySelector(HEADINGS) || null;
    const groups = new Map();
    const add = (element, entry) => {
      if (!element) return;
      if (!groups.has(element)) groups.set(element, []);
      groups.get(element).push(entry);
    };
    const missing = [];
    for (const entry of incoming) {
      if (!entry.fragment) {
        add(title, entry);
        continue;
      }
      const el = content.querySelector("#" + CSS.escape(entry.fragment));
      if (!el) {
        missing.push(entry);
        continue;
      }
      add(
        el.matches("a") ? markedBlock(el, content) : el.closest(BLOCKS) || el,
        entry,
      );
    }
    return { groups, title, missing };
  }

  function clearMarks() {
    for (const badge of content.querySelectorAll(".backlink-badge"))
      badge.remove();
    for (const el of content.querySelectorAll(".has-backlinks"))
      el.classList.remove("has-backlinks");
  }

  function badge(element, count, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "backlink-badge";
    button.contentEditable = "false";
    button.dataset.count = String(count);
    button.innerHTML = arrowIn;
    button.setAttribute(
      "aria-label",
      t("{label}：被 {count} 处引用", { label, count }),
    );
    element.classList.add("has-backlinks");
    // After a heading's fold control, before the text: it floats right.
    const fold = element.querySelector(":scope > .fold");
    element.insertBefore(button, fold ? fold.nextSibling : element.firstChild);
    return button;
  }

  async function refresh() {
    const doc = getActive(),
      mine = ++epoch;
    const incoming = await load(doc);
    if (mine !== epoch || doc !== getActive()) return;
    const { groups, title, missing } = resolve(incoming);
    // Re-rendering the note often keeps the linked blocks: then the counts
    // (and an open card) stay as they are. Rebuilding them every time closed
    // a card that had just opened.
    const unchanged =
      incoming === lastIncoming &&
      targets.length ===
        groups.size +
          (!groups.has(title) && title && incoming.length ? 1 : 0) &&
      targets.every(
        (target) =>
          target.button.isConnected &&
          target.element.contains(target.button) &&
          (groups.has(target.element) || target.element === title),
      );
    if (unchanged) {
      decorateOutline();
      markBrokenLinks(doc);
      return;
    }
    lastIncoming = incoming;
    const open = card.hidden ? null : openFor;
    clearMarks();
    targets = [];
    for (const [element, entries] of groups) {
      const isTitle = element === title;
      // The title's count covers the whole note.
      const all = isTitle ? incoming : entries;
      const label = isTitle ? doc.name : blockLabel(element);
      targets.push({
        element,
        entries: all,
        own: entries,
        title: isTitle,
        label,
        button: badge(element, all.length, label),
      });
    }
    if (!groups.has(title) && title && incoming.length) {
      targets.push({
        element: title,
        entries: incoming,
        own: [],
        title: true,
        label: doc.name,
        button: badge(title, incoming.length, doc.name),
      });
    }
    if (missing.length)
      targets
        .find((target) => target.title)
        ?.button.classList.add("has-missing");
    // An open card follows its block's new count, or closes if it has none.
    if (open) {
      const again = targets.find((target) => target.element === open.element);
      if (again) {
        openFor = again;
        place(again.button);
      } else hide();
    }
    decorateOutline();
    markBrokenLinks(doc);
  }

  // Outline: counts on headings, and (by setting) anchored blocks as entries.
  function decorateOutline() {
    if (!outline) return;
    for (const el of outline.querySelectorAll(".outline-anchor,.outline-count"))
      el.remove();
    const mode = getSettings().outlineAnchors;
    if (mode !== "referenced" && mode !== "all") return;
    const buttons = [...outline.querySelectorAll(":scope > button")];
    const headings = getHeadings();
    const counts = new Map(
      targets.map((target) => [
        target.element,
        target.title ? target.own.length : target.entries.length,
      ]),
    );
    const count = (element) => counts.get(element) || 0;
    // First in the entry: it floats at the right of the entry's first line.
    const countSpan = (n) => {
      const span = document.createElement("span");
      span.className = "outline-count";
      span.textContent = String(n);
      span.setAttribute("aria-label", t("被 {count} 处引用", { count: n }));
      return span;
    };
    const domHeadings = content.querySelectorAll(HEADINGS);
    buttons.forEach((button, i) => {
      const n = count(domHeadings[i]);
      if (!n || !headings[i]) return;
      button.prepend(countSpan(n));
    });
    const after = new Map();
    for (const anchor of explicitAnchors(content)) {
      const block = markedBlock(anchor, content);
      if (!block || block.matches(HEADINGS)) continue;
      const n = count(block);
      if (mode === "referenced" && !n) continue;
      const heading = precedingHeading(block, content);
      const index = heading ? [...domHeadings].indexOf(heading) : -1;
      const parent = buttons[index];
      const level = Number(heading?.tagName[1] || 1);
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "outline-anchor";
      entry.dataset.anchor = anchor.id;
      entry.style.paddingLeft = 12 + level * 12 + "px";
      entry.title = blockLabel(block);
      const label = document.createElement("span");
      label.className = "outline-label";
      label.textContent = blockLabel(block);
      entry.append(label);
      if (n) entry.prepend(countSpan(n));
      entry.onclick = run(() => navigate("#" + anchor.id));
      const previous = after.get(parent) || parent;
      if (previous) previous.after(entry);
      else outline.prepend(entry);
      after.set(parent, entry);
    }
  }

  // Links in this note that lead nowhere: a dashed underline and a reason.
  async function markBrokenLinks(doc) {
    const links = [...content.querySelectorAll("a[href]")].filter((a) => {
      const href = a.getAttribute("href");
      return (
        href &&
        !a.closest(".footnote-ref,.footnotes,.backlink-badge") &&
        !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
        !/^#(L\d|fn)/i.test(href)
      );
    });
    for (const a of links) {
      a.classList.remove("link-broken");
      a.removeAttribute("data-broken");
    }
    const mark = (a, status) => {
      if (status === "ok") return;
      a.classList.add("link-broken");
      a.dataset.broken = status;
      a.title =
        status === "missing-file"
          ? t("链接的笔记不存在")
          : t("链接的标题或锚点不存在");
    };
    const local = [],
      remote = [];
    for (const a of links)
      (a.getAttribute("href").startsWith("#") ? local : remote).push(a);
    for (const a of local) {
      let id = a.getAttribute("href").slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {}
      mark(
        a,
        content.querySelector("#" + CSS.escape(id)) ? "ok" : "missing-anchor",
      );
    }
    if (!remote.length || !api?.linkStatus || !doc?.fileId) return;
    // Ask only about links not checked since the library last changed.
    const key = (a) => doc.fileId + "|" + a.getAttribute("href");
    const known = remote.filter((a) => statuses.has(key(a)));
    for (const a of known) mark(a, statuses.get(key(a)));
    const unknown = remote.filter((a) => !statuses.has(key(a)));
    if (!unknown.length) return;
    const mine = epoch;
    const results = await api
      .linkStatus(
        doc.fileId,
        unknown.map((a) => a.getAttribute("href")),
      )
      .catch(() => null);
    if (!results) return;
    unknown.forEach((a, i) => statuses.set(key(a), results[i] || "ok"));
    if (mine !== epoch || doc !== getActive()) return;
    unknown.forEach((a, i) => mark(a, results[i] || "ok"));
  }

  // The card: which notes link here, in which sentence.
  function show(target, pinned = false) {
    clearTimeout(closeTimer);
    const doc = getActive();
    openFor = target;
    card.dataset.pinned = String(pinned);
    const heading = target.title
      ? t("链接到本笔记（{count}）", { count: target.entries.length })
      : t("引用了这里（{count}）", { count: target.entries.length });
    const byTarget = new Map();
    for (const entry of target.entries) {
      const key = target.title ? entry.fragment : "";
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(entry);
    }
    const sectionName = (fragment) => {
      if (!fragment) return t("整篇笔记");
      const el = content.querySelector("#" + CSS.escape(fragment));
      if (!el) return t("不存在的位置 #{id}", { id: fragment });
      return blockLabel(el.matches("a") ? markedBlock(el, content) || el : el);
    };
    card.innerHTML = `<header>${arrowIn}<strong></strong></header><div class="backlinks-list"></div>`;
    card.querySelector("strong").textContent = heading;
    const list = card.querySelector(".backlinks-list");
    for (const [fragment, entries] of byTarget) {
      if (target.title && byTarget.size > 1) {
        const label = document.createElement("div");
        label.className = "backlinks-target";
        label.textContent = sectionName(fragment);
        list.append(label);
      }
      for (const entry of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "backlink-entry";
        button.innerHTML = `<span class="backlink-source"></span><span class="backlink-section"></span><div class="backlink-snippet"></div>`;
        button.querySelector(".backlink-source").textContent =
          entry.name.replace(/\.(md|markdown)$/i, "");
        button.querySelector(".backlink-section").textContent = entry.section
          ? "› " + entry.section
          : "";
        const snippet = button.querySelector(".backlink-snippet");
        snippet.dataset.source = entry.snippet;
        snippet.innerHTML = renderMarkdown(entry.snippet, doc?.fileId).html;
        button.onclick = run(async () => {
          hide();
          await navigate(entry.href);
        });
        list.append(button);
      }
    }
    card.hidden = false;
    place(target.button);
    // Formulas typeset once KaTeX is loaded (the note itself may have none),
    // as the link preview does.
    const snippets = [...card.querySelectorAll(".backlink-snippet")];
    if (snippets.some((el) => mayContainMath(el.dataset.source)))
      loadMath().then(() => {
        if (openFor !== target) return;
        for (const el of snippets)
          el.innerHTML = renderMarkdown(el.dataset.source, doc?.fileId).html;
        place(target.button);
      });
  }
  function place(anchor) {
    const box = anchor.getBoundingClientRect(),
      view = reader.getBoundingClientRect();
    const width = card.offsetWidth,
      height = card.offsetHeight;
    const left = Math.max(
      8,
      Math.min(box.right - width, innerWidth - width - 8),
    );
    const below = box.bottom + 6;
    card.style.left = left + "px";
    card.style.top =
      (below + height < Math.min(innerHeight, view.bottom + 40)
        ? below
        : Math.max(8, box.top - height - 6)) + "px";
  }
  function hide() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    card.hidden = true;
    openFor = null;
  }
  const targetOf = (button) =>
    targets.find((target) => target.button === button);

  content.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(".backlink-badge");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const target = targetOf(button);
      if (!target) return;
      if (openFor === target && card.dataset.pinned === "true") hide();
      else show(target, true);
    },
    true,
  );
  content.addEventListener(
    "dblclick",
    (event) => {
      if (event.target.closest(".backlink-badge")) event.stopPropagation();
    },
    true,
  );
  content.addEventListener("pointerover", (event) => {
    const button = event.target.closest(".backlink-badge");
    if (!button) return;
    clearTimeout(closeTimer);
    const target = targetOf(button);
    if (!target || openFor === target) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(() => show(target), 200);
  });
  const leave = () => {
    clearTimeout(openTimer);
    if (card.dataset.pinned === "true") return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hide, 260);
  };
  content.addEventListener("pointerout", (event) => {
    if (
      event.target.closest(".backlink-badge") &&
      !card.contains(event.relatedTarget)
    )
      leave();
  });
  card.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  card.addEventListener("pointerleave", leave);
  document.addEventListener("pointerdown", (event) => {
    if (
      !card.hidden &&
      !card.contains(event.target) &&
      !event.target.closest(".backlink-badge")
    )
      hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !card.hidden) {
      event.preventDefault();
      hide();
    }
  });
  reader.addEventListener(
    "scroll",
    () => !card.hidden && openFor && place(openFor.button),
    { passive: true },
  );

  return {
    refresh: () => run(refresh)(),
    // Another note changed: links into this one may have too.
    invalidate() {
      cache.clear();
      statuses.clear();
      run(refresh)();
    },
    decorateOutline,
    hide,
  };
}
