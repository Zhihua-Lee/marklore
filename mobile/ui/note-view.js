import {
  lineOffsets,
  loadMath,
  mayContainMath,
  renderMarkdown,
} from "../../src/markdown.js";
import { loadHighlighter, mayContainCode } from "../../src/highlighting.js";
import { wireCodeBlocks } from "../../src/code-blocks.js";
import { wireSortableTables } from "../../src/table-sort.js";
import {
  classifyNoteHref,
  findAnchorElement,
  resolveRelativePath,
  safeDecodeURIComponent,
} from "./paths.js";
import { STRINGS } from "./strings.js";

const MOBILE_ASSET_PREFIX = "folio-asset://mobile-note/?path=";

function buildMissingImageNode(message, caption = "") {
  const box = document.createElement("figure");
  box.className = "mobile-image-missing";
  const label = document.createElement("span");
  label.className = "mobile-image-missing-label";
  label.textContent = message;
  box.append(label);
  if (caption) {
    const note = document.createElement("figcaption");
    note.className = "mobile-image-missing-caption";
    note.textContent = caption;
    box.append(note);
  }
  return box;
}

async function resolveNoteImages(proseEl, notePath, library) {
  const imgs = [...proseEl.querySelectorAll("img")];
  await Promise.all(
    imgs.map(async (img) => {
      const rawAttr = img.getAttribute("src") || "";
      if (!rawAttr) {
        const cleanAlt = img.alt?.trim();
        img.replaceWith(buildMissingImageNode(STRINGS.imageDisabled, cleanAlt));
        return;
      }
      if (!rawAttr.startsWith(MOBILE_ASSET_PREFIX)) return;
      const encodedRel = rawAttr.slice(MOBILE_ASSET_PREFIX.length);
      const relative = safeDecodeURIComponent(decodeURIComponent(encodedRel));
      const resolvedPath = resolveRelativePath(notePath, relative);
      const url = await library.asset(resolvedPath);
      if (!url) {
        img.replaceWith(
          buildMissingImageNode(STRINGS.imageNotSynced, img.alt?.trim() || ""),
        );
        return;
      }
      img.removeAttribute("width");
      img.removeAttribute("height");
      img.src = url;
      img.addEventListener(
        "error",
        () => {
          img.replaceWith(
            buildMissingImageNode(
              STRINGS.imageNotSynced,
              img.alt?.trim() || "",
            ),
          );
        },
        { once: true },
      );
    }),
  );
}

