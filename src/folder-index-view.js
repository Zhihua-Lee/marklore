// A folder's index file (_目录.md, SUMMARY.md) in Read and Edit mode: its
// link list shown as an outline of the folder's pages, the rest of the note
// (front matter, headings, prose, comments) rendered as in any note. Source
// mode shows the Markdown as written.
//
// Each list entry is a row: a fold arrow when pages sit under it (it and
// the guide line down those pages fold them, as a note's sections fold),
// its title (the file in its tooltip, and a quiet mark offering to unify
// the names when the file is named otherwise), and the page's first
// sentence (read from the page, shown only, never written). Clicking opens
// the page. Edit mode
// adds dragging, Tab/Shift+Tab (also Alt+Shift+←/→) to nest or un-nest,
// Alt+↑/↓ to move, new sub-pages, removing an entry from the index (not
// the file) and editing a title in place. An entry whose file is missing
// says so, with create / point elsewhere / remove. Files of the folder the
// index does not list are offered under "not in the index".
//
// Every change is a small edit of the note's text (src/index-list.js) made
// through the source editor, so it is undone, kept as a draft and saved as
// any edit is. Prose is edited by double-clicking it (its Markdown, in place).
import {
  isolateHistory,
  undo,
  redo,
  invertedEffects,
} from "@codemirror/commands";
import { StateEffect } from "@codemirror/state";
import { t } from "../desktop/i18n.mjs";
import { folderEntry, isIndexName } from "../desktop/folder-index.mjs";
import { compareTreeItems, folderDisplayName } from "../desktop/breadcrumb.mjs";
import {
  fileMatches,
  safeFileName,
  setNoteName,
} from "../desktop/note-names.mjs";
import { renderDocument } from "./document-render.js";
import { isDiffDocument } from "./diff-view.js";
import { icon } from "./icons.js";
import * as autoscroll from "./drag-autoscroll.js";
import {
  scanIndex,
  moveEntry,
  indentEntry,
  outdentEntry,
  shiftEntry,
  insertEntry,
  removeEntry,
  retitleEntry,
  relinkEntry,
  noteExcerpt,
  titleFor,
  hrefFor,
  difference,
} from "./index-list.js";
import "./folder-index-view.css";

// Tracks newly created note pages on undo/redo transactions so undoing a
// "new page" step recycles an untouched file and redoing recreates it.
export const createdPageEffect = StateEffect.define();
export const indexHistoryExtension = invertedEffects.of((tr) =>
  tr.effects
    .filter((effect) => effect.is(createdPageEffect))
    .map((effect) =>
      createdPageEffect.of({
        ...effect.value,
        op: effect.value.op === "add" ? "remove" : "add",
      }),
    ),
);

