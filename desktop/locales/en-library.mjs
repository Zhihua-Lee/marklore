// English for the library's hierarchy: index files, child pages, moves and
// the links that follow them (see ../i18n.mjs).
export default {
  // The tree (src/library.js)
  未列入目录: "Not in the index",
  "{name} 有未保存的修改，请先保存，再调整目录":
    "{name} has unsaved changes. Save it first, then change the index.",
  上面没有可作为上级的笔记: "There is no note above to go under",
  已在最上一层: "Already at the top level",
  新子页名称: "Child page name",
  新建子页: "New child page",
  "移动到…": "Move to…",
  "{count} 个文件未能更新：{names}": "{count} file(s) not updated: {names}",
  "把“{name}”改名为“{to}”": "Rename “{name}” to “{to}”",
  "已改名，{count} 篇笔记中的链接已更新":
    "Renamed. Links updated in {count} note(s)",
  "已改名为“{name}”": "Renamed to “{name}”",
  "把“{name}”移动到…": "Move “{name}” to…",
  "把“{name}”移到“{to}”": "Move “{name}” to “{to}”",
  "已移到“{folder}”，{count} 篇笔记中的链接已更新":
    "Moved to “{folder}”. Links updated in {count} note(s)",
  "已移到“{folder}”": "Moved to “{folder}”",
  "已撤销上次改名/移动；{count} 个文件之后又有修改，未还原：{names}":
    "Last rename or move undone; {count} file(s) changed since were left as they are: {names}",
  "已撤销上次改名/移动": "Last rename or move undone",
  "“{name}”改名为“{to}”": "“{name}” renamed to “{to}”",
  "“{name}”移到“{to}”": "“{name}” moved to “{to}”",
  "撤销上次改名/移动": "Undo last rename or move",

  // Its questions (src/tree-dialogs.js)
  建立目录: "Start an index",
  "为“{name}”建立目录？": "Start an index for “{name}”?",
  "这个文件夹按名称排列。调整顺序、建立子页需要一个目录文件 {name}：它按现在的顺序列出文件夹中的笔记和子文件夹，之后的顺序和层级都记在里面。":
    "This folder is sorted by name. Ordering entries and making child pages need an index file, {name}: it lists the folder's notes and subfolders in their current order, and keeps the order and nesting from then on.",
  "建立 {name}": "Create {name}",
  "{count} 处": "{count}",
  "同时移动 {count} 个子页": "Also move its {count} child page(s)",
  "改写前每个文件都会备份，可用“撤销上次改名/移动”一并恢复。":
    "Each file is backed up before it is rewritten; “Undo last rename or move” puts them all back.",
  只改名: "Rename only",
  只移动: "Move only",
  "{count} 篇笔记中有链接会随之改变：":
    "Links in {count} note(s) would change with it:",
  "更新 {count} 篇笔记的链接": "Update links in {count} note(s)",
  重命名: "Rename",
  移动: "Move",
  筛选文件夹: "Filter folders",
  没有可移动到的文件夹: "No folder to move to",
  移到这里: "Move here",

  // Main process (desktop/files.mjs, desktop/note-moves.mjs)
  "{name} 刚被其他程序修改，请重试":
    "{name} was just changed by another program. Please try again.",
  这个文件夹已有目录文件: "This folder already has an index file",
  已在这个文件夹中: "It is already in this folder",
  不能把文件夹移到它自己里面: "A folder cannot move into itself",
  "目标文件夹中已有“{name}”": "The destination already has “{name}”",
  不能移动到另一个磁盘上的文件夹: "Cannot move to a folder on another drive",
  "{name} 有未保存的修改，请先保存，再改名或移动":
    "{name} has unsaved changes. Save it first, then rename or move.",
  没有可撤销的改名或移动: "There is no rename or move to undo",
  "无法撤销：“{name}”已被移动、改名或占用":
    "Cannot undo: “{name}” has been moved, renamed or taken since",
};
