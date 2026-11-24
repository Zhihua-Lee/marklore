// Pure breadcrumb and sibling-list builder for notes, folder index views,
// and generated folder views inside a library. No Node imports: tested directly
// and reused by the main process when resolving folder chains.
import {
  childName,
  entryOf,
  folderEntry,
  isIndexName,
  parseIndex,
  unescapeTitle,
} from "./folder-index.mjs";
import { baseName } from "./note-names.mjs";
import { isUnder, pathKey } from "./link-rewrite.mjs";

export const compareTreeItems = (a, b) =>
  Number(Boolean(b.directory)) - Number(Boolean(a.directory)) ||
  String(a.name).localeCompare(String(b.name), "zh-CN", { numeric: true });

// Format one existing child (directory or note) as a navigable sibling item.
function siblingFromChild(
  child,
  folder,
  { current = false, label = null } = {},
) {
  if (child.directory) {
    return {
      kind: "folder",
      name: child.name,
      path: child.path,
      folderId: child.id ?? null,
      indexName: child.indexName ?? null,
      fileName: null,
      current,
    };
  }
  return {
    kind: "note",
    name: child.title || label || baseName(child.name),
    path: child.path,
    folderId: folder.id ?? null,
    indexName: null,
    fileName: child.name,
    current,
  };
}

// Direct children of `folder` at `parentIdx` (-1 for top-level), in the
// folder's index order (followed by unlisted existing children at top level),
// or in tree order when the folder has no index.
function siblingsAtLevel(folder, parsed, childByName, parentIdx, currentName) {
  const indexLower = folder.indexName ? folder.indexName.toLowerCase() : null;
  const currentLower = currentName ? currentName.toLowerCase() : null;
  const children = (folder.children || []).filter(
    (c) => !indexLower || c.name.toLowerCase() !== indexLower,
  );
  const out = [];
  const seen = new Set();

  if (parsed) {
    const listedLower = new Set();
    for (const entry of parsed.entries) {
      const name = childName(entry.href);
      if (!name) continue;
      const lower = name.toLowerCase();
      if (indexLower && lower === indexLower) continue;
      listedLower.add(lower);
      if (entry.parent !== parentIdx) continue;
      const child = childByName.get(lower);
      if (!child || seen.has(lower)) continue;
      seen.add(lower);
      out.push(
        siblingFromChild(child, folder, {
          current: Boolean(currentLower && lower === currentLower),
          label: unescapeTitle(entry.text),
        }),
      );
    }
    if (parentIdx < 0) {
      const rest = children
        .filter((c) => !listedLower.has(c.name.toLowerCase()))
        .sort(compareTreeItems);
      for (const child of rest) {
        out.push(
          siblingFromChild(child, folder, {
            current: Boolean(
              currentLower && child.name.toLowerCase() === currentLower,
            ),
          }),
        );
      }
    }
    return out;
  }

  for (const child of [...children].sort(compareTreeItems)) {
    out.push(
      siblingFromChild(child, folder, {
        current: Boolean(
          currentLower && child.name.toLowerCase() === currentLower,
        ),
      }),
    );
  }
  return out;
}

function indexLookup(folder) {
  const parsed =
    typeof folder?.indexText === "string" ? parseIndex(folder.indexText) : null;
  const childByName = new Map();
  for (const child of folder?.children || []) {
    childByName.set(child.name.toLowerCase(), child);
  }
  return { parsed, childByName };
}

// Find the deepest library root containing `targetPath`, or null when outside.
export function matchingRoot(roots, targetPath) {
  if (!targetPath || !Array.isArray(roots)) return null;
  let best = null;
  let bestLen = -1;
  for (const root of roots) {
    if (!root?.path || !isUnder(targetPath, root.path)) continue;
    const len = pathKey(root.path).length;
    if (len > bestLen) {
      best = root;
      bestLen = len;
    }
  }
  return best;
}

/**
 * Build breadcrumb segments and per-level sibling dropdown items.
 * Returns null if targetPath is outside all library roots or chain is empty.
 */
