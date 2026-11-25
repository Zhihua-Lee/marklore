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
  folderOf,
  resolveRelativePath,
  safeDecodeURIComponent,
} from "./paths.js";
import {
  isIndexNote,
  loadIndexContext,
  renderIndexView,
  splitIndexNote,
} from "./index-view.js";
import { STRINGS } from "./strings.js";

const MOBILE_ASSET_PREFIX = "folio-asset://mobile-note/?path=";
// Where an index note's table of contents goes in its rendered text.
const INDEX_SLOT = "MARKLOREINDEXVIEWSLOT";

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
      const caption = img.alt?.trim() || "";
      img.removeAttribute("width");
      img.removeAttribute("height");
      const url = await library.asset(resolvedPath);
      if (!url) {
        if (!(await library.isRemoteImage?.(resolvedPath))) {
          img.replaceWith(
            buildMissingImageNode(STRINGS.imageNotSynced, caption),
          );
          return;
        }
        // Listed but not on the phone yet: the note shows now, the image
        // follows when it has downloaded.
        const waiting = buildMissingImageNode(
          STRINGS.imageDownloading,
          caption,
        );
        waiting.classList.add("is-loading");
        img.replaceWith(waiting);
        void library.fetchAsset(resolvedPath).then((fetched) => {
          if (!waiting.parentNode) return;
          if (fetched) {
            img.src = fetched;
            waiting.replaceWith(img);
          } else {
            waiting.classList.remove("is-loading");
            waiting.querySelector(".mobile-image-missing-label").textContent =
              STRINGS.imageNotDownloaded;
          }
        });
      } else img.src = url;
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

  // A folder's index note: its entry lists show as the table of contents
  // (the rest of the note as written), like the desktop's index view.
  const split = isIndexNote(path) ? splitIndexNote(text) : null;
  const indexContext = split ? await loadIndexContext(library) : null;
  const rendered = renderMarkdown(
    split ? `${split.before}\n\n${INDEX_SLOT}\n\n${split.after}` : text,
    "mobile-note",
    { deferMath: false, expandCode: false },
  );

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
  // After the links are wired: the view handles its own.
  if (split) {
    const slot = [...host.querySelectorAll("p")].find(
      (p) => p.textContent.trim() === INDEX_SLOT,
    );
    const view = renderIndexView(indexContext, folderOf(path), {
      onOpenNote: (next) => onNavigateNote(next, ""),
    });
    if (slot) slot.replaceWith(view);
    else host.append(view);
  }
  await resolveNoteImages(host, path, library);
  return { headings: rendered.headings || [] };
}
