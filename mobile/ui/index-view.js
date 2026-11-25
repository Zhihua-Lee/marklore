// A folder's index file (_目录.md, SUMMARY.md) shown as its table of
// contents, read-only, after the desktop's index view
// (src/folder-index-view.js): the same parsing (src/index-list.js), the same
// first sentence beside each page, the same look (folder-index-view.css), and
// the same default folding (first level open, deeper levels closed). A
// subfolder entry opens into that folder's own index; a folder without an
// index lists its notes and subfolders. The home screen shows the chosen
// folder's index; opening an index note shows its view in place of its list.
import "../../src/folder-index-view.css";
import { scanIndex, noteExcerpt } from "../../src/index-list.js";
import { findIndexName } from "../../desktop/folder-index.mjs";
import { basenameOf, folderOf, resolveRelativePath } from "./paths.js";
import { STRINGS } from "./strings.js";

const EXCERPTS = 200; // first sentences read for one view at most
const FOLDS_KEY = "indexFolds";

const lower = (s) => s.toLowerCase();
const collator = new Intl.Collator("zh-Hans-CN", {
  numeric: true,
  sensitivity: "base",
});

// Everything the views need about the library, read once per render.
export async function loadIndexContext(library) {
  const notes = await library.list();
  const byPath = new Map(notes.map((n) => [lower(n.path), n]));
  const dirs = new Map([["", []]]); // folder → notes directly in it
  const subdirs = new Map([["", new Set()]]); // folder → child folders
  for (const note of notes) {
    const dir = folderOf(note.path);
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push(note);
    let child = dir;
    while (child) {
      const parent = folderOf(child);
      if (!subdirs.has(parent)) subdirs.set(parent, new Set());
      subdirs.get(parent).add(child);
      if (!dirs.has(parent)) dirs.set(parent, []);
      child = parent;
    }
  }
  const folders = new Map([...dirs.keys()].map((d) => [lower(d), d]));
  const indexOf = new Map();
  for (const [dir, list] of dirs) {
    const name = findIndexName(list.map((n) => basenameOf(n.path)));
    if (name) indexOf.set(dir, dir ? `${dir}/${name}` : name);
  }
  const texts = new Map();
  await Promise.all(
    [...indexOf.values()].map(async (path) =>
      texts.set(path, (await library.text(path)) ?? ""),
    ),
  );
  const folds = (await library.state.get(FOLDS_KEY, {})) || {};
  return {
    library,
    notes,
    byPath,
    dirs,
    subdirs,
    folders,
    indexOf,
    texts,
    folds,
  };
}

// What an index link points at: a note, a folder, or nothing in the library.
function resolveLink(ctx, indexPath, href) {
  let target = String(href).trim();
  if (target.startsWith("<")) target = target.slice(1).split(">")[0];
  else target = target.split(/\s+/)[0];
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: "missing" };
  target = target.split("#")[0];
  if (!target) return { kind: "missing" };
  const path = resolveRelativePath(indexPath, target);
  const note = ctx.byPath.get(lower(path));
  if (note) {
    const name = basenameOf(path);
    // A link to a folder's own index stands for the folder.
    if (
      /^(?:_目录|summary)\.md$/i.test(name) &&
      folderOf(path) !== folderOf(indexPath)
    )
      return { kind: "folder", path: folderOf(note.path) };
    return { kind: "note", path: note.path, note };
  }
  const folder = ctx.folders.get(lower(path.replace(/\/+$/, "")));
  if (folder !== undefined && folder !== folderOf(indexPath))
    return { kind: "folder", path: folder };
  return { kind: "missing" };
}

const folderTitle = (ctx, dir, label = "") => {
  if (label) return label;
  const index = ctx.indexOf.get(dir);
  const heading = index && ctx.byPath.get(lower(index))?.title;
  return heading && !/^(?:_目录|summary)$/i.test(heading)
    ? heading
    : basenameOf(dir) || STRINGS.indexTitle;
};

