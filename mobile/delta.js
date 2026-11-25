// Pure bookkeeping for OneDrive delta sync (no network, no storage).
//
// Graph's delta responses do not carry item paths, and renaming or moving a
// folder reports only the folder. So the reader keeps every folder and every
// relevant file by id ({ name, parent, kind, tag }) and derives paths by
// walking up to the chosen folder. After each sync the derived paths are
// compared with the stored ones: new or changed content is downloaded, a
// changed path alone is a move, a missing id is a removal.

export const NOTE = /\.(?:md|markdown)$/i;
export const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i;
export const MAX_IMAGE = 20 * 1024 * 1024;

export const kindOf = (name, size = 0) =>
  NOTE.test(name)
    ? "note"
    : IMAGE.test(name) && size <= MAX_IMAGE
      ? "image"
      : null;

// Applies one page of delta items to the `items` map (id → entry) in place.
// `rootId` is the chosen folder; it is kept without a parent.
export function applyDelta(items, page, rootId) {
  for (const item of page) {
    if (!item?.id) continue;
    if (item.deleted) {
      items.delete(item.id);
      continue;
    }
    if (item.id === rootId) {
      items.set(rootId, {
        name: item.name || "",
        parent: null,
        kind: "folder",
        tag: null,
      });
      continue;
    }
    const parent = item.parentReference?.id ?? null;
    if (item.folder || item.package)
      items.set(item.id, {
        name: item.name,
        parent,
        kind: "folder",
        tag: null,
      });
    else if (item.file) {
      const kind = kindOf(item.name, item.size);
      if (kind)
        items.set(item.id, {
          name: item.name,
          parent,
          kind,
          tag:
            item.cTag || item.eTag || String(item.lastModifiedDateTime || ""),
          size: item.size || 0,
          modified: Date.parse(item.lastModifiedDateTime || "") || 0,
        });
      else items.delete(item.id);
    }
  }
  return items;
}

// Path of each file below the root ("Sub/Note.md"); files whose chain does not
// reach the root (moved out, or a parent not seen) are left out.
export function filePaths(items, rootId) {
  const folders = new Map();
  const folderPath = (id, depth = 0) => {
    if (id === rootId) return "";
    if (folders.has(id)) return folders.get(id);
    const entry = items.get(id);
    if (!entry || entry.kind !== "folder" || depth > 64) return null;
    const above = folderPath(entry.parent, depth + 1);
    const path =
      above === null ? null : above ? `${above}/${entry.name}` : entry.name;
    folders.set(id, path);
    return path;
  };
  const out = new Map();
  for (const [id, entry] of items) {
    if (entry.kind === "folder") continue;
    const dir = folderPath(entry.parent);
    if (dir === null) continue;
    out.set(id, dir ? `${dir}/${entry.name}` : entry.name);
  }
  return out;
}

// What to do to go from the stored files ({ id → { path, tag } }) to the items.
export function planSync(items, rootId, stored) {
  const paths = filePaths(items, rootId);
  const download = [],
    move = [],
    remove = [];
  for (const [id, path] of paths) {
    const entry = items.get(id);
    const before = stored.get(id);
    if (!before || before.tag !== entry.tag)
      download.push({ id, path, ...entry });
    else if (before.path !== path)
      move.push({ id, from: before.path, to: path });
  }
  for (const [id, before] of stored)
    if (!paths.has(id)) remove.push({ id, path: before.path });
  return { download, move, remove };
}
