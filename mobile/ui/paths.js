import { createSlugger } from "../../desktop/slug.mjs";
import { STRINGS } from "./strings.js";

const MARKDOWN_EXT_RE = /\.(?:md|markdown|mdown|mkd)$/i;
const EXTERNAL_SCHEME_RE = /^(?:https?:|mailto:|tel:)/i;
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function noteHashForPath(path) {
  return `#/note/${encodeURIComponent(path)}`;
}

/**
 * Extracts a decoded note path from `#/note/...`, or null when not a note hash.
 */
export function parseNoteHash(hash) {
  if (typeof hash !== "string" || !hash.startsWith("#/note/")) return null;
  const raw = hash.slice("#/note/".length);
  return raw ? safeDecodeURIComponent(raw) : null;
}

export function folderOf(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

export function basenameOf(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

export function isIndexFile(path) {
  const name = basenameOf(path);
  return name === "_目录.md" || name === "SUMMARY.md";
}

export function displayNoteTitle(entry) {
  if (isIndexFile(entry.path)) return STRINGS.indexTitle;
  return entry.title || basenameOf(entry.path).replace(MARKDOWN_EXT_RE, "");
}

/**
 * Resolves a relative note or asset path against the directory of `baseNotePath`.
 */
export function resolveRelativePath(baseNotePath, rawRelative) {
  let clean = String(rawRelative || "").trim();
  if (clean.startsWith("<") && clean.endsWith(">")) {
    clean = clean.slice(1, -1).trim();
  }
  const queryIndex = clean.indexOf("?");
  if (queryIndex >= 0) clean = clean.slice(0, queryIndex);
  const decoded = safeDecodeURIComponent(clean).replace(/\\/g, "/");
  const isRooted = decoded.startsWith("/");
  const baseParts = isRooted
    ? []
    : folderOf(baseNotePath).split("/").filter(Boolean);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (baseParts.length > 0) baseParts.pop();
    } else {
      baseParts.push(segment);
    }
  }
  return baseParts.join("/");
}

/**
 * Classifies a rendered `<a href>` inside a note for mobile navigation.
 */
export function classifyNoteHref(rawHref, currentNotePath) {
  if (!rawHref) return { kind: "ignore" };
  const trimmed = rawHref.trim();
  if (!trimmed) return { kind: "ignore" };
  if (trimmed.startsWith("#")) {
    return { kind: "anchor", anchor: safeDecodeURIComponent(trimmed.slice(1)) };
  }
  if (EXTERNAL_SCHEME_RE.test(trimmed)) {
    return { kind: "external", href: trimmed };
  }
  if (ANY_SCHEME_RE.test(trimmed)) {
    return { kind: "ignore" };
  }
  const hashIndex = trimmed.indexOf("#");
  const rawTarget = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const rawAnchor = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";
  let cleanTarget = rawTarget.trim();
  if (cleanTarget.startsWith("<") && cleanTarget.endsWith(">")) {
    cleanTarget = cleanTarget.slice(1, -1).trim();
  }
  const queryFreeTarget = cleanTarget.split("?")[0];
  const decodedTarget = safeDecodeURIComponent(queryFreeTarget);
  if (!decodedTarget) {
    return rawAnchor
      ? { kind: "anchor", anchor: safeDecodeURIComponent(rawAnchor) }
      : { kind: "ignore" };
  }
  if (!MARKDOWN_EXT_RE.test(decodedTarget)) {
    return { kind: "other" };
  }
  return {
    kind: "note",
    path: resolveRelativePath(currentNotePath, decodedTarget),
    anchor: rawAnchor ? safeDecodeURIComponent(rawAnchor) : "",
  };
}

/**
 * Finds the heading or anchored element inside `container` matching `anchor`.
 */
export function findAnchorElement(container, anchor) {
  if (!anchor) return null;
  const slug = createSlugger();
  const candidates = [anchor, safeDecodeURIComponent(anchor), slug(anchor)];
  const elements = container.querySelectorAll("[id], a[name]");
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const el of elements) {
      if (el.id === candidate || el.getAttribute("name") === candidate) {
        return el;
      }
    }
  }
  return null;
}

/**
 * Builds a sorted folder tree from `library.list()`.
 * Within every folder, index notes (`_目录.md`, `SUMMARY.md`) appear first as "目录",
 * then child folders alphabetically, then notes alphabetically by display title.
 */
export function buildFolderTree(entries) {
  const createNode = (name, path) => ({
    name,
    path,
    folders: new Map(),
    notes: [],
  });
  const root = createNode("", "");
  const collator = new Intl.Collator("zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let node = root;
    let built = "";
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      if (!node.folders.has(part))
        node.folders.set(part, createNode(part, built));
      node = node.folders.get(part);
    }
    node.notes.push(entry);
  }

  const finalize = (node) => {
    const childFolders = [...node.folders.values()]
      .sort((a, b) => collator.compare(a.name, b.name))
      .map(finalize);
    const indexNotes = [];
    const regularNotes = [];
    for (const entry of node.notes) {
      if (isIndexFile(entry.path)) indexNotes.push(entry);
      else regularNotes.push(entry);
    }
    indexNotes.sort((a, b) => collator.compare(a.path, b.path));
    regularNotes.sort((a, b) =>
      collator.compare(displayNoteTitle(a), displayNoteTitle(b)),
    );
    return {
      name: node.name,
      path: node.path,
      folders: childFolders,
      notes: [...indexNotes, ...regularNotes],
    };
  };

  return finalize(root);
}