export function buildBreadcrumb({
  kind = "note",
  targetPath,
  targetTitle = null,
  fileName = null,
  roots = [],
  chain = [],
} = {}) {
  const root = matchingRoot(roots, targetPath);
  if (!root || !Array.isArray(chain) || !chain.length) return null;

  const isNote = kind === "note";
  const segments = [];
  const rootSiblings =
    roots.length > 1
      ? roots.map((r) => ({
          kind: "root",
          name: r.name,
          path: r.path,
          folderId: r.id ?? null,
          indexName: r.indexName ?? null,
          fileName: null,
          current: pathKey(r.path) === pathKey(chain[0].path),
        }))
      : [];

  // Root library segment.
  const rootCurrent = !isNote && chain.length === 1;
  segments.push({
    kind: "root",
    name: chain[0].name || root.name,
    path: chain[0].path,
    folderId: chain[0].id ?? root.id ?? null,
    indexName: chain[0].indexName ?? null,
    fileName: null,
    clickable: !rootCurrent,
    current: rootCurrent,
    siblings: rootSiblings,
  });

  // Folder segments below root.
  for (let i = 1; i < chain.length; i++) {
    const folder = chain[i];
    const parent = chain[i - 1];
    const { parsed: pParsed, childByName: pChildren } = indexLookup(parent);
    const entryIdx = pParsed ? entryOf(pParsed, folder.name) : -1;
    const parentIdx = entryIdx >= 0 ? pParsed.entries[entryIdx].parent : -1;
    const current = !isNote && i === chain.length - 1;
    segments.push({
      kind: "folder",
      name: folder.name,
      path: folder.path,
      folderId: folder.id ?? null,
      indexName: folder.indexName ?? null,
      fileName: null,
      clickable: !current,
      current,
      siblings: siblingsAtLevel(
        parent,
        pParsed,
        pChildren,
        parentIdx,
        folder.name,
      ),
    });
  }

  if (!isNote) {
    return {
      root: { id: root.id ?? null, name: root.name, path: root.path },
      kind,
      segments,
    };
  }

  // Note segments: parent pages nested inside the leaf folder's index, then the note itself.
  const leafFolder = chain.at(-1);
  const leafName =
    fileName || String(targetPath).split(/[\\/]/).filter(Boolean).at(-1) || "";
  const { parsed, childByName } = indexLookup(leafFolder);
  const selfChild = childByName.get(leafName.toLowerCase()) || null;
  const noteIdx = parsed ? entryOf(parsed, leafName) : -1;

  if (parsed && noteIdx >= 0) {
    const ancestorIdxs = [];
    const seen = new Set([noteIdx]);
    let up = parsed.entries[noteIdx].parent;
    while (up >= 0 && !seen.has(up)) {
      seen.add(up);
      ancestorIdxs.unshift(up);
      up = parsed.entries[up].parent;
    }
    for (const ancIdx of ancestorIdxs) {
      const entry = parsed.entries[ancIdx];
      const name = childName(entry.href);
      const child = name ? childByName.get(name.toLowerCase()) : null;
      const isDir = folderEntry(entry, (n) =>
        Boolean(childByName.get(n.toLowerCase())?.directory),
      );
      const label = unescapeTitle(entry.text);
      if (child?.directory) {
        segments.push({
          kind: "folder",
          name: child.name,
          path: child.path,
          folderId: child.id ?? null,
          indexName: child.indexName ?? null,
          fileName: null,
          clickable: true,
          current: false,
          siblings: siblingsAtLevel(
            leafFolder,
            parsed,
            childByName,
            entry.parent,
            child.name,
          ),
        });
      } else if (child) {
        segments.push({
          kind: "note",
          name: child.title || label || baseName(child.name),
          path: child.path,
          folderId: leafFolder.id ?? null,
          indexName: isIndexName(child.name) ? child.name : null,
          fileName: child.name,
          clickable: true,
          current: false,
          siblings: siblingsAtLevel(
            leafFolder,
            parsed,
            childByName,
            entry.parent,
            child.name,
          ),
        });
      } else {
        segments.push({
          kind: isDir ? "folder" : "page",
          name: label || name || "",
          path: null,
          folderId: null,
          indexName: null,
          fileName: name || null,
          clickable: false,
          current: false,
          siblings: siblingsAtLevel(
            leafFolder,
            parsed,
            childByName,
            entry.parent,
            name,
          ),
        });
      }
    }
  }

  const noteParentIdx = noteIdx >= 0 ? parsed.entries[noteIdx].parent : -1;
  const noteLabel =
    targetTitle || selfChild?.title || baseName(leafName) || leafName;
  segments.push({
    kind: "note",
    name: noteLabel,
    path: targetPath,
    folderId: leafFolder.id ?? null,
    indexName: null,
    fileName: leafName,
    clickable: false,
    current: true,
    siblings: siblingsAtLevel(
      leafFolder,
      parsed,
      childByName,
      noteParentIdx,
      leafName,
    ),
  });

  return {
    root: { id: root.id ?? null, name: root.name, path: root.path },
    kind: "note",
    segments,
  };
}