const DRAG_TYPE = "application/x-marklore-index";
// Pages read for their first sentence, at most (an index lists a folder).
const EXCERPT_LIMIT = 200;
// Links main checks at once (desktop/main.mjs "linkStatus").
const STATUS_BATCH = 2000;
// Names of notes (desktop/files.mjs markdownPath); a name with another
// extension is an attachment, which the folder's listing leaves out.
const NOTE_NAME = /\.(md|markdown|mdown|mkd|txt)$/i;
// A file extension ("1.1 Sets" or "v1.2" have none).
const EXTENSION = /\.[a-z][a-z0-9]{0,7}$/i;
const attachment = (name) => EXTENSION.test(name) && !NOTE_NAME.test(name);
// A link to a file elsewhere (not a site, not this note's own anchor).
const localHref = (href) => href && !/^([a-z][a-z0-9+.-]*:|#)/i.test(href);
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// Level-by-level expansion stops cleanly if the next level adds more rows.
const MAX_NEXT_ROWS = 300;

export function createIndexView({
  api,
  host,
  view,
  getDocument,
  // Show the note again (it changed, or what is known about its folder).
  rerender,
  // Open a link of the index, as a click on a link in a note does.
  open,
  report,
  run,
  setMode,
  // The text of a note open in a tab (by file id), when main hands back
  // only its id.
  openText = () => null,
  openPathText = () => null,
  openNote = null,
  openFolder = null,
  newNoteText = () => "",
  // Files were created in the folder: the library tree shows them.
  filesChanged = () => {},
  // Read mode's format bar is on (a double click selects words for it).
  readingFormat = () => false,
  // A folder shown in the library tree (by path): whether it could be.
  revealFolder = async () => false,
  // An entry's note or folder renamed by its new name ({ folderId, name,
  // title, shown }): resolves whether it was.
  renameNote = async () => null,
  undoRename = async () => null,
  canUndoRename = () => null,
  trashNewPage = async () => null,
  recreateNewPage = async () => null,
  // One note's file name and name unified ({ folderId, name, title }), as
  // the library's "统一名字…", where canUnify() says it is offered.
  unifyNote = async () => {},
  canUnify = () => false,
  // An entry folded or unfolded (the note's folds are kept with its tab).
  foldsChanged = () => {},
  outlineChanged = () => {},
}) {
  const states = new WeakMap();
  // Per index file or generated folder: its entries and first sentences.
  const folders = new Map();
  // Lazy subfolder cache keyed by authorized folder id.
  const subfolders = new Map();
  let subVersion = 0;
  let lastShown = null;
  // The reading view's scrolling box.
  const scroller = () => host.parentElement || host;

  const docKey = (doc) =>
    doc?.generated ? "gen:" + doc.generated.folderId : doc?.fileId || null;
  const applies = (doc) =>
    Boolean(doc) &&
    !isDiffDocument(doc) &&
    (Boolean(doc.generated) || isIndexName(doc.name || ""));
  const editing = (doc) =>
    doc.mode === "edit" && !doc.preview && !doc.generated;
  const stateOf = (doc) => {
    let state = states.get(doc);
    if (!state)
      states.set(
        doc,
        (state = {
          tray: false,
          expandToken: 0,
          pendingRename: null,
          justUndidRename: null,
          tooLarge: null,
        }),
      );
    return state;
  };
  const pathLower = (p) =>
    p ? String(p).replace(/\\/g, "/").toLowerCase() : "";
  // An entry's fold, kept with the note's section folds (doc.folds, saved
  // with the session), by the entry's file/link and folder scope.
  const foldKey = (entry, scope = "") =>
    "ix:" +
    (scope ? scope + "/" : "") +
    (entry.name || entry.href || entry.title || "").toLowerCase();
  const isEntryClosed = (doc, fKey, defaultClosed = false) => {
    const folds = doc.folds || [];
    if (folds.includes(fKey)) return true;
    if (folds.includes("+" + fKey)) return false;
    return defaultClosed;
  };
  const setFoldKey = (doc, fKey, defaultClosed, closed) => {
    const folds = (doc.folds || []).filter(
      (other) => other !== fKey && other !== "+" + fKey,
    );
    if (closed !== defaultClosed) folds.push(closed ? fKey : "+" + fKey);
    doc.folds = folds;
  };
  // The folder's entries by name (any letter case).
  const childOf = (info, name) =>
    name && info?.status === "ready"
      ? info.byName.get(name.toLowerCase()) || null
      : null;
  function setChildren(info, children) {
    info.children = children;
    info.byName = new Map();
    for (const child of children)
      if (!info.byName.has(child.name.toLowerCase()))
        info.byName.set(child.name.toLowerCase(), child);
  }
  function addChild(info, child) {
    const lower = child.name.toLowerCase();
    if (!info.byName.has(lower)) info.children.push(child);
    else
      info.children = info.children.map((item) =>
        item.name.toLowerCase() === lower ? child : item,
      );
    info.byName.set(lower, child);
  }
  function removeChild(info, name) {
    if (!info || !name) return;
    const lower = name.toLowerCase();
    info.children = info.children.filter(
      (child) => child.name.toLowerCase() !== lower,
    );
    info.byName.delete(lower);
  }
  // Is the entry's file missing? A file of the folder that is not listed (a
  // note or folder named), or a link deeper or outside that main reports
  // missing. Attachments are not listed by the folder: not known missing.
  function isMissing(info, entry) {
    if (info?.status !== "ready") return false;
    if (entry.name)
      return !childOf(info, entry.name) && !attachment(entry.name);
    return info.statuses.get(target(entry.href)) === "missing-file";
  }

  // ── What is known about the folder ──
  function folderOf(doc) {
    const dKey = docKey(doc);
    if (!dKey) return null;
    if (!doc.generated && (!api?.currentFolder || !api?.list)) return null;
    if (doc.generated && !api?.list && !api?.folderIndexText) return null;
    let info = folders.get(dKey);
    if (!info) {
      info = {
        status: "loading",
        folderId: doc.generated?.folderId ?? null,
        folderName: doc.generated?.name ?? null,
        folderPath: doc.generated?.path ?? null,
        children: [],
        byName: new Map(),
        excerpts: new Map(),
        asked: new Set(),
        // Links deeper or outside the folder: main's answer, by href.
        statuses: new Map(),
        checking: new Set(),
        version: 0,
      };
      folders.set(dKey, info);
      load(doc, info);
    }
    return info;
  }
  async function load(doc, info) {
    const dKey = docKey(doc);
    try {
      if (doc.generated) {
        const res = api?.folderIndexText
          ? await api.folderIndexText(doc.generated.folderId)
          : null;
        const items =
          res?.items ?? (await api.list?.(doc.generated.folderId)) ?? [];
        setChildren(info, items);
        info.folderId = doc.generated.folderId;
        info.folderPath = res?.folder?.path ?? doc.generated.path;
        info.folderName = res?.folder?.name ?? doc.generated.name;
        info.status = "ready";
      } else {
        const folder = await api.currentFolder(doc.fileId);
        setChildren(info, (await api.list(folder.id)) || []);
        info.folderId = folder.id;
        info.folderPath = folder.path;
        info.folderName = folder.name;
        info.status = "ready";
        // Files came or went: deeper links are asked about again.
        info.statuses.clear();
        info.checking.clear();
      }
    } catch {
      // Listed before: what was known stays.
      if (info.status !== "ready") info.status = "error";
    }
    if (folders.get(dKey) !== info) return;
    info.version++;
    refresh(doc);
  }
  function ensureSubfolder(doc, folderId, meta = {}, { silent = false } = {}) {
    if (!folderId) return null;
    let sub = subfolders.get(folderId);
    if (sub && !sub.stale) return sub;
    if (!sub) {
      sub = {
        status: "loading",
        folder: {
          id: folderId,
          name: meta.name || "",
          path: meta.path || "",
        },
        index: null,
        text: null,
        items: [],
        byName: new Map(),
        stale: false,
        promise: null,
      };
      subfolders.set(folderId, sub);
    } else {
      sub.stale = false;
    }
    if (sub.promise) return sub;
    sub.promise = (async () => {
      try {
        const res = api?.folderIndexText
          ? await api.folderIndexText(folderId)
          : null;
        if (res && typeof res === "object") {
          sub.folder = res.folder || sub.folder;
          sub.index = res.index || null;
          sub.text = typeof res.text === "string" ? res.text : null;
          sub.items = Array.isArray(res.items) ? res.items : [];
        } else if (api?.list) {
          const items = (await api.list(folderId)) || [];
          const indexItem = items.find(
            (c) => !c.directory && (c.index || isIndexName(c.name)),
          );
          sub.index = indexItem
            ? { name: indexItem.name, path: indexItem.path }
            : null;
          sub.text = indexItem?.path ? openPathText(indexItem.path) : null;
          sub.items = items;
        }
        sub.byName = new Map();
        for (const item of sub.items)
          if (!sub.byName.has(item.name.toLowerCase()))
            sub.byName.set(item.name.toLowerCase(), item);
        sub.status = "ready";
      } catch {
        sub.status = "error";
      } finally {
        sub.promise = null;
      }
      subVersion++;
      if (!silent && doc && getDocument() === doc) refresh(doc);
    })();
    return sub;
  }
  // Shown again for what was learnt in the background, unless a title, a
  // block or a choice is being typed in the view: then once it closes.
  let pending = null;
  const inlineEditor = () =>
    host.querySelector(
      ".ix-title-input, .ix-block-editor, .ix-relocate, .ix-new-row",
    );
  function refresh(doc) {
    if (inlineEditor()) pending = doc;
    else rerender(doc);
  }
  function flush() {
    const doc = pending;
    pending = null;
    if (doc && !inlineEditor()) rerender(doc);
  }
  // Whether links deeper or outside the folder lead somewhere, asked in
  // parts main accepts.
  async function loadStatuses(doc, info) {
    if (!api?.linkStatus || !doc.fileId || info.status !== "ready") return;
    const hrefs = [];
    for (const entry of scanIndex(doc.text).entries) {
      const href = target(entry.href);
      if (entry.name || !localHref(href) || info.checking.has(href)) continue;
      info.checking.add(href);
      hrefs.push(href);
    }
    if (!hrefs.length) return;
    let missing = false;
    for (let i = 0; i < hrefs.length; i += STATUS_BATCH) {
      const part = hrefs.slice(i, i + STATUS_BATCH);
      const results = await api.linkStatus(doc.fileId, part).catch(() => null);
      part.forEach((href, k) => {
        const status = results?.[k] || "ok";
        info.statuses.set(href, status);
        if (status === "missing-file") missing = true;
      });
    }
    if (!missing || folders.get(doc.fileId) !== info) return;
    info.version++;
    refresh(doc);
  }
  // The first sentence of each visible page not read yet (up to EXCERPT_LIMIT).
  async function loadExcerpts(doc, info, visibleNotes = []) {
    if (info?.status !== "ready" || (!api?.preview && !api?.previewChild))
      return;
    const dKey = docKey(doc);
    const wanted = [];
    for (const row of visibleNotes) {
      if (info.asked.has(row.excerptKey)) continue;
      if (info.asked.size >= EXCERPT_LIMIT) break;
      info.asked.add(row.excerptKey);
      wanted.push(row);
    }
    if (!wanted.length) return;
    let next = 0;
    const worker = async () => {
      while (next < wanted.length) {
        const row = wanted[next++];
        let text = "";
        try {
          let file = null;
          if (row.isOwnFolder && doc.fileId && api?.preview) {
            file = await api.preview(doc.fileId, hrefFor(row.childName));
          } else if (api?.previewChild && row.folderId) {
            file = await api.previewChild(row.folderId, row.childName);
          } else if (doc.fileId && api?.preview && row.relHref) {
            file = await api.preview(doc.fileId, row.relHref);
          }
          // A file main knows already (opened before) comes back without
          // its text: an open tab's, else read from disk.
          text =
            typeof file?.text === "string"
              ? file.text
              : (openText(file?.id) ??
                (row.childPath ? openPathText(row.childPath) : null) ??
                (file?.id && api.read
                  ? (await api.read(file.id))?.text
                  : null) ??
                "");
        } catch {
          /* Shown without a sentence. */
        }
        info.excerpts.set(
          row.excerptKey,
          noteExcerpt(typeof text === "string" ? text : "", row.title),
        );
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (folders.get(dKey) !== info) return;
    info.version++;
    refresh(doc);
  }
  function collectVisibleNotesFromDom(doc, info) {
    const out = [];
    for (const item of host.querySelectorAll(".ix-item")) {
      if (item.dataset.kind === "folder" || item.classList.contains("missing"))
        continue;
      if (item.parentElement?.closest(".ix-item.closed")) continue;
      const childFile = item.dataset.childFile;
      if (!childFile) continue;
      const ownerFolderId =
        item.dataset.ownerFolderId || info?.folderId || null;
      const childPath = item.dataset.childPath || "";
      const isOwnFolder = item.dataset.nested !== "true" && !doc.generated;
      const excerptKey = isOwnFolder
        ? "own:" + childFile.toLowerCase()
        : (
            pathLower(childPath) || ownerFolderId + "/" + childFile
          ).toLowerCase();
      const title =
        item.querySelector(":scope > .ix-row > .ix-title")?.textContent ?? "";
      out.push({
        excerptKey,
        folderId: ownerFolderId,
        isOwnFolder,
        childName: childFile,
        childPath,
        relHref: item.dataset.relHref || null,
        title,
      });
    }
    return out;
  }
  // "library": files were created, renamed or removed: the shown index's
  // folder is listed again (the view stays as it is until then), others
  // when shown. "links": notes changed: their first sentences are read
  // again when the index is next shown (not at every save, nor while a
  // large library is being read).
  function invalidate(kind = "library") {
    const doc = getDocument();
    const dKey = applies(doc) ? docKey(doc) : null;
    const shownInfo = dKey ? folders.get(dKey) : null;
    if (kind === "links") {
      for (const info of folders.values()) info.stale = true;
      for (const sub of subfolders.values()) sub.stale = true;
      return;
    }
    subfolders.clear();
    subVersion++;
    if (doc) stateOf(doc).tooLarge = null;
    for (const [id, info] of folders)
      if (info !== shownInfo) folders.delete(id);
    if (shownInfo) load(doc, shownInfo);
  }
  // The app shows this note now (any note, every time it is shown): an
  // index shown again after notes changed reads their first sentences anew.
  function shown(doc) {
    if (doc === lastShown) return;
    lastShown = doc;
    const dKey = applies(doc) ? docKey(doc) : null;
    const info = dKey ? folders.get(dKey) : null;
    if (!info?.stale) return;
    info.excerpts.clear();
    info.asked.clear();
    info.stale = false;
    info.version++;
  }
  // What the shown view depends on besides the text.
  function key(doc) {
    const dKey = docKey(doc);
    const info = dKey ? folders.get(dKey) : null;
    const folds = (doc.folds || []).join(",");
    return `${doc.mode}|${doc.preview ? 1 : 0}|${doc.generated ? doc.generated.folderId : ""}|${info ? info.status + info.version : "-"}|${subVersion}|${folds}`;
  }

  // ── Rendering ──
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const button = (className, label, content, action) => {
    const b = element("button", className);
    b.type = "button";
    b.tabIndex = -1;
    if (action) b.dataset.ix = action;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (content) b.innerHTML = content;
    else b.textContent = label;
    return b;
  };
  // The link's target as an href attribute (angle brackets and a link
  // title left out).
  const target = (href) => {
    const m = /^\s*(<[^>]*>|\S*)/.exec(href)[1];
    return m.startsWith("<") ? encodeURI(m.slice(1, -1)) : m;
  };

  function render(doc) {
    const info = folderOf(doc);
    if (doc.generated) {
      const headingTitle = doc.generated.title || doc.generated.name;
      const syntheticText = `# ${headingTitle}\n\n`;
      const result = renderDocument(
        { ...doc, text: syntheticText },
        { deferMath: true, interactiveTasks: true },
      );
      const fragment = result.fragment;
      const context = {
        doc,
        scan: { entries: [], lines: [], runs: [] },
        info,
        edit: false,
        state: stateOf(doc),
        first: true,
        visibleNotes: [],
      };
      if (info?.status === "ready") {
        const items = info.children
          .filter((c) => !c.index && !isIndexName(c.name))
          .sort(compareTreeItems);
        if (items.length) {
          const list = element("div", "ix-list");
          list.setAttribute("role", "tree");
          list.setAttribute("aria-label", t("目录中的页面"));
          const ancestors = info.folderPath
            ? new Set([pathLower(info.folderPath)])
            : new Set();
          items.forEach((child, ord) =>
            list.append(
              treeItemNode(context, {
                child,
                folderId: info.folderId,
                folderPath: info.folderPath,
                scope: "",
                relPrefix: "",
                nested: false,
                level: 1,
                from: syntheticText.length + ord,
                to: syntheticText.length + ord,
                ixId: "gen:" + child.name.toLowerCase(),
                hidden: false,
                ancestors,
              }),
            ),
          );
          fragment.append(list);
          loadExcerpts(doc, info, context.visibleNotes);
        } else {
          fragment.append(element("p", "ix-empty", t("暂无笔记或子文件夹")));
        }
      }
      const box = document.createElement("div");
      for (const node of fragment.childNodes) box.append(node.cloneNode(true));
      const html = box.innerHTML;
      return {
        ...result,
        html,
        fragment,
        bytes: html.length * 12 + (result.bytes - result.html.length * 12 || 0),
      };
    }

    const scan = scanIndex(doc.text);
    // The list lines blanked (same length: every other block keeps its
    // source positions), the note rendered, the lists put in their places.
    let masked = doc.text;
    if (scan.runs.length) {
      const parts = [];
      let from = 0;
      for (const run of scan.runs) {
        const start = scan.lines[run.first].start,
          end = scan.lines[run.last].start + scan.lines[run.last].text.length;
        parts.push(
          doc.text.slice(from, start),
          doc.text.slice(start, end).replace(/[^\r\n]/g, " "),
        );
        from = end;
      }
      parts.push(doc.text.slice(from));
      masked = parts.join("");
    }
    const result = renderDocument(
      { ...doc, text: masked },
      { deferMath: true, interactiveTasks: true },
    );
    const fragment = result.fragment;
    const context = {
      doc,
      scan,
      info,
      edit: editing(doc),
      state: stateOf(doc),
      first: true,
      visibleNotes: [],
    };
    for (const run of scan.runs) {
      const list = runNode(context, run);
      place(fragment, scan.lines[run.first].start, list);
    }
    if (info?.status === "ready") {
      loadExcerpts(doc, info, context.visibleNotes);
      loadStatuses(doc, info);
    }
    // Edit mode: HTML comments show as their source, to be edited in
    // place like any block (they render as nothing).
    if (context.edit)
      for (const block of commentBlocks(scan)) {
        const node = element("pre", "ix-comment", block.text);
        node.dataset.from = String(block.from);
        node.dataset.to = String(block.to);
        place(fragment, block.from, node);
      }
    // At the end of the note, outside any section: folding the last one
    // never hides the new page button or the files not listed.
    const footer = footerNode(context);
    if (footer) fragment.append(footer);
    if (context.edit)
      for (const block of proseBlocks(fragment)) {
        block.classList.add("ix-prose");
        block.title = t("双击编辑这段文字");
      }
    const box = document.createElement("div");
    for (const node of fragment.childNodes) box.append(node.cloneNode(true));
    const html = box.innerHTML;
    return {
      ...result,
      html,
      fragment,
      bytes: html.length * 12 + (result.bytes - result.html.length * 12 || 0),
    };
  }
  // Where a line ends (its line ending left out).
  const lineEnd = (scan, k) => scan.lines[k].start + scan.lines[k].text.length;
  // The note's HTML comment blocks (a line starting with `<!--` up to the
  // line holding `-->`), outside front matter and code.
  function commentBlocks(scan) {
    const { lines, skip } = scan;
    const out = [];
    let i = 0;
    if (lines.length > 1 && skip[0] && /^---[ \t]*$/.test(lines[0].text)) {
      i = 1;
      while (i < lines.length && !/^(---|\.\.\.)[ \t]*$/.test(lines[i].text))
        i++;
      i++;
    }
    let fence = null;
    for (; i < lines.length; i++) {
      const text = lines[i].text;
      if (fence) {
        const m = FENCE.exec(text);
        if (
          m &&
          m[1][0] === fence[0] &&
          m[1].length >= fence.length &&
          !text.slice(m[0].length).trim()
        )
          fence = null;
        continue;
      }
      const open = FENCE.exec(text);
      if (open) {
        fence = open[1];
        continue;
      }
      if (!/^ {0,3}<!--/.test(text)) continue;
      let end = i;
      if (!text.includes("-->", text.indexOf("<!--") + 4)) {
        end = i + 1;
        while (end < lines.length && !lines[end].text.includes("-->")) end++;
        end = Math.min(end, lines.length - 1);
      }
      const from = lines[i].start,
        to = lineEnd(scan, end);
      out.push({ from, to, text: scan.source.slice(from, to) });
      i = end;
    }
    return out;
  }
  // A list put after the last block that starts before it (inside the
  // section of the heading above it).
  function startOf(node) {
    if (node.nodeType !== 1) return null;
    const value =
      node.getAttribute("data-from") ??
      node.querySelector("[data-from]")?.getAttribute("data-from");
    return value == null ? null : Number(value);
  }
  function place(container, offset, node) {
    let last = null;
    for (const child of container.children) {
      const start = startOf(child);
      if (start != null && start >= offset) break;
      last = child;
    }
    if (last?.classList.contains("note-section")) {
      const body = last.querySelector(":scope > .section-body");
      if (body) return place(body, offset, node);
    }
    if (last) last.after(node);
    else container.prepend(node);
  }
  function proseBlocks(root) {
    const out = [];
    const walk = (container) => {
      for (const child of container.children) {
        if (child.matches(".ix-list, .ix-footer, .front-matter")) continue;
        if (child.matches(".note-section")) {
          if (child.firstElementChild?.matches("h1,h2,h3,h4,h5,h6"))
            out.push(child.firstElementChild);
          const body = child.querySelector(":scope > .section-body");
          if (body) walk(body);
        } else if (startOf(child) != null) out.push(child);
      }
    };
    walk(root);
    return out;
  }
  function runNode(context, run) {
    const { info, scan } = context;
    const list = element("div", "ix-list");
    list.setAttribute("role", "tree");
    list.setAttribute("aria-label", t("目录中的页面"));
    list.dataset.run = String(run.index);
    // Its place in the note, as other blocks have, so the place read is
    // kept when the note is shown again or the mode switched.
    list.dataset.from = String(scan.lines[run.first].start);
    list.dataset.to = String(lineEnd(scan, run.last));
    const scope = {
      scan,
      folderInfo: info,
      folderId: info?.folderId ?? null,
      folderPath: info?.folderPath ?? null,
      scope: "",
      relPrefix: "",
      nested: false,
      hidden: false,
      levelBase: 1,
      inheritFrom: null,
      inheritTo: null,
      ancestors: info?.folderPath
        ? new Set([pathLower(info.folderPath)])
        : new Set(),
    };
    for (const i of run.roots) list.append(itemNode(context, scope, i));
    return list;
  }
  // The mark beside a note whose file is named otherwise than its name: a
  // click unifies them (the library's "统一名字…" for that note).
  function nameMark(fileName) {
    const mark = button(
      "name-mark",
      t("文件名“{name}”与标题不同，点击统一名字", { name: fileName }),
      " ",
      "unify",
    );
    mark.dataset.name = fileName;
    return mark;
  }
  // The last line of an entry and the entries under it.
  function lastLine(scan, i) {
    const entry = scan.entries[i];
    return entry.children.length
      ? lastLine(scan, entry.children.at(-1))
      : entry.line;
  }
  // The entries under an entry, at any depth.
  const pagesUnder = (scan, i) =>
    scan.entries[i].children.reduce(
      (sum, k) => sum + 1 + pagesUnder(scan, k),
      0,
    );
  function resolveSubfolderChildren(subInfo) {
    if (!subInfo || subInfo.status !== "ready") return null;
    if (subInfo.index) {
      const live = openPathText(subInfo.index.path) ?? subInfo.text;
      if (typeof live === "string") {
        const subScan = scanIndex(live);
        const roots = subScan.runs.flatMap((run) => run.roots);
        return { kind: "scan", sub: subInfo, scan: subScan, roots };
      }
    }
    const items = subInfo.items
      .filter((c) => !c.index && !isIndexName(c.name))
      .sort(compareTreeItems);
    return { kind: "items", sub: subInfo, items };
  }
  function countResolvedSubNodes(resolved) {
    if (!resolved) return 0;
    if (resolved.kind === "items") return resolved.items.length;
    return resolved.scan.entries.length;
  }
  function buildItemElement(context, opts) {
    const { info, edit, doc, visibleNotes } = context;
    const {
      level,
      ixId,
      line,
      href,
      from,
      to,
      entryTitle,
      entryLabel = null,
      entryName,
      restText = "",
      child,
      isFolder,
      missing,
      ownerFolderId,
      ownerFolderPath,
      relPrefix,
      nested,
      hidden,
      scopeKey,
      hasOwnChildren,
      ownCount = 0,
      ancestors,
      renderOwnChildren,
    } = opts;
    const item = element("div", "ix-item");
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", String(level));
    item.dataset.ixId = ixId;
    item.dataset.line = String(line);
    item.dataset.href = href;
    item.dataset.from = String(from);
    item.dataset.to = String(to);
    if (nested) item.dataset.nested = "true";
    if (ownerFolderId) item.dataset.ownerFolderId = String(ownerFolderId);
    if (ownerFolderPath) item.dataset.ownerFolderPath = ownerFolderPath;
    item.tabIndex = context.first ? 0 : -1;
    context.first = false;

    const row = element("div", "ix-row");
    if (missing) item.classList.add("missing");
    if (isFolder) item.dataset.kind = "folder";

    const canFollowSubfolder =
      Boolean(isFolder && child?.id) &&
      (!child.path || !ancestors.has(pathLower(child.path)));
    const rawSub = canFollowSubfolder ? subfolders.get(child.id) : null;
    const resolvedSub =
      rawSub?.status === "ready" ? resolveSubfolderChildren(rawSub) : null;
    const subCount = resolvedSub ? countResolvedSubNodes(resolvedSub) : 0;
    const subfolderEmpty = resolvedSub != null && subCount === 0;
    const subfolderError = rawSub?.status === "error";
    const expandable =
      hasOwnChildren ||
      (canFollowSubfolder && !subfolderEmpty && !subfolderError);

    const isOwnFolder = !nested && !doc.generated;
    const rowEdit = edit && isOwnFolder;
    const name = isFolder
      ? folderDisplayName({
          folderName: child?.name || entryName || "",
          parentEntryText: line >= 0 ? (entryLabel ?? entryTitle) : null,
          indexHeading: child?.title ?? null,
          indexText: rawSub?.text ?? null,
        })
      : child?.title || entryTitle;

    if (isFolder && child?.id) {
      item.dataset.childId = String(child.id);
      item.dataset.childName = child.name || entryName || name;
      item.dataset.childTitle = name;
      if (child.path) item.dataset.childPath = child.path;
    } else if (!isFolder && child) {
      item.dataset.childFile = child.name;
      if (child.path) item.dataset.childPath = child.path;
      item.dataset.relHref = relPrefix + hrefFor(child.name);
    }

    const fKey = foldKey({ name: entryName, href, title: name }, scopeKey);
    // Default: two levels open on first open (level-1 entries and top-level
    // own note hierarchies start open; level-2+ subfolders and nested
    // subfolder items start closed and load lazily).
    const defaultClosed =
      level >= 2 && (nested || Boolean(doc.generated) || isFolder);
    const closed = expandable ? isEntryClosed(doc, fKey, defaultClosed) : false;

    let rail = null;
    if (expandable) {
      const label = t("展开或折叠 {name} 的子页", { name });
      item.setAttribute("aria-expanded", String(!closed));
      item.dataset.foldKey = fKey;
      item.dataset.defaultClosed = defaultClosed ? "true" : "false";
      if (closed) item.classList.add("closed");
      const arrow = button("ix-twisty", label, " ", "fold");
      arrow.setAttribute("aria-expanded", String(!closed));
      row.append(arrow);
      rail = button("ix-rail", label, " ", "fold");
      rail.setAttribute("aria-expanded", String(!closed));
    } else {
      row.append(element("span", "ix-twisty-space"));
    }

    let title;
    if (missing) title = element("span", "ix-title", name);
    else {
      title = element("a", "ix-title", name);
      title.setAttribute("href", target(href));
      title.tabIndex = -1;
      if (rowEdit) title.draggable = false;
    }
    const written = entryName
      ? entryName + (isFolder ? "/" : "")
      : target(href);
    title.title =
      (rowEdit && !missing
        ? t("{title}（Ctrl+单击打开，双击改标题）", { title: name })
        : name) + (written ? "\n" + written : "");
    row.append(title);

    if (
      isOwnFolder &&
      canUnify() &&
      info?.folderId &&
      child &&
      !child.directory &&
      child.title &&
      !fileMatches(child.title, child.name)
    )
      row.append(nameMark(child.name));

    const totalCount = ownCount + subCount;
    if (expandable && totalCount > 0) {
      row.append(
        element(
          "span",
          "ix-count",
          totalCount === 1 ? t("1 页") : t("{count} 页", { count: totalCount }),
        ),
      );
    }

    const excerptKey = isOwnFolder
      ? child
        ? "own:" + child.name.toLowerCase()
        : null
      : child && !isFolder
        ? (
            pathLower(child.path) || ownerFolderId + "/" + child.name
          ).toLowerCase()
        : null;

    if (!hidden && !isFolder && child && !child.directory && excerptKey) {
      visibleNotes.push({
        excerptKey,
        folderId: ownerFolderId,
        isOwnFolder,
        childName: child.name,
        childPath: child.path || "",
        relHref: relPrefix + hrefFor(child.name),
        title: entryTitle,
      });
    }

    if (missing) {
      row.append(element("span", "ix-missing", t("不存在")));
      if (!doc.preview && isOwnFolder) {
        const actions = element("span", "ix-repair");
        if (entryName)
          actions.append(button("ix-text-button", t("创建"), null, "create"));
        actions.append(
          button("ix-text-button", t("改为指向…"), null, "relocate"),
          button("ix-text-button", t("移出目录"), null, "remove"),
        );
        row.append(actions);
      }
    } else {
      const rest = restText.trim();
      const excerpt = excerptKey ? info?.excerpts.get(excerptKey) : "";
      if (rest) row.append(element("span", "ix-rest", rest));
      else if (excerpt) row.append(element("span", "ix-excerpt", excerpt));
    }

    const hasOpenFolder = Boolean(isFolder && !missing && child?.id);
    if (hasOpenFolder || rowEdit) {
      const actions = element("span", "ix-row-actions");
      if (hasOpenFolder)
        actions.append(
          button(
            "ix-open-folder",
            t("打开此目录"),
            icon("open"),
            "open-folder",
          ),
        );
      if (rowEdit) {
        row.draggable = true;
        const tools = element("span", "ix-tools");
        if (info?.folderId)
          tools.append(button("ix-tool", t("新建子页"), icon("plus"), "child"));
        tools.append(
          button("ix-tool", t("改标题"), icon("pencil"), "rename"),
          button(
            "ix-tool",
            t("移出目录（不删除文件）"),
            icon("close"),
            "remove",
          ),
        );
        actions.append(tools);
      }
      row.append(actions);
    }

    item.append(row);

    // Lazily load expanded subfolder if not loaded yet.
    if (!hidden && !closed && canFollowSubfolder && (!rawSub || rawSub.stale)) {
      ensureSubfolder(doc, child.id, {
        id: child.id,
        name: child.name,
        path: child.path,
      });
    }

    if (expandable) {
      const group = element("div", "ix-children");
      group.setAttribute("role", "group");
      group.append(rail);
      const childHidden = hidden || closed;
      if (hasOwnChildren && renderOwnChildren)
        renderOwnChildren(group, childHidden);
      if (resolvedSub && subCount > 0) {
        const nextAncestors = new Set(ancestors);
        if (child.path) nextAncestors.add(pathLower(child.path));
        const nextScope =
          (scopeKey ? scopeKey + "/" : "") + child.name.toLowerCase();
        const nextRel = relPrefix + hrefFor(child.name, true);
        if (resolvedSub.kind === "scan") {
          const subScope = {
            scan: resolvedSub.scan,
            folderInfo: resolvedSub.sub,
            folderId: child.id,
            folderPath: child.path || "",
            scope: nextScope,
            relPrefix: nextRel,
            nested: true,
            hidden: childHidden,
            levelBase: level + 1,
            inheritFrom: from,
            inheritTo: to,
            ancestors: nextAncestors,
          };
          for (const k of resolvedSub.roots)
            group.append(itemNode(context, subScope, k));
        } else {
          for (const subChild of resolvedSub.items) {
            group.append(
              treeItemNode(context, {
                child: subChild,
                folderId: child.id,
                folderPath: child.path || "",
                scope: nextScope,
                relPrefix: nextRel,
                nested: true,
                level: level + 1,
                from,
                to,
                ixId: nextScope + ":N:" + subChild.name.toLowerCase(),
                hidden: childHidden,
                ancestors: nextAncestors,
              }),
            );
          }
        }
      }
      item.append(group);
    }
    return item;
  }
  function itemNode(context, scopeCtx, i) {
    const { info, doc } = context;
    const {
      scan,
      folderInfo,
      folderId,
      folderPath,
      scope,
      relPrefix,
      nested,
      hidden,
      levelBase,
      inheritFrom,
      inheritTo,
      ancestors,
    } = scopeCtx;
    const entry = scan.entries[i];
    const lookupInfo = nested ? folderInfo : info;
    const child = nested
      ? (entry.name && lookupInfo?.byName?.get(entry.name.toLowerCase())) ||
        null
      : childOf(info, entry.name);
    const missing = nested
      ? Boolean(entry.name && !child && !attachment(entry.name))
      : isMissing(info, entry);
    const isFolder = folderEntry(entry, (n) =>
      Boolean(
        (nested ? lookupInfo?.byName?.get(n.toLowerCase()) : childOf(info, n))
          ?.directory,
      ),
    );
    const level = levelBase + entry.depth;
    const from =
      inheritFrom != null ? inheritFrom : scan.lines[entry.line].start;
    const to = inheritTo != null ? inheritTo : lineEnd(scan, lastLine(scan, i));
    const ixId = nested
      ? (scope || "sub") + ":L" + entry.line
      : "own:" + entry.line;
    return buildItemElement(context, {
      level,
      ixId,
      line: entry.line,
      href: entry.href,
      from,
      to,
      entryTitle: entry.title,
      entryLabel: entry.label,
      entryName: entry.name,
      restText: entry.rest,
      child,
      isFolder,
      missing,
      ownerFolderId: folderId,
      ownerFolderPath: folderPath,
      relPrefix,
      nested,
      hidden,
      scopeKey: scope,
      hasOwnChildren: entry.children.length > 0,
      ownCount: pagesUnder(scan, i),
      ancestors,
      renderOwnChildren: (group, childHidden) => {
        const nextCtx =
          childHidden === hidden
            ? scopeCtx
            : { ...scopeCtx, hidden: childHidden };
        for (const k of entry.children)
          group.append(itemNode(context, nextCtx, k));
      },
    });
  }
  function treeItemNode(context, opts) {
    const {
      child,
      folderId,
      folderPath,
      scope,
      relPrefix,
      nested,
      level,
      from,
      to,
      ixId,
      hidden,
      ancestors,
    } = opts;
    const isFolder = Boolean(child.directory);
    const titleText = isFolder
      ? folderDisplayName({
          folderName: child.name,
          indexHeading: child.title ?? null,
        })
      : child.title || titleFor(child.name);
    return buildItemElement(context, {
      level,
      ixId,
      line: -1,
      href: hrefFor(child.name, isFolder),
      from,
      to,
      entryTitle: titleText,
      entryLabel: null,
      entryName: child.name,
      restText: "",
      child,
      isFolder,
      missing: false,
      ownerFolderId: folderId,
      ownerFolderPath: folderPath,
      relPrefix,
      nested,
      hidden,
      scopeKey: scope,
      hasOwnChildren: false,
      ownCount: 0,
      ancestors,
      renderOwnChildren: null,
    });
  }
  function footerNode({ doc, scan, info, edit, state }) {
    const footer = element("div", "ix-footer");
    if (edit && info?.folderId) {
      const add = button("ix-new", t("新建页面"), null, "new");
      add.tabIndex = 0;
      add.innerHTML = `${icon("plus")}<span>${t("新建页面")}</span>`;
      footer.append(add);
    }
    if (info?.status === "ready") {
      const listed = new Set(
        scan.entries.map((entry) => entry.name?.toLowerCase()).filter(Boolean),
      );
      const own = (doc.name || "").toLowerCase();
      const unlisted = info.children.filter(
        (child) =>
          !child.index &&
          !isIndexName(child.name) &&
          child.name.toLowerCase() !== own &&
          !listed.has(child.name.toLowerCase()),
      );
      if (unlisted.length) {
        const tray = element("div", "ix-unlisted");
        if (!state.tray) tray.classList.add("closed");
        const toggle = button(
          "ix-unlisted-toggle",
          t("未列入目录（{count}）", { count: unlisted.length }),
          null,
          "tray",
        );
        toggle.tabIndex = 0;
        toggle.setAttribute("aria-expanded", String(state.tray));
        tray.append(toggle);
        const items = element("div", "ix-unlisted-items");
        for (const child of unlisted) {
          const row = element("div", "ix-unlisted-item");
          row.dataset.name = child.name;
          row.dataset.directory = String(Boolean(child.directory));
          if (child.directory) row.dataset.kind = "folder";
          const displayText = child.directory
            ? folderDisplayName({
                folderName: child.name,
                indexHeading: child.title ?? null,
              })
            : child.title || child.name;
          const link = element("a", "ix-title", displayText);
          link.setAttribute("href", hrefFor(child.name, child.directory));
          link.title = child.title
            ? child.title + "\n" + child.name
            : child.name;
          row.append(link);
          if (
            canUnify() &&
            info.folderId &&
            !child.directory &&
            child.title &&
            !fileMatches(child.title, child.name)
          )
            row.append(nameMark(child.name));
          if (edit) {
            row.draggable = true;
            link.draggable = false;
            row.append(button("ix-text-button", t("加入目录"), null, "add"));
          }
          items.append(row);
        }
        tray.append(items);
        footer.append(tray);
      }
    }
    return footer.childNodes.length ? footer : null;
  }

  // ── Editing ──
  // The entry an item shows, in the note as it is now (null, and shown
  // again, when the note changed under the view).
  function entryAt(item) {
    const doc = getDocument();
    if (
      !applies(doc) ||
      doc.generated ||
      !item ||
      item.dataset.nested === "true"
    )
      return null;
    const scan = scanIndex(doc.text);
    const line = Number(item.dataset.line);
    const index = scan.entries.findIndex((entry) => entry.line === line);
    if (index < 0 || scan.entries[index].href !== item.dataset.href) {
      rerender(doc);
      return null;
    }
    return { doc, scan, index, entry: scan.entries[index] };
  }
  // One edit of the note: one step to undo.
  function apply(
    doc,
    result,
    { effects = [], fallbackLine = null, refocus = true } = {},
  ) {
    if (!result || getDocument() !== doc) return false;
    if (view.state.doc.toString() !== doc.text) {
      report(t("目录正在更新，请稍后再试。"));
      return false;
    }
    const scrollTop = scroller()?.scrollTop;
    const st = stateOf(doc);
    st.pendingRename = null;
    st.justUndidRename = null;
    // The entry acted on is shown anew; the focus goes to it after.
    if (host.contains(document.activeElement)) document.activeElement.blur();
    view.dispatch({
      changes: result.change,
      effects,
      annotations: isolateHistory.of("full"),
      userEvent: "input.index",
    });
    pending = null;
    rerender(doc);
    if (scrollTop != null && scroller()) scroller().scrollTop = scrollTop;
    if (refocus) {
      if (result.line != null) {
        if (!focusLine(result.line, { preventScroll: true }))
          focusNear(result.line, { preventScroll: true });
      } else {
        focusNear(fallbackLine ?? 0, { preventScroll: true });
      }
    }
    return true;
  }
  function focusLine(line, opts = {}) {
    const item = host.querySelector(`.ix-item[data-line="${line}"]`);
    if (!item) return false;
    focusItem(item, true, opts);
    return true;
  }
  // The entry at a line, else the nearest after it, else the last.
  function focusNear(line = 0, opts = {}) {
    const items = visibleItems();
    if (!items.length) {
      scroller()?.focus?.({ preventScroll: Boolean(opts.preventScroll) });
      return;
    }
    focusItem(
      items.find((item) => Number(item.dataset.line) >= line) || items.at(-1),
      true,
      opts,
    );
  }
  // An inline editor closed without a change: what came meanwhile is
  // shown, the keys back on the entry.
  function closed(item) {
    const line = item.dataset.line;
    flush();
    if (item.isConnected) focusItem(item);
    else focusLine(line);
  }
  async function handlePageEffects(doc, effects) {
    const info = folders.get(docKey(doc));
    for (const effect of effects) {
      const item = effect.value;
      if (!item?.folderId || !item?.name) continue;
      if (item.op === "remove") {
        const res = await trashNewPage(item);
        if (res?.modified) {
          report(
            t("“{name}”已有修改，未移入回收站", {
              name: item.title || item.name,
            }),
          );
        } else if (res?.trashed) {
          if (info?.folderId === item.folderId) {
            removeChild(info, item.name);
            info.version++;
          }
          filesChanged();
        }
      } else if (item.op === "add") {
        const res = await recreateNewPage(item);
        if (res?.created || res?.exists) {
          if (info?.folderId === item.folderId) {
            addChild(info, {
              name: item.name,
              directory: false,
              title: item.title,
              heading: item.title,
            });
            info.version++;
          }
          if (res?.created) filesChanged();
        }
      }
    }
  }
  async function runHistory(kind, doc) {
    if (!applies(doc) || doc.mode === "source" || doc.preview || doc.generated)
      return false;
    const st = stateOf(doc);
    const scrollTop = scroller()?.scrollTop;
    if (kind === "undo" && st.pendingRename) {
      const pendingOp = st.pendingRename;
      const unchangedSinceRename =
        doc.epoch === pendingOp.epoch && doc.text === pendingOp.text;
      const currentMove = canUndoRename();
      st.pendingRename = null;
      if (
        unchangedSinceRename &&
        currentMove &&
        currentMove === pendingOp.move
      ) {
        const undone = await undoRename();
        if (undone && getDocument() === doc) {
          st.justUndidRename = { epoch: doc.epoch, text: doc.text };
          flush();
          if (scrollTop != null && scroller()) scroller().scrollTop = scrollTop;
          if (!focusLine(pendingOp.line, { preventScroll: true }))
            focusNear(pendingOp.line, { preventScroll: true });
        }
        return Boolean(undone);
      }
    }
    if (kind === "redo" && st.justUndidRename) {
      const snap = st.justUndidRename;
      if (doc.epoch === snap.epoch && doc.text === snap.text) {
        report(t("改名无法重做"));
        return true;
      }
      st.justUndidRename = null;
    }
    const before = view.state.doc.toString();
    const effects = [];
    (kind === "redo" ? redo : undo)({
      state: view.state,
      dispatch: (tr) => {
        effects.push(...tr.effects);
        view.dispatch(tr);
      },
    });
    const after = view.state.doc.toString();
    if (after !== before) {
      st.pendingRename = null;
      st.justUndidRename = null;
    }
    const pageEffects = effects.filter((effect) =>
      effect.is(createdPageEffect),
    );
    if (pageEffects.length) await handlePageEffects(doc, pageEffects);
    if (getDocument() !== doc) return true;
    pending = null;
    rerender(doc);
    if (scrollTop != null && scroller()) scroller().scrollTop = scrollTop;
    const change = difference(before, after);
    if (change) {
      const line = after.slice(0, change.from).split("\n").length - 1;
      if (!focusLine(line, { preventScroll: true }))
        focusNear(line, { preventScroll: true });
    } else if (after !== before) {
      focusNear(0, { preventScroll: true });
    }
    return true;
  }
  let historyChain = Promise.resolve();
  // Undo or redo in the index (keys or the toolbar): shown again, the keys
  // on the entry the change was at.
  function history(kind) {
    const doc = getDocument();
    if (!applies(doc) || doc.mode === "source" || doc.preview || doc.generated)
      return false;
    const task = historyChain.then(
      () => runHistory(kind, doc),
      () => runHistory(kind, doc),
    );
    historyChain = task;
    run(async () => await task)();
    return true;
  }
  function focusItem(item, visible = true, { preventScroll = false } = {}) {
    for (const other of host.querySelectorAll('.ix-item[tabindex="0"]'))
      if (other !== item) other.tabIndex = -1;
    item.tabIndex = 0;
    item.focus({ preventScroll, focusVisible: visible });
  }
  const visibleItems = () =>
    [...host.querySelectorAll(".ix-item")].filter(
      (item) => !item.parentElement.closest(".ix-item.closed"),
    );
  function fold(item, closed) {
    const doc = managed();
    const fKey = item?.dataset.foldKey;
    if (!doc || !fKey || !item.hasAttribute("aria-expanded")) return;
    const defClosed = item.dataset.defaultClosed === "true";
    stateOf(doc).tooLarge = null;
    setFoldKey(doc, fKey, defClosed, closed);
    item.classList.toggle("closed", closed);
    item.setAttribute("aria-expanded", String(!closed));
    for (const control of item.querySelectorAll(
      ":scope > .ix-row > .ix-twisty, :scope > .ix-children > .ix-rail",
    ))
      control.setAttribute("aria-expanded", String(!closed));
    foldsChanged(doc, { domUpdated: true });
    outlineChanged();
    const info = folderOf(doc);
    if (!closed && item.dataset.childId) {
      const subId = item.dataset.childId;
      const sub = subfolders.get(subId);
      if (!sub || sub.stale) {
        ensureSubfolder(doc, subId, {
          id: subId,
          name: item.dataset.childName || "",
          path: item.dataset.childPath || "",
        });
      } else if (info?.status === "ready") {
        loadExcerpts(doc, info, collectVisibleNotesFromDom(doc, info));
      }
    } else if (!closed && info?.status === "ready") {
      loadExcerpts(doc, info, collectVisibleNotesFromDom(doc, info));
    }
  }
  function extremeVisibleGroup(expanded, pickMin) {
    const matches = [
      ...host.querySelectorAll(
        `.ix-item[aria-expanded="${expanded}"][data-fold-key]`,
      ),
    ].filter((item) => !item.parentElement.closest(".ix-item.closed"));
    if (!matches.length) return null;
    let targetLevel = pickMin ? Infinity : 0;
    for (const item of matches) {
      const lv = Number(item.getAttribute("aria-level")) || 1;
      if (pickMin ? lv < targetLevel : lv > targetLevel) targetLevel = lv;
    }
    return {
      level: targetLevel,
      items: matches.filter(
        (item) =>
          (Number(item.getAttribute("aria-level")) || 1) === targetLevel,
      ),
    };
  }
  const shallowestCollapsedGroup = () => extremeVisibleGroup("false", true);
  const deepestOpenGroup = () => extremeVisibleGroup("true", false);
  function visibleDescendantsCount(groupBox) {
    let count = 0;
    for (const el of groupBox.children) {
      if (!el.classList.contains("ix-item")) continue;
      count += 1;
      if (!el.classList.contains("closed")) {
        const inner = el.querySelector(":scope > .ix-children");
        if (inner) count += visibleDescendantsCount(inner);
      }
    }
    return count;
  }
  function directChildrenAdded(item) {
    const childrenBox = item.querySelector(":scope > .ix-children");
    const domChildren = childrenBox
      ? [...childrenBox.children].filter((el) =>
          el.classList.contains("ix-item"),
        )
      : [];
    let count = 0;
    for (const childEl of domChildren) {
      count += 1;
      if (!childEl.classList.contains("closed")) {
        const inner = childEl.querySelector(":scope > .ix-children");
        if (inner) count += visibleDescendantsCount(inner);
      }
    }
    const hasRenderedSub = domChildren.some(
      (el) => el.dataset.nested === "true",
    );
    if (!hasRenderedSub && item.dataset.childId) {
      const sub = subfolders.get(item.dataset.childId);
      if (sub?.status === "ready" && !sub.stale) {
        const resolved = resolveSubfolderChildren(sub);
        if (resolved)
          count +=
            resolved.kind === "items"
              ? resolved.items.length
              : resolved.roots.length;
      }
    }
    return count;
  }
  function groupSignature(doc, group, info) {
    const foldSig = (doc.folds || []).slice().sort().join("|");
    return `${group.level}:${info?.version ?? 0}:${foldSig}`;
  }
  function estimateNextLevel(doc, group, info) {
    let sum = 0;
    let allKnown = true;
    for (const item of group.items) {
      sum += directChildrenAdded(item);
      const cid = item.dataset.childId;
      if (cid) {
        const sub = subfolders.get(cid);
        if (!sub || sub.status !== "ready" || sub.stale) allKnown = false;
      }
    }
    const st = stateOf(doc);
    const sig = groupSignature(doc, group, info);
    if (st.tooLarge?.sig === sig)
      return { known: true, count: st.tooLarge.count };
    return { known: allKnown, count: sum };
  }
  function foldState(doc = getDocument()) {
    if (!doc || !applies(doc) || doc.preview || doc.mode === "source")
      return {
        foldable: false,
        canExpand: false,
        canCollapse: false,
        tooLargeCount: null,
      };
    const foldable = Boolean(
      host.querySelector(".ix-list .ix-item[aria-expanded]"),
    );
    if (!foldable)
      return {
        foldable: false,
        canExpand: false,
        canCollapse: false,
        tooLargeCount: null,
      };
    const canCollapse = Boolean(deepestOpenGroup());
    const group = shallowestCollapsedGroup();
    if (!group)
      return {
        foldable: true,
        canExpand: false,
        canCollapse,
        tooLargeCount: null,
      };
    const est = estimateNextLevel(doc, group, folders.get(docKey(doc)));
    if (est.known && est.count > MAX_NEXT_ROWS)
      return {
        foldable: true,
        canExpand: false,
        canCollapse,
        tooLargeCount: est.count,
      };
    return {
      foldable: true,
      canExpand: true,
      canCollapse,
      tooLargeCount: null,
    };
  }
  function scrollAnchorFor(selector, maxLevel = Infinity) {
    const reader = scroller();
    if (!reader || reader.scrollTop <= 2) return { top0: true };
    const rRect = reader.getBoundingClientRect();
    const candidates = [...host.querySelectorAll(selector)].filter(
      (el) =>
        (Number(el.getAttribute("aria-level")) || 1) <= maxLevel &&
        !el.parentElement.closest(".ix-item.closed"),
    );
    const targetEl =
      candidates.find(
        (el) => el.getBoundingClientRect().bottom > rRect.top + 8,
      ) || candidates[0];
    if (!targetEl) return { top0: true };
    return {
      top0: false,
      ixId: targetEl.dataset.ixId || null,
      fKey: targetEl.dataset.foldKey || null,
      line: targetEl.dataset.line || null,
      beforeTop: targetEl.getBoundingClientRect().top - rRect.top,
    };
  }
  function restoreScrollAnchor(anchor) {
    const reader = scroller();
    if (!reader) return;
    if (anchor.top0) {
      reader.scrollTop = 0;
      return;
    }
    const targetEl =
      (anchor.ixId &&
        host.querySelector(
          `.ix-item[data-ix-id="${CSS.escape(anchor.ixId)}"]`,
        )) ||
      (anchor.fKey &&
        host.querySelector(
          `.ix-item[data-fold-key="${CSS.escape(anchor.fKey)}"]`,
        )) ||
      (anchor.line != null &&
        host.querySelector(`.ix-item[data-line="${anchor.line}"]`));
    if (!targetEl) return;
    const rRect = reader.getBoundingClientRect();
    const maxOff = Math.max(16, reader.clientHeight - 48);
    const wantTop =
      anchor.beforeTop < 12 ? 16 : Math.min(anchor.beforeTop, maxOff);
    const afterTop = targetEl.getBoundingClientRect().top - rRect.top;
    reader.scrollTop += afterTop - wantTop;
  }
  function collapseItems(doc, items, anchor) {
    const st = stateOf(doc);
    st.expandToken++;
    st.tooLarge = null;
    for (const item of items) {
      const fKey = item.dataset.foldKey;
      const defClosed = item.dataset.defaultClosed === "true";
      setFoldKey(doc, fKey, defClosed, true);
      item.classList.add("closed");
      item.setAttribute("aria-expanded", "false");
      for (const control of item.querySelectorAll(
        ":scope > .ix-row > .ix-twisty, :scope > .ix-children > .ix-rail",
      ))
        control.setAttribute("aria-expanded", "false");
    }
    const outermostClosed = (start) => {
      let top = start?.closest?.(".ix-item.closed") || null;
      while (top?.parentElement?.closest?.(".ix-item.closed"))
        top = top.parentElement.closest(".ix-item.closed");
      return top;
    };
    const hiddenFocus = host.contains(document.activeElement)
      ? outermostClosed(document.activeElement)
      : null;
    if (hiddenFocus) focusItem(hiddenFocus, false, { preventScroll: true });
    else {
      const hiddenTab = outermostClosed(
        host.querySelector('.ix-item[tabindex="0"]'),
      );
      if (hiddenTab) {
        for (const other of host.querySelectorAll('.ix-item[tabindex="0"]'))
          other.tabIndex = -1;
        hiddenTab.tabIndex = 0;
      }
    }
    restoreScrollAnchor(anchor);
    foldsChanged(doc, { domUpdated: true });
    outlineChanged();
  }
  function collapseOneLevel() {
    const doc = managed();
    if (!doc) return false;
    const group = deepestOpenGroup();
    if (!group) return false;
    const anchor = scrollAnchorFor(".ix-item", group.level);
    collapseItems(doc, group.items, anchor);
    return true;
  }
  function collapseLevel1() {
    const doc = managed();
    if (!doc) return false;
    const anchor = scrollAnchorFor('.ix-item[aria-level="1"]');
    doc.folds = (doc.folds || []).filter(
      (k) => !k.startsWith("ix:") && !k.startsWith("+ix:"),
    );
    collapseItems(
      doc,
      host.querySelectorAll(".ix-item[aria-expanded]"),
      anchor,
    );
    return true;
  }
  async function expandOneLevel() {
    const doc = managed();
    if (!doc) return false;
    const st = stateOf(doc);
    const group = shallowestCollapsedGroup();
    if (!group) return false;
    const info = folderOf(doc);
    const sig = groupSignature(doc, group, info);
    if (st.tooLarge?.sig === sig) return false;
    const anchor = scrollAnchorFor(".ix-item");
    const token = ++st.expandToken;
    const toLoad = [];
    for (const item of group.items) {
      const cid = item.dataset.childId;
      if (!cid) continue;
      const sub = ensureSubfolder(
        doc,
        cid,
        {
          id: cid,
          name: item.dataset.childName || "",
          path: item.dataset.childPath || "",
        },
        { silent: true },
      );
      if (sub?.promise) toLoad.push(sub.promise);
    }
    for (let i = 0; i < toLoad.length; i += 64) {
      await Promise.all(toLoad.slice(i, i + 64));
      if (getDocument() !== doc || st.expandToken !== token) return false;
    }
    let totalAdded = 0;
    for (const item of group.items) totalAdded += directChildrenAdded(item);
    if (totalAdded > MAX_NEXT_ROWS) {
      st.tooLarge = { sig, count: totalAdded };
      outlineChanged();
      return false;
    }
    for (const item of group.items) {
      const fKey = item.dataset.foldKey;
      const defClosed = item.dataset.defaultClosed === "true";
      setFoldKey(doc, fKey, defClosed, false);
    }
    st.tooLarge = null;
    rerender(doc);
    restoreScrollAnchor(anchor);
    if (info?.status === "ready")
      loadExcerpts(doc, info, collectVisibleNotesFromDom(doc, info));
    foldsChanged(doc);
    outlineChanged();
    return true;
  }
  // The entry at a line or ixId shown: the entries folded above it unfolded.
  function reveal(target) {
    const item =
      typeof target === "string"
        ? host.querySelector(`.ix-item[data-ix-id="${CSS.escape(target)}"]`)
        : host.querySelector(`.ix-item[data-line="${target}"]`);
    for (
      let parent = item?.parentElement?.closest(".ix-item");
      parent;
      parent = parent.parentElement?.closest(".ix-item")
    )
      if (parent.classList.contains("closed")) fold(parent, false);
    return item || null;
  }
  // The outline's entries for the index shown: its level-one entries,
  // by the names the rows show.
  function outlineEntries() {
    const doc = getDocument();
    return [...host.querySelectorAll(".ix-item")]
      .filter((item) => (Number(item.getAttribute("aria-level")) || 1) === 1)
      .map((item) => ({
        key: item.dataset.ixId || null,
        nested: item.dataset.nested === "true" || Boolean(doc?.generated),
        label:
          item.querySelector(":scope > .ix-row > .ix-title")?.textContent ?? "",
        from: Number(item.dataset.from),
        depth: 0,
        line: Number(item.dataset.line),
      }));
  }
  // A title typed in place: Enter or leaving the box takes it, Esc cancels.
  // An entry of a note or folder of this folder renames it (its heading,
  // file name, entry and the links to it: renameNote); any other entry
  // (a link deeper or outside, a missing file) only gets the new text.
  function editTitle(item) {
    const found = entryAt(item);
    if (!found || !editing(found.doc)) return;
    const info = folderOf(found.doc);
    const child = childOf(info, found.entry.name);
    const title = item.querySelector(":scope > .ix-row > .ix-title");
    const input = element("input", "ix-title-input");
    const start = child?.heading || found.entry.title;
    input.value = start;
    input.setAttribute("aria-label", t("页面标题"));
    input.spellcheck = false;
    title.hidden = true;
    title.after(input);
    // Selecting text in the box drags no row.
    const row = item.querySelector(":scope > .ix-row");
    row.draggable = false;
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const value = input.value;
      input.remove();
      title.hidden = false;
      row.draggable = true;
      const again = keep && entryAt(item);
      // The folder still being read: whether this entry is a note of it is
      // not known yet (renaming it could not follow it).
      if (again && keep && info?.status === "loading" && found.entry.name) {
        report(t("目录正在更新，请稍后再试。"));
        return closed(item);
      }
      if (again && child && info?.folderId && value.trim()) {
        if (value.trim() === start) return closed(item);
        const line = again.entry.line;
        // The index tab may be redrawn meanwhile (its entry rewritten).
        run(async () => {
          let done = false;
          try {
            done = await renameNote({
              folderId: info.folderId,
              name: child.name,
              title: value.trim(),
              // Asked about by the name the row shows.
              shown: child.title || again.entry.title,
              directory: Boolean(child.directory),
              focus: false,
            });
          } finally {
            // Not renamed (cancelled, failed): the keys back on the entry.
            if (!done && done !== null && item.isConnected) closed(item);
          }
          // Renaming not available (no desktop): the entry's text only.
          const now = done === null && entryAt(item);
          if (
            now &&
            apply(now.doc, retitleEntry(now.doc.text, now.index, value))
          )
            return;
          if (done === null) {
            if (item.isConnected) closed(item);
            return;
          }
          if (!done || getDocument() !== again.doc) return;
          const scrollTop = scroller()?.scrollTop;
          const st = stateOf(again.doc);
          st.justUndidRename = null;
          const move = canUndoRename();
          st.pendingRename = move
            ? {
                move,
                epoch: again.doc.epoch,
                text: again.doc.text,
                line,
              }
            : null;
          flush();
          if (scrollTop != null && scroller()) scroller().scrollTop = scrollTop;
          if (!focusLine(line, { preventScroll: true }))
            focusNear(line, { preventScroll: true });
        })();
        return;
      }
      if (
        again &&
        apply(again.doc, retitleEntry(again.doc.text, again.index, value))
      )
        return;
      closed(item);
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }
  // The file of a new page. One place to change when the main process
  // offers creating index pages itself.
  // A new page named `title`: that is its heading (desktop/note-names.mjs).
  function pageInitialText(name, title = titleFor(name)) {
    const start = newNoteText(name);
    return setNoteName(start, { heading: title, insert: true, title }) ?? start;
  }
  async function createPageFile(
    folderId,
    name,
    title = titleFor(name),
    text = pageInitialText(name, title),
  ) {
    // The view lists it itself (in its draft): main leaves the index alone.
    return api.createEntry(folderId, name, "note", text, { list: false });
  }
  // The file of a page named as typed: made from the name ("v1.2" is a
  // name, not an extension); one typed with a note's extension keeps it.
  const pageName = (typed) => {
    const ext = (NOTE_NAME.exec(typed) || [".md"])[0];
    const title = NOTE_NAME.test(typed) ? titleFor(typed) : typed.trim();
    return { title, name: safeFileName(title, ext) };
  };
  // A name typed for a new page, in a row where it will be listed.
  function askName(container, before = null) {
    return new Promise((resolve) => {
      const row = element("div", "ix-new-row");
      const input = element("input", "ix-title-input");
      input.placeholder = t("新页面名称");
      input.setAttribute("aria-label", t("新页面名称"));
      input.spellcheck = false;
      row.append(input);
      container.insertBefore(row, before);
      input.focus();
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        row.remove();
        resolve(value);
      };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(input.value.trim() || null);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      });
      // Leaving the box (another tab, a click elsewhere) makes no file.
      input.addEventListener("blur", () => finish(null));
    });
  }
  async function newPage(item) {
    const doc = getDocument();
    const info = applies(doc) && folderOf(doc);
    if (!info?.folderId || !editing(doc)) return;
    let container,
      before = null,
      made = null;
    if (item) {
      fold(item, false);
      container = item.querySelector(":scope > .ix-children");
      if (!container) {
        container = made = element("div", "ix-children");
        item.append(container);
      }
    } else {
      const lists = host.querySelectorAll(".ix-list");
      container = lists[lists.length - 1] || host.querySelector(".ix-footer");
      before = container?.matches(".ix-footer") ? container.firstChild : null;
    }
    if (!container) return;
    const typed = await askName(container, before);
    made?.remove();
    if (!typed || getDocument() !== doc) {
      if (item) closed(item);
      else flush();
      return;
    }
    const { name, title } = pageName(typed);
    if (!name) {
      report(t("名称不能为空"));
      if (item) closed(item);
      else flush();
      return;
    }
    const alreadyExisted = Boolean(childOf(info, name));
    const expectedText = pageInitialText(name, title);
    let created = null;
    // A file of that name already in the folder is listed, not made again.
    if (!alreadyExisted) {
      created = await createPageFile(info.folderId, name, title, expectedText);
      addChild(info, {
        name: created?.name || name,
        directory: false,
        title,
        heading: title,
      });
      info.version++;
      filesChanged();
    }
    const createdName = created?.name || name;
    const now = getDocument();
    if (now !== doc) return;
    const parent = item ? entryAt(item) : null;
    if (item && !parent) return;
    apply(
      doc,
      insertEntry(
        doc.text,
        { title, href: hrefFor(createdName) },
        parent ? parent.index : -1,
        parent ? "into" : "after",
      ),
      {
        effects: alreadyExisted
          ? []
          : [
              createdPageEffect.of({
                op: "add",
                folderId: info.folderId,
                name: createdName,
                title,
                initialText:
                  typeof created?.text === "string"
                    ? created.text
                    : expectedText,
                fileId: created?.id || null,
                path: created?.path || null,
              }),
            ],
      },
    );
  }
  async function createMissing(item) {
    const found = entryAt(item);
    const info = found && folderOf(found.doc);
    if (!info?.folderId || !found.entry.name) return;
    const name = found.entry.name;
    // A folder for a link ending in "/" or a name without an extension;
    // otherwise a note (attachments are never shown missing).
    const folder =
      /\/\s*$/.test(target(found.entry.href)) || !EXTENSION.test(name);
    if (!folder && !NOTE_NAME.test(name)) return;
    if (folder)
      await api.createEntry(info.folderId, name, "folder", "", { list: false });
    // Named as its entry says.
    else await createPageFile(info.folderId, name, found.entry.title);
    addChild(info, { name, directory: folder });
    info.version++;
    filesChanged();
    rerender(found.doc);
    focusLine(found.entry.line);
  }
  // Where a missing entry may point instead: the same choices as the
  // tree's repair (main's repairOptions: seen renamed, the same name in
  // the library, notes of the folder the index does not list), as
  // [{ href, label }]; the folder's files when main cannot say.
  const REASONS = {
    renamed: () => t("刚被改名或移动到这里"),
    "same-name": () => t("同名的文件"),
    unlisted: () => t("这个文件夹中未列入目录的笔记"),
  };
  async function relocateChoices(found, info) {
    if (api?.repairOptions && found.doc.path)
      try {
        const options = await api.repairOptions(
          found.doc.path,
          found.entry.href,
        );
        return options.candidates.map((c) => ({
          href: c.rel
            .split("/")
            .map((part) => hrefFor(part))
            .join("/"),
          label: c.rel + "（" + (REASONS[c.reason]?.() ?? "") + "）",
        }));
      } catch {
        /* As before: the folder's own files. */
      }
    const listed = new Set(
      found.scan.entries.map((e) => e.name?.toLowerCase()).filter(Boolean),
    );
    return info.children
      .filter((child) => !child.index && !isIndexName(child.name))
      .sort(
        (a, b) =>
          Number(listed.has(a.name.toLowerCase())) -
          Number(listed.has(b.name.toLowerCase())),
      )
      .map((child) => ({
        href: hrefFor(child.name, child.directory),
        label: child.name + (child.directory ? "/" : ""),
      }));
  }
  // Point a missing entry elsewhere, picked from a list.
  async function relocate(item) {
    const found = entryAt(item);
    const info = found && folderOf(found.doc);
    if (!info || info.status !== "ready") return;
    const choices = await relocateChoices(found, info);
    if (!item.isConnected) return;
    if (!choices.length) return report(t("这个文件夹里没有可指向的笔记"));
    const select = element("select", "ix-relocate");
    select.setAttribute("aria-label", t("改为指向"));
    select.append(element("option", "", t("选择文件…")));
    select.firstChild.value = "";
    for (const choice of choices) {
      const option = element("option", "", choice.label);
      option.value = choice.href;
      select.append(option);
    }
    const repair = item.querySelector(":scope > .ix-row > .ix-repair");
    repair.hidden = true;
    repair.after(select);
    select.focus();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const option = select.selectedOptions[0];
      select.remove();
      repair.hidden = false;
      const again = option?.value && entryAt(item);
      if (
        again &&
        apply(again.doc, relinkEntry(again.doc.text, again.index, option.value))
      )
        return;
      closed(item);
    };
    select.addEventListener("change", finish);
    select.addEventListener("blur", finish);
    select.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        select.value = "";
        finish();
      }
    });
  }
  function addUnlisted(row, goal = null, place = "after") {
    const doc = getDocument();
    if (!applies(doc) || doc.preview) return;
    const name = row.dataset.name,
      directory = row.dataset.directory === "true";
    const found = goal ? entryAt(goal) : null;
    if (goal && !found) return;
    apply(
      doc,
      insertEntry(
        doc.text,
        { title: titleFor(name), href: hrefFor(name, directory) },
        found ? found.index : -1,
        found ? place : "after",
      ),
    );
  }
  function act(action, item) {
    const found = entryAt(item);
    if (!found) return;
    const { doc, index } = found;
    const edits = {
      indent: () => indentEntry(doc.text, index),
      outdent: () => outdentEntry(doc.text, index),
      up: () => shiftEntry(doc.text, index, -1),
      down: () => shiftEntry(doc.text, index, 1),
      remove: () => removeEntry(doc.text, index),
    };
    const result = edits[action]();
    if (!apply(doc, result, { fallbackLine: found.entry.line }))
      focusItem(item);
  }

  // A prose block's Markdown, edited in place (Edit mode): Ctrl+Enter or
  // leaving the box takes it, Esc cancels.
  function editBlock(start) {
    const doc = getDocument();
    if (!applies(doc) || !editing(doc)) return;
    // The block: a child of the note, of a section's body, or a heading.
    let block = start;
    while (
      block?.parentElement &&
      block.parentElement !== host &&
      !block.parentElement.matches(".section-body, .note-section")
    )
      block = block.parentElement;
    if (!block?.parentElement || !host.contains(block)) return;
    if (
      block.matches(
        ".ix-list, .ix-footer, .note-section, .section-rail, .section-body",
      )
    )
      return;
    // The properties: their YAML, `---` lines included.
    if (block.matches(".front-matter, .fm-none")) return editFront(block);
    const positions = [block, ...block.querySelectorAll("[data-from]")]
      .filter((el) => el.hasAttribute?.("data-from"))
      .map((el) => [Number(el.dataset.from), Number(el.dataset.to)]);
    if (!positions.length) return;
    editSource(
      doc,
      block,
      Math.min(...positions.map(([a]) => a)),
      Math.max(...positions.map(([, b]) => b)),
    );
  }
  // The front matter's text in place (Edit mode), at the top when the note
  // shows none (no properties yet: made by the caller).
  function editFront(block = null) {
    const doc = getDocument();
    if (!applies(doc) || !editing(doc)) return false;
    const { lines, skip } = scanIndex(doc.text);
    if (!(lines.length > 1 && skip[0] && /^---[ \t]*$/.test(lines[0].text)))
      return false;
    let end = 1;
    while (end < lines.length && !/^(---|\.\.\.)[ \t]*$/.test(lines[end].text))
      end++;
    block ||= host.querySelector(".front-matter, .fm-none");
    editSource(
      doc,
      block,
      lines[0].start,
      lines[end].start + lines[end].text.length,
    );
    return true;
  }
  function editSource(doc, block, from, to) {
    if (!(from >= 0 && to > from && to <= doc.text.length)) return;
    if (host.querySelector(".ix-block-editor")) return;
    const original = doc.text.slice(from, to);
    const shown = original.replace(/(\r?\n)+$/, "");
    const area = element("textarea", "ix-block-editor");
    area.value = shown;
    area.spellcheck = false;
    area.setAttribute("aria-label", t("编辑这段 Markdown"));
    const wasHidden = Boolean(block?.hidden);
    if (block) {
      block.hidden = true;
      block.after(area);
    } else host.prepend(area);
    const fit = () => {
      area.style.height = "auto";
      area.style.height = area.scrollHeight + 2 + "px";
    };
    fit();
    area.addEventListener("input", fit);
    area.focus();
    const blockLine = doc.text.slice(0, from).split("\n").length - 1;
    let done = false;
    const finish = (keep, restoreFocus = false, related = null) => {
      if (done) return;
      done = true;
      const value = area.value;
      area.remove();
      if (block) block.hidden = wasHidden;
      const shouldFocus =
        restoreFocus ||
        !related ||
        host.contains(related) ||
        related === scroller();
      if (!keep || value === shown || getDocument() !== doc) {
        flush();
        if (shouldFocus) focusNear(blockLine, { preventScroll: true });
        return;
      }
      if (doc.text.slice(from, to) !== original) {
        report(t("这段文字已在别处改动，这次修改未写入"));
        flush();
        if (shouldFocus) focusNear(blockLine, { preventScroll: true });
        return;
      }
      apply(
        doc,
        {
          change: { from, to: from + shown.length, insert: value },
          line: null,
        },
        { fallbackLine: blockLine, refocus: shouldFocus },
      );
    };
    area.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false, true);
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        finish(true, true);
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      )
        // Saving takes what was typed first.
        finish(true, true);
      else event.stopPropagation();
    });
    area.addEventListener("blur", (event) =>
      finish(true, false, event.relatedTarget),
    );
  }

  // ── Events (on the reading view; only for an index note) ──
  const managed = () => {
    const doc = getDocument();
    return applies(doc) ? doc : null;
  };
  // An entry's page opened; a folder: its own index file, if it has one
  // (a folder is no note to open).
  async function openTarget(name, href, directory) {
    if (!directory) return open(href);
    const doc = getDocument();
    const child = childOf(doc && folders.get(doc.fileId), name);
    let index = null;
    if (child?.id && api?.list) {
      const inside = (await api.list(child.id).catch(() => null)) || [];
      index = inside.find(
        (c) => !c.directory && (c.index || isIndexName(c.name)),
      );
    }
    if (index) return open(hrefFor(name, true) + hrefFor(index.name));
    // No index of its own: the folder shown in the library tree.
    if (child?.path && (await revealFolder(child.path))) return;
    report(t("文件夹“{name}”里没有目录文件", { name }));
  }
  function openFolderTarget(item) {
    const cid = item?.dataset.childId;
    if (!cid) return;
    const folder = {
      id: cid,
      name: item.dataset.childName || "",
      title: item.dataset.childTitle || item.dataset.childName || "",
      path: item.dataset.childPath || "",
    };
    if (openFolder) return run(() => openFolder(folder))();
  }
  function openEntry(item) {
    const doc = managed();
    if (!doc || !item || item.classList.contains("missing")) return;
    if (item.dataset.nested === "true" || doc.generated) {
      if (item.dataset.kind === "folder") return openFolderTarget(item);
      const ownerId = item.dataset.ownerFolderId;
      const fileName = item.dataset.childFile;
      if (ownerId && fileName && openNote) {
        return run(() =>
          openNote({
            folderId: ownerId,
            name: fileName,
            path: item.dataset.childPath || "",
          }),
        )();
      }
      const relHref = item.dataset.relHref;
      if (relHref && doc.fileId) return run(() => open(relHref))();
      return;
    }
    const found = entryAt(item);
    if (!found) return;
    const href = item
      .querySelector(":scope > .ix-row > .ix-title")
      ?.getAttribute("href");
    run(() =>
      openTarget(found.entry.name, href, item.dataset.kind === "folder"),
    )();
  }
  host.addEventListener("click", (event) => {
    const doc = managed();
    if (!doc) return;
    const control = event.target.closest?.("[data-ix]");
    const item = event.target.closest?.(".ix-item");
    const isNested = item?.dataset.nested === "true";
    // A title: Read mode (or nested/generated read-only rows) opens it;
    // Edit mode on own rows picks the entry (double click edits title),
    // Ctrl+click opens it.
    const title = event.target.closest?.(".ix-row > a.ix-title");
    if (title && item && !control) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (editing(doc) && !isNested && !event.ctrlKey && !event.metaKey)
        focusItem(item);
      else openEntry(item);
      return;
    }
    const unlisted = event.target.closest?.(".ix-unlisted-item > a.ix-title");
    if (unlisted && !control) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const row = unlisted.parentElement;
      run(() =>
        openTarget(
          row.dataset.name,
          unlisted.getAttribute("href"),
          row.dataset.directory === "true",
        ),
      )();
      return;
    }
    if (control) {
      event.preventDefault();
      const action = control.dataset.ix;
      if (action === "fold") {
        fold(item, !item.classList.contains("closed"));
        // The keys stay on the entry folded (no ring for a click).
        return focusItem(item, false);
      }
      if (action === "open-folder") return openFolderTarget(item);
      if (action === "unify") {
        const info = folders.get(doc.fileId);
        const child = childOf(info, control.dataset.name);
        if (canUnify() && info?.folderId && child)
          run(() =>
            unifyNote({
              folderId: info.folderId,
              name: child.name,
              title: child.title || child.name,
            }),
          )();
        return;
      }
      if (action === "tray") {
        const tray = control.closest(".ix-unlisted");
        const state = stateOf(doc);
        state.tray = tray.classList.contains("closed");
        tray.classList.toggle("closed", !state.tray);
        control.setAttribute("aria-expanded", String(state.tray));
        return;
      }
      if (doc.generated) return;
      if (action === "new") return run(() => newPage(null))();
      if (action === "add")
        return addUnlisted(control.closest(".ix-unlisted-item"));
      if (!item || isNested) return;
      if (action === "child") return run(() => newPage(item))();
      if (action === "rename") return editTitle(item);
      if (action === "create") return run(() => createMissing(item))();
      if (action === "relocate") return run(() => relocate(item))();
      if (action === "remove") return act("remove", item);
      return;
    }
    if (!item || event.target.closest("a, input, select, textarea")) return;
    const row = event.target.closest(".ix-row");
    if (!row) return;
    // A click on the row beside its title: the page opens (Read mode or
    // nested/generated rows), or the entry is picked for the keys (Edit).
    if (editing(doc) && !isNested) focusItem(item);
    else openEntry(item);
  });
  host.addEventListener(
    "dblclick",
    (event) => {
      const doc = managed();
      if (!doc) return;
      if (event.target.closest?.("textarea, input, select")) {
        event.stopPropagation();
        return;
      }
      const inList = event.target.closest?.(".ix-list, .ix-footer");
      if (inList) {
        event.stopPropagation();
        event.preventDefault();
        const item = event.target.closest(".ix-item");
        if (
          item &&
          editing(doc) &&
          item.dataset.nested !== "true" &&
          event.target.closest(".ix-title")
        )
          editTitle(item);
        return;
      }
      if (doc.preview || doc.generated) return;
      if (editing(doc)) {
        event.stopPropagation();
        editBlock(event.target);
        return;
      }
      // Read mode: into Edit mode with this block's Markdown open (unless
      // the format bar takes the double click to select a word).
      if (readingFormat() && !event.altKey) return;
      event.stopPropagation();
      const from = startOf(
        event.target.closest?.("[data-from]") || event.target,
      );
      setMode("edit");
      if (from == null) return;
      const again = host.querySelector(`[data-from="${from}"]`);
      if (again) editBlock(again);
    },
    true,
  );
  host.addEventListener("keydown", (event) => {
    const doc = managed();
    if (!doc) return;
    const key = event.key;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    // Undo and redo: in Read or Edit mode anywhere in the view, not in a box
    // being typed in.
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      (key.toLowerCase() === "z" ||
        (key.toLowerCase() === "y" && !event.shiftKey)) &&
      doc.mode !== "source" &&
      !doc.preview &&
      !doc.generated &&
      !event.target.closest?.("input, textarea, select, [contenteditable]")
    ) {
      handled();
      history(key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
      return;
    }
    const item = event.target.closest?.(".ix-item");
    if (!item || event.target !== item) return;
    const items = visibleItems();
    const at = items.indexOf(item);
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        const next = items[at + (key === "ArrowDown" ? 1 : -1)];
        handled();
        if (next) focusItem(next);
        return;
      }
      if (key === "ArrowRight" || key === "ArrowLeft") {
        handled();
        const open = !item.classList.contains("closed");
        const hasChildren = item.hasAttribute("aria-expanded");
        if (key === "ArrowRight") {
          if (hasChildren && !open) fold(item, false);
          else if (hasChildren)
            focusItem(item.querySelector(":scope > .ix-children > .ix-item"));
        } else if (hasChildren && open) fold(item, true);
        else {
          const parent = item.parentElement.closest(".ix-item");
          if (parent) focusItem(parent);
        }
        return;
      }
      if (key === "Enter") {
        handled();
        openEntry(item);
        return;
      }
    }
    if (!editing(doc) || item.dataset.nested === "true") return;
    let action = null;
    if (key === "Tab" && !event.altKey && !event.ctrlKey)
      action = event.shiftKey ? "outdent" : "indent";
    else if (event.altKey && event.shiftKey && key === "ArrowRight")
      action = "indent";
    else if (event.altKey && event.shiftKey && key === "ArrowLeft")
      action = "outdent";
    else if (event.altKey && !event.shiftKey && key === "ArrowUp")
      action = "up";
    else if (event.altKey && !event.shiftKey && key === "ArrowDown")
      action = "down";
    else if (key === "Delete" && !event.altKey && !event.ctrlKey)
      action = "remove";
    else if (key === "F2") {
      handled();
      editTitle(item);
      return;
    }
    if (!action) return;
    handled();
    act(action, item);
  });
  // Dragging (Edit mode): before, after or onto (as a sub-page) an entry; a
  // file not in the index dragged in becomes an entry there.
  let dragging = null;
  const placeOf = (event, row) => {
    const box = row.getBoundingClientRect();
    const y = (event.clientY - box.top) / box.height;
    return y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
  };
  const clearDrop = () => {
    for (const el of host.querySelectorAll(".ix-row[data-drop]"))
      delete el.dataset.drop;
  };
  host.addEventListener("dragstart", (event) => {
    const doc = managed();
    if (!doc || !editing(doc)) return;
    // Selecting text in a box being typed in drags nothing.
    if (event.target.closest?.("input, textarea, select")) {
      event.preventDefault();
      return;
    }
    const row = event.target.closest?.(".ix-row, .ix-unlisted-item");
    if (!row || row.closest("[data-nested='true']")) {
      if (row) event.preventDefault();
      return;
    }
    dragging = row.matches(".ix-row")
      ? { item: row.parentElement }
      : { unlisted: row };
    event.dataTransfer.setData(DRAG_TYPE, "1");
    event.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
    // Near the reader's top or bottom edge it scrolls, to reach entries
    // off screen.
    autoscroll.attach(scroller());
  });
  host.addEventListener("dragend", () => {
    for (const el of host.querySelectorAll(".dragging"))
      el.classList.remove("dragging");
    dragging = null;
    clearDrop();
    autoscroll.detach(scroller());
  });
  host.addEventListener("dragover", (event) => {
    if (!dragging) return;
    const row = event.target.closest?.(".ix-row");
    if (
      !row ||
      row.parentElement === dragging.item ||
      row.closest("[data-nested='true']")
    )
      return clearDrop();
    if (dragging.item?.contains(row)) return clearDrop();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const place = placeOf(event, row);
    if (row.dataset.drop === place) return;
    clearDrop();
    row.dataset.drop = place;
  });
  host.addEventListener("dragleave", (event) => {
    const row = event.target.closest?.(".ix-row");
    if (row && !row.contains(event.relatedTarget)) delete row.dataset.drop;
  });
  host.addEventListener("drop", (event) => {
    if (!dragging) return;
    const row = event.target.closest?.(".ix-row");
    const drag = dragging;
    dragging = null;
    clearDrop();
    autoscroll.detach(scroller());
    if (!row || row.closest("[data-nested='true']")) return;
    event.preventDefault();
    const place = placeOf(event, row);
    const goal = row.parentElement;
    if (drag.unlisted) return addUnlisted(drag.unlisted, goal, place);
    const from = entryAt(drag.item),
      to = entryAt(goal);
    if (!from || !to) return;
    apply(from.doc, moveEntry(from.doc.text, from.index, to.index, place));
  });

  return {
    applies,
    key,
    render,
    invalidate,
    shown,
    history,
    editFront,
    reveal,
    outlineEntries,
    foldState,
    collapseOneLevel,
    collapseLevel1,
    expandOneLevel,
  };
}
