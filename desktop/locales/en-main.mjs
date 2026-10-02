// English for the main part of the interface (see ../i18n.mjs).
export default {
  // Menus, tray, jump list
  最近打开: "Recent",
  "打开 Marklore": "Open Marklore",
  隐藏到托盘: "Hide to tray",
  关闭窗口后留在后台: "Keep running in the background when closed",
  开机启动: "Start at login",
  "后台与默认应用设置…": "Background & default app settings…",
  "退出 Marklore": "Quit Marklore",
  文件: "File",
  "打开文件…": "Open file…",
  "打开文件夹…": "Open folder…",
  新笔记: "New note",
  保存: "Save",
  "另存为…": "Save as…",
  编辑: "Edit",
  查看: "View",
  刷新当前笔记: "Refresh current note",
  阅读: "Read",
  源码: "Source",

  // Dialogs
  系统设置未完成: "The system setting was not applied",
  "插入图片（复制到笔记旁的 assets 文件夹）":
    "Insert image (copied to the assets folder next to the note)",
  图片: "Image",
  "允许笔记加载此本地图片？": "Allow the note to load this local image?",
  "目录授权仅用于图片，不授予其他文件的读取权限。可选择仅在本次运行中加载此图片。":
    "Folder permission covers images only and gives no access to other files. You can also load this image for this session only.",
  取消: "Cancel",
  打开: "Open",
  仅本次加载: "Load this time only",
  记住此图片目录: "Remember this image folder",
  仍然退出: "Quit anyway",
  恢复数据未能写入: "Recovery data could not be written",
  "未保存的草稿不会在下次启动时恢复。建议取消，先保存笔记。":
    "Unsaved drafts won't be restored at next start. Cancel and save your notes first.",
  "下次启动时可能无法恢复标签页和阅读位置。":
    "Tabs and reading positions may not be restored at next start.",
  退出并保留恢复草稿: "Quit and keep recovery drafts",
  有未保存的笔记: "You have unsaved notes",
  "恢复草稿已写入本机，下次启动时恢复；原文件不会自动覆盖。":
    "Recovery drafts are stored on this computer and restored at next start. The original files are not overwritten automatically.",
  "Marklore 启动失败": "Marklore failed to start",
  "在系统浏览器打开外部链接？": "Open external link in the system browser?",
  "打开当前笔记文件夹之外的文件？":
    "Open a file outside the current note folder?",
  "导出 PDF": "Export PDF",
  "导出独立 HTML": "Export standalone HTML",

  // Main-process errors
  恢复数据过大: "Recovery data is too large",
  无效拖入文件: "Invalid dropped files",
  "{name}：不支持的文件类型": "{name}: unsupported file type",
  "{name}：{error}": "{name}: {error}",
  复制内容过大或格式无效: "Copied content is too large or invalid",
  无效窗口操作: "Invalid window action",
  无效系统操作: "Invalid system action",
  "托盘不可用，无法隐藏窗口":
    "The tray is unavailable, so the window can't be hidden",
  便携模式仅在打包版可用: "Portable mode is only available in the packaged app",
  "每次可插入 1–20 张图片": "You can insert 1–20 images at a time",
  "图片合计超过 64 MB": "The images exceed 64 MB in total",
  "剪贴板图片无效或超过 32 MB":
    "The clipboard image is invalid or larger than 32 MB",
  "无法读取剪贴板图片，或图片尺寸过大":
    "Can't read the clipboard image, or its dimensions are too large",
  粘贴图片: "Pasted image",
  无效搜索: "Invalid search",
  文档过大: "The document is too large",
  无效的已打开标签列表: "Invalid list of open tabs",
  "目标已在其他标签页打开，请切换到该标签页保存，或选择其他文件名。":
    "The target is already open in another tab. Switch to that tab to save, or choose another file name.",
  目标文件在保存前发生变化: "The target file changed before saving",
  该文件不在最近打开列表中: "This file is not in the recent files list",
  "找不到图片文件，请检查路径或同步状态。":
    "Image file not found. Check the path or sync status.",
  "图片路径已改变，请重试。": "The image path changed. Please try again.",
  "最多恢复 100 个标签；请先保存并关闭多余标签。现有恢复数据未改动。":
    "Up to 100 tabs can be restored. Save and close the extra tabs first. Existing recovery data is unchanged.",
  恢复草稿需要重新发送: "The recovery draft must be sent again",
  无效关闭操作: "Invalid close action",

  // Files
  "文件或文件夹路径已改变，请重新打开":
    "The file or folder path has changed; open it again",
  "不支持二进制文件或 UTF-16BE，请转换为 UTF-8":
    "Binary files and UTF-16BE are not supported; convert to UTF-8",
  未授权的文件: "File not authorized",
  "文件过大（上限 32 MB）或不是普通文件":
    "The file is too large (limit 32 MB) or not a regular file",
  文件过大: "The file is too large",
  "仅支持 Markdown 或文本文件": "Only Markdown and text files are supported",
  无效或过大的文档: "The document is invalid or too large",
  "正在保存，请稍候": "Saving, please wait",
  "编码后的文件过大（上限 32 MB），未保存":
    "The encoded file is too large (limit 32 MB); not saved",
  未授权的文件夹: "Folder not authorized",
  文件位于所选文件夹之外: "The file is outside the selected folder",
  "暂不支持网络共享路径，请使用本机磁盘文件":
    "Network share paths are not supported yet; use a file on a local disk",
  不支持此链接协议: "Unsupported link protocol",
  无效链接: "Invalid link",
  "目标位于授权文件夹之外；请点击链接确认打开，或先添加笔记文件夹。":
    "The target is outside the allowed folders. Click the link to confirm opening it, or add its note folder first.",
  "仅预览 Markdown 或文本文件": "Only Markdown and text files can be previewed",
  无效图片路径: "Invalid image path",
  不支持的图片类型: "Unsupported image type",
  "图片不是普通文件或超过 64 MB":
    "The image is not a regular file or is larger than 64 MB",
  图片位于授权文件夹之外: "The image is outside the allowed folders",
  "请选择 PNG、JPEG、GIF、WebP、BMP、AVIF 或 SVG 图片":
    "Choose a PNG, JPEG, GIF, WebP, BMP, AVIF or SVG image",
  "图片类型不支持或超过 32 MB":
    "The image type is unsupported or the image is larger than 32 MB",
  图片目录位于笔记文件夹之外: "The image folder is outside the note folder",

  // Export
  "导出排版超过 30 秒，请缩小笔记后重试":
    "Export layout took over 30 seconds; shorten the note and try again",
  无效或过大的导出内容: "The export content is invalid or too large",
  不支持的导出样式: "Unsupported export style",
  导出字体资源缺失: "An export font is missing",
  "缺少离线数学字体：{font}": "Missing offline math font: {font}",
  导出样式包含非离线资源:
    "The export style refers to resources that are not offline",
  无效导出图片: "Invalid export image",
  "单张导出图片上限为 20 MB": "Each exported image is limited to 20 MB",
  导出图片过大: "An export image is too large",
  导出图片引用无效: "Invalid export image reference",
  "导出内容过大（上限 96 MB）": "The export content is too large (limit 96 MB)",
  存在未嵌入的图片: "Some images were not embedded",
  "导出目标必须使用 .pdf 或 .html 扩展名":
    "The export target must have a .pdf or .html extension",
  不能覆盖已打开的笔记: "Can't overwrite an open note",
  导出目标不是可替换的普通文件:
    "The export target is not a regular file that can be replaced",
  "正在导出，请稍候": "Exporting, please wait",
  "请选择 .{extension} 导出文件": "Choose a .{extension} file to export to",
  导出图片解码失败: "Couldn't decode an export image",
  "导出结果过大（上限 96 MB）": "The export result is too large (limit 96 MB)",
  "目标文件在导出期间改变，请另选文件名":
    "The target file changed during export; choose another file name",

  // Links
  "不从笔记启动程序、脚本或快捷方式；请在文件夹中自行打开。":
    "Programs, scripts and shortcuts are not launched from notes. Open them from their folder yourself.",
  链接目标不是普通文件: "The link target is not a regular file",
  "此文件类型暂不直接启动，请在文件夹中打开。":
    "This file type can't be opened directly yet. Open it from its folder.",
  "链接目标已改变，请重新点击": "The link target changed; click it again",
  "无法打开 {name}：{error}": "Can't open {name}: {error}",

  // Windows integration (the two descriptions go to the registry)
  无效程序路径: "Invalid program path",
  "Markdown 文档": "Markdown document",
  "离线 Markdown 笔记阅读与编辑": "Offline Markdown note reader and editor",
  无效后台设置: "Invalid background setting",
  "仅 Windows 打包版支持开机启动":
    "Start at login needs the packaged Windows app",
  "仅 Windows 打包版支持文件关联":
    "File associations need the packaged Windows app",
  "仅 Windows 支持默认应用设置":
    "Default app settings are only available on Windows",
  "仅 Windows 支持启动应用设置":
    "Startup app settings are only available on Windows",

  // Portable mode
  "程序目录中已有 data 文件夹": "The program folder already has a data folder",
  "程序所在文件夹不可写入，无法启用便携模式":
    "The program folder is not writable, so portable mode can't be turned on",

  // Preload (desktop/preload.cjs keeps its own copy of these)
  "每次最多拖入 100 个文件": "You can drop up to 100 files at a time",
  请拖入磁盘上的真实文件: "Drop files that are on disk",
  "单张图片上限 32 MB，每次合计上限 64 MB":
    "Each image is limited to 32 MB, and 64 MB in total per insert",
};