// The entries of one folder: [{ kind, title, path, children }]. `seen` keeps
// a folder from listing itself again further down (links in a circle).
export function folderNodes(ctx, dir, seen = new Set()) {
  if (seen.has(lower(dir))) return [];
  const inside = new Set(seen).add(lower(dir));
  const index = ctx.indexOf.get(dir);
  const listed = new Set(index ? [lower(index)] : []);
  const nodes = [];
  const build = (entry, scan) => {
    const link = resolveLink(ctx, index, entry.href);
    const own = entry.children.map((i) => build(scan.entries[i], scan));
    if (link.kind === "note") {
      listed.add(lower(link.path));
      return {
        kind: "note",
        path: link.path,
        title: link.note.title || entry.title,
        children: own,
      };
    }
    if (link.kind === "folder") {
      listed.add(lower(link.path) + "/");
      return folderNode(ctx, link.path, entry.title, own, inside);
    }
    return { kind: "missing", title: entry.title, children: own };
  };
  if (index) {
    const scan = scanIndex(ctx.texts.get(index) || "");
    for (const run of scan.runs)
      for (const i of run.roots) nodes.push(build(scan.entries[i], scan));
  }
  // Notes and folders the index leaves out (all of them without an index).
  const unlisted = [];
  const own = [...(ctx.dirs.get(dir) || [])].sort((a, b) =>
    collator.compare(a.title || a.path, b.title || b.path),
  );
  for (const note of own)
    if (!listed.has(lower(note.path)))
      unlisted.push({
        kind: "note",
        path: note.path,
        title: note.title,
        children: [],
      });
  for (const sub of [...(ctx.subdirs.get(dir) || [])].sort((a, b) =>
    collator.compare(a, b),
  ))
    if (!listed.has(lower(sub) + "/"))
      unlisted.push(folderNode(ctx, sub, "", [], inside));
  if (!index) return nodes.concat(unlisted);
  if (unlisted.length)
    nodes.push({
      kind: "group",
      key: "unlisted",
      title: STRINGS.unlisted,
      children: unlisted,
    });
  return nodes;
}

// A subfolder: what the parent index nests under it, then the folder's own
// entries that are not among those.
function folderNode(ctx, dir, label, own, seen) {
  const shown = new Set();
  const collect = (list) =>
    list.forEach((n) => {
      if (n.path) shown.add(lower(n.path));
      collect(n.children);
    });
  collect(own);
  let inner = null;
  return {
    kind: "folder",
    path: dir,
    title: folderTitle(ctx, dir, label),
    get children() {
      inner ??= own.concat(
        folderNodes(ctx, dir, seen).filter(
          (n) => !(n.path && shown.has(lower(n.path))),
        ),
      );
      return inner;
    },
  };
}

const countPages = (node) =>
  node.children.reduce(
    (sum, child) => sum + (child.kind === "note" ? 1 : 0) + countPages(child),
    0,
  );

