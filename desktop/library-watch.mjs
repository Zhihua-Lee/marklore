// The library follows its folders: notes and folders that another program
// (an AI agent, a sync tool, Explorer) creates, renames or deletes show up
// without a manual refresh. One recursive watcher per library folder.
import { watch as fsWatch } from "node:fs";
import path from "node:path";
import { markdownPath } from "./files.mjs";

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
  return markdownPath(last) || !/\.[a-z0-9]{1,5}$/i.test(last);
}

export function createLibraryWatch({ notify, delay = 400, watch = fsWatch }) {
  const watchers = new Map();
  let timer;
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
          // "change" events are edits to existing files: the tree is unchanged.
          const watcher = watch(folder, { recursive: true }, (type, name) => {
            if (type !== "rename" || !treeChange(name)) return;
            clearTimeout(timer);
            timer = setTimeout(notify, delay);
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
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
