// The library follows its folders: notes and folders that another program
// (an AI agent, a sync tool, Explorer) creates, renames or deletes show up
// without a manual refresh. One recursive watcher per library folder.
import { watch as fsWatch } from "node:fs";
import path from "node:path";
import { markdownPath, otherPath } from "./files.mjs";
import { isIndexName } from "./folder-index.mjs";

// Does a change to this entry (relative to the library folder) affect the
// tree? Notes and folders do; hidden folders (.git, .obsidian), node_modules
// and other file types (images, our .folio-*.tmp saves) do not. Without a
// name, refresh to be safe.
export function treeChange(name) {
  if (!name) return true;
  const parts = String(name).split(/[\\/]/);
  if (parts.some((part) => part.startsWith(".") || part === "node_modules"))
    return false;
  const last = parts.at(-1);
  return (
    markdownPath(last) || otherPath(last) || !/\.[a-z0-9]{1,5}$/i.test(last)
  );
}

// notify(): the tree changed. noteChanged(path): a note was written, created,
// renamed or deleted (the link index follows its content). foldersChanged():
// something that may be a folder was renamed, moved or deleted (one event
// for the folder, none for the notes in it): the index looks again.
export function createLibraryWatch({
  notify,
  noteChanged = () => {},
  foldersChanged = () => {},
  delay = 400,
  watch = fsWatch,
}) {
  const watchers = new Map();
  let timer, foldersTimer;
  return {
    // Watch exactly these folders; folders no longer in the library are released.
    follow(folders) {
      const wanted = new Set(folders.map((folder) => path.resolve(folder)));
      for (const [folder, watcher] of watchers)
        if (!wanted.has(folder)) {
          watcher.close();
          watchers.delete(folder);
        }
      for (const folder of wanted) {
        if (watchers.has(folder)) continue;
        try {
          // "change" events are edits to existing files: the tree is
          // unchanged, unless the file is a folder's index (its order).
          const watcher = watch(folder, { recursive: true }, (type, name) => {
            if (name && treeChange(name) && markdownPath(String(name)))
              noteChanged(path.join(folder, String(name)));
            const order =
              name && isIndexName(String(name).split(/[\\/]/).at(-1));
            if ((type !== "rename" && !order) || !treeChange(name)) return;
            clearTimeout(timer);
            timer = setTimeout(notify, delay);
            if (
              type === "rename" &&
              !(name && (markdownPath(String(name)) || otherPath(String(name))))
            ) {
              clearTimeout(foldersTimer);
              foldersTimer = setTimeout(foldersChanged, delay);
            }
          });
          watcher.on("error", () => {
            watcher.close();
            watchers.delete(folder);
          });
          watchers.set(folder, watcher);
        } catch {
          /* The refresh button still works where folders cannot be watched. */
        }
      }
    },
    close() {
      clearTimeout(timer);
      clearTimeout(foldersTimer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
