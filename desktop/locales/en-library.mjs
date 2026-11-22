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

  // Repair after changes made elsewhere (src/library.js, tree-dialogs.js)
  "修复链接…": "Repair link…",
  "{count} 项不存在": "{count} missing",
  "修复了“{name}”中指向“{to}”的链接": "Repaired links to “{to}” in “{name}”",
  "链接的目标存在，不需要修复": "The link's target exists; nothing to repair",
  "已新建“{name}”": "Created “{name}”",
  "已移除指向“{name}”的链接": "Removed the links to “{name}”",
  "链接已改为指向“{name}”": "The link now points to “{name}”",
  目录中的条目都存在: "Every entry in the index exists",
  修复目录中不存在的条目: "Repair missing index entries",
  筛选条目: "Filter entries",
  没有匹配的条目: "No matching entry",
  修复这一项: "Repair this one",
  "修复不存在的条目…": "Repair missing entries…",
  "“{name}”不存在": "“{name}” is missing",
  "目录中的这一项指向 {rel}，那里没有文件。":
    "This index entry points to {rel}, where there is no file.",
  "这个链接指向 {rel}，那里没有文件。":
    "This link points to {rel}, where there is no file.",
  刚被改名或移动到这里: "Just renamed or moved here",
  同名的文件: "Same name",
  这个文件夹中未列入目录的笔记: "Not in this folder's index",
  可以改为指向: "Point it to",
  "可以改为指向：": "Point it to:",
  "笔记库中没有找到同名或刚改名的文件。":
    "No file of the same name, or just renamed, was found in the library.",
  从目录中移除: "Remove from index",
  移除链接: "Remove link",
  新建这篇笔记: "Create this note",
  改为指向所选: "Point to selected",
  只能在笔记库中新建笔记: "Notes can be created only in the library",
  所在的文件夹不存在: "Its folder does not exist",
  "目标不在笔记库中，或已不存在":
    "The target is not in the library, or no longer exists",

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
  "子页不能一起移动：{reason}": "Child pages cannot go along: {reason}",
  "“{name}”未列入目录，请先把它拖进目录":
    "“{name}” is not in the index; drag it into the index first",
  "笔记库仍在读取，可能还有链接没有列出。":
    "The library is still being read; some links may not be listed yet.",
  没有可撤销的改名或移动: "There is no rename or move to undo",
  "无法撤销：“{name}”已被移动、改名或占用":
    "Cannot undo: “{name}” has been moved, renamed or taken since",
  // One name per note (note-names.mjs), the folder's index button and
  // "Unify names".
  "打开目录（{name}）": "Open index ({name})",
  "已更新 {count} 篇笔记": "{count} notes updated",
  "统一名字…": "Unify names…",
  "文件名、目录条目和标题统一为笔记的标题":
    "Make file names, index entries and titles the note's heading",
  "已统一 {notes} 篇笔记的名字，更新了 {count} 个文件":
    "Names of {notes} notes unified; {count} files updated",
  "统一了“{name}”中的名字": "Unified names in “{name}”",
  "统一“{name}”中的名字": "Unify names in “{name}”",
  "笔记的名字是它开头的一级标题；没有标题的笔记取目录条目或文件名作为标题。文件名、目录条目和属性 title 都改为这个名字。":
    "A note's name is its leading level-1 heading; a note without one gets its index entry or file name as its heading. File names, index entries and the title property all become that name.",
  包括子文件夹: "Include subfolders",
  "其他笔记中的链接随之更新；改写前每个文件都会备份，可用“撤销上次改名/移动”一并恢复。":
    "Links in other notes follow. Every file is backed up before it is rewritten; “Undo last rename or move” restores them all.",
  统一名字: "Unify names",
  "{count} 篇笔记会改变：": "{count} notes will change:",
  "名字都已统一，没有要改的。": "All names agree already; nothing to change.",
  "文件名 {from} → {to}": "file name {from} → {to}",
  加上标题: "heading added",
  "目录条目“{from}”": "index entry “{from}”",
  "属性 title“{from}”": "title property “{from}”",
  "有未保存修改的笔记不改：{names}":
    "Notes with unsaved changes are left as they are: {names}",
  名称不能为空: "The name cannot be empty",
  "文件夹在检查后有变化，请重新统一名字":
    "The folder changed after it was checked; unify its names again",
};