// Renders the view of `dir` into a new element. `onOpenNote(path)` opens a
// page. First sentences are read for rows as they come into view.
export function renderIndexView(ctx, dir, { onOpenNote }) {
  const list = document.createElement("div");
  list.className = "ix-list mobile-index";
  list.setAttribute("role", "tree");
  const nodes = folderNodes(ctx, dir);
  if (!nodes.length) {
    const empty = document.createElement("p");
    empty.className = "mobile-home-empty";
    empty.textContent = STRINGS.emptyLibrary;
    list.append(empty);
    return list;
  }

  let excerptsLeft = EXCERPTS;
  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (seen) => {
            for (const { isIntersecting, target } of seen) {
              if (!isIntersecting) continue;
              observer.unobserve(target);
              if (excerptsLeft-- <= 0) continue;
              const path = target.dataset.notePath;
              void ctx.library.text(path).then((text) => {
                const line = noteExcerpt(text || "", target.textContent);
                if (!line) return;
                const span = document.createElement("span");
                span.className = "ix-excerpt";
                span.textContent = line;
                target.parentElement?.append(span);
              });
            }
          },
          { rootMargin: "200px 0px" },
        )
      : null;

  const saveFolds = () =>
    void ctx.library.state.set(FOLDS_KEY, ctx.folds).catch(() => {});

  const item = (node, level, scope) => {
    const el = document.createElement("div");
    el.className = "ix-item";
    el.setAttribute("role", "treeitem");
    el.setAttribute("aria-level", String(level));
    if (node.kind === "folder") el.dataset.kind = "folder";
    if (node.kind === "missing") el.classList.add("missing");
    const row = document.createElement("div");
    row.className = "ix-row";
    const children = node.children;
    const expandable = children.length > 0;
    const key = `${scope}|${node.kind}:${node.path || node.key || node.title}`;
    let closed = expandable && (ctx.folds[key] ?? level >= 2);
    let childBox = null;

    const setClosed = (next) => {
      closed = next;
      ctx.folds[key] = next;
      saveFolds();
      el.classList.toggle("closed", next);
      el.setAttribute("aria-expanded", String(!next));
      if (!next && childBox && !childBox.childElementCount) fill();
    };
    const fill = () => {
      const rail = document.createElement("button");
      rail.type = "button";
      rail.className = "ix-rail";
      rail.setAttribute("aria-label", STRINGS.foldEntry(node.title));
      rail.addEventListener("click", () => setClosed(true));
      childBox.append(rail);
      for (const child of children)
        childBox.append(item(child, level + 1, scope));
    };

    if (expandable) {
      el.setAttribute("aria-expanded", String(!closed));
      if (closed) el.classList.add("closed");
      const twisty = document.createElement("button");
      twisty.type = "button";
      twisty.className = "ix-twisty";
      twisty.setAttribute("aria-label", STRINGS.foldEntry(node.title));
      twisty.textContent = " ";
      twisty.addEventListener("click", () => setClosed(!closed));
      row.append(twisty);
    } else {
      const space = document.createElement("span");
      space.className = "ix-twisty-space";
      row.append(space);
    }

    const title = document.createElement(node.kind === "note" ? "a" : "span");
    title.className = "ix-title";
    title.textContent = node.title;
    if (node.kind === "note") {
      title.href = "#";
      title.dataset.notePath = node.path;
      title.addEventListener("click", (event) => {
        event.preventDefault();
        onOpenNote(node.path);
      });
      if (observer) observer.observe(title);
    } else if (expandable) {
      // A folder or group has no page of its own: its title folds it.
      title.addEventListener("click", () => setClosed(!closed));
    }
    if (node.kind === "folder") title.dataset.folderPath = node.path;
    row.append(title);

    if (expandable) {
      const count = document.createElement("span");
      count.className = "ix-count";
      count.textContent = STRINGS.pagesCount(countPages(node));
      row.append(count);
    }
    el.append(row);
    if (expandable) {
      childBox = document.createElement("div");
      childBox.className = "ix-children";
      childBox.setAttribute("role", "group");
      // Closed branches are built when first opened.
      if (!closed) fill();
      el.append(childBox);
    }
    return el;
  };

  for (const node of nodes) list.append(item(node, 1, dir));
  return list;
}

// An index note's text split around its entry lists: the view replaces the
// first list and the others are left out. Returns { before, after } Markdown
// or null when the note has no entries.
export function splitIndexNote(text) {
  const scan = scanIndex(text);
  if (!scan.runs.length) return null;
  const lines = scan.lines.map((l) => l.text);
  const inRun = new Set();
  for (const run of scan.runs)
    for (let k = run.first; k <= run.last; k++) inRun.add(k);
  const first = scan.runs[0].first;
  const keep = (from, to) =>
    lines
      .slice(from, to)
      .filter((_, i) => !inRun.has(from + i))
      .join("\n");
  return { before: keep(0, first), after: keep(first, lines.length) };
}

export const isIndexNote = (path) =>
  /^(?:_目录|summary)\.md$/i.test(basenameOf(path));