function decorateLinks(
  proseEl,
  notePath,
  { onNavigateNote, onAnchor, onToast },
) {
  for (const link of proseEl.querySelectorAll("a")) {
    const info = classifyNoteHref(link.getAttribute("href"), notePath);
    if (info.kind === "external") {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
  proseEl.addEventListener("click", (event) => {
    const anchorEl = event.target.closest?.("a");
    if (!anchorEl) return;
    const rawHref = anchorEl.getAttribute("href");
    const info = classifyNoteHref(rawHref, notePath);
    if (info.kind === "external" || info.kind === "ignore") return;
    event.preventDefault();
    if (info.kind === "anchor") {
      onAnchor(info.anchor);
      return;
    }
    if (info.kind === "note") {
      void onNavigateNote(info.path, info.anchor);
      return;
    }
    onToast(STRINGS.noteMissingToast);
  });
}

function wireHeadingFolding(proseEl) {
  proseEl.addEventListener("click", (event) => {
    const foldBtn = event.target.closest?.(".fold, .section-rail");
    const summary = event.target.closest?.(
      ".note-section.collapsed .section-summary",
    );
    const trigger = foldBtn || summary;
    if (!trigger) return;
    const section = trigger.closest(".note-section");
    if (!section) return;
    event.preventDefault();
    const collapsed = section.classList.toggle("collapsed");
    const expanded = String(!collapsed);
    section
      .querySelector(":scope > :is(h1,h2,h3,h4,h5,h6) > .fold")
      ?.setAttribute("aria-expanded", expanded);
    section
      .querySelector(":scope > .section-rail")
      ?.setAttribute("aria-expanded", expanded);
  });
}

/**
 * Reveals collapsed ancestor sections around `target`.
 */
export function revealElementSection(target) {
  let cursor = target?.parentElement;
  while (cursor) {
    if (
      cursor.classList?.contains("note-section") &&
      cursor.classList.contains("collapsed")
    ) {
      cursor.classList.remove("collapsed");
      cursor
        .querySelector(":scope > :is(h1,h2,h3,h4,h5,h6) > .fold")
        ?.setAttribute("aria-expanded", "true");
      cursor
        .querySelector(":scope > .section-rail")
        ?.setAttribute("aria-expanded", "true");
    }
    cursor = cursor.parentElement;
  }
}

export function scrollToElementOffset(element, topOffset = 58) {
  if (!element) return;
  revealElementSection(element);
  const rect = element.getBoundingClientRect();
  const targetY = Math.max(0, window.scrollY + rect.top - topOffset);
  window.scrollTo({ top: targetY, behavior: "auto" });
}

export function scrollToAnchor(proseEl, anchor, topOffset = 58) {
  const target = findAnchorElement(proseEl, anchor);
  if (!target) return false;
  scrollToElementOffset(target, topOffset);
  return true;
}

/**
 * Scrolls to the nearest rendered block matching 0-based source `line`.
 */
export function scrollToSourceLine(proseEl, sourceText, line, topOffset = 58) {
  if (!Number.isFinite(line) || line <= 0) {
    window.scrollTo({ top: 0, behavior: "auto" });
    return false;
  }
  const offsets = lineOffsets(sourceText);
  const targetOffset = offsets[Math.min(line, offsets.length - 1)] ?? 0;
  const blocks = [...proseEl.querySelectorAll("[data-from], [data-text-from]")];
  if (blocks.length === 0) return false;

  let spanning = null;
  let firstAfter = null;
  let lastBefore = null;
  for (const el of blocks) {
    const from = Number(el.dataset.from ?? el.dataset.textFrom);
    const to = Number(el.dataset.to ?? el.dataset.textTo ?? from);
    if (!Number.isFinite(from)) continue;
    if (from <= targetOffset && targetOffset <= to) {
      spanning = el;
    } else if (from >= targetOffset && !firstAfter) {
      firstAfter = el;
    } else if (from <= targetOffset) {
      lastBefore = el;
    }
  }
  const chosen = spanning || firstAfter || lastBefore || blocks[0];
  scrollToElementOffset(chosen, topOffset);
  return true;
}

/**
 * Renders Markdown prose into `host` and wires math, highlighting, assets, links, and tables.
 */
export async function renderNoteContent(
  host,
  { path, text, library, onNavigateNote, onAnchor, onToast },
) {
  const needs = [];
  if (mayContainMath(text)) needs.push(loadMath().catch(() => null));
  if (mayContainCode(text)) needs.push(loadHighlighter().catch(() => null));
  if (needs.length > 0) await Promise.all(needs);

  const rendered = renderMarkdown(text, "mobile-note", {
    deferMath: false,
    expandCode: false,
  });

  host.replaceChildren();
  if (!text.trim()) {
    const empty = document.createElement("p");
    empty.className = "mobile-note-empty";
    empty.textContent = STRINGS.emptyNote;
    host.append(empty);
    return { headings: [] };
  }

  host.append(rendered.fragment);
  wireCodeBlocks(host, { report: onToast });
  wireSortableTables(host);
  wireHeadingFolding(host);
  decorateLinks(host, path, {
    onNavigateNote,
    onAnchor: (anchor) => onAnchor(anchor, host),
    onToast,
  });
  await resolveNoteImages(host, path, library);
  return { headings: rendered.headings || [] };
}
