// All Chinese UI copy for the iPhone reader. Keep interface strings in one place.

export const STRINGS = {
  appName: "Marklore",
  homeLabel: "主页",
  backToHomeAria: "返回主页",
  outline: "大纲",
  outlineTitle: "大纲",
  emptyOutline: "本篇没有标题",
  close: "关闭",
  cancel: "取消",
  settings: "设置",
  settingsTitle: "阅读设置",
  recent: "最近",
  folders: "全部笔记",
  indexTitle: "目录",
  searchPlaceholder: "搜索笔记…",
  clearSearch: "清除搜索",
  searchEmpty: "没有匹配的笔记",
  searchRootLabel: "根目录",
  emptyLibrary: "当前文件夹还没有可阅读的笔记",
  emptyNote: "（空白笔记）",
  noteMissingToast: "笔记不在手机上",
  imageNotSynced: "图片未同步",
  imageDownloading: "正在下载图片…",
  imageNotDownloaded: "图片还没下载到手机，联网后再打开这篇笔记",
  imageDisabled: "图片未加载",
  sync: "同步",
  signInToSync: "登录后同步",
  syncing: "正在同步…",
  retry: "重试",
  syncJustNow: "刚刚同步",
  syncMinutesAgo: (n) => `${n} 分钟前同步`,
  syncHoursAgo: (n) => `${n} 小时前同步`,
  syncDaysAgo: (n) => `${n} 天前同步`,
  notesCount: (n) => `${n} 篇笔记`,
  imagesCount: (n) => `${n} 张图片`,
  syncListing: (n) =>
    n ? `正在列出云端文件…已找到 ${n} 项` : "正在列出云端文件…",
  syncDownloading: (done, total) =>
    total > 0 ? `正在下载 ${done}/${total}` : "正在下载笔记…",
  syncDone: "同步完成",
  syncFailed: (message) => (message ? `同步失败：${message}` : "同步失败"),
  unconfiguredHint: "需要先填写在微软注册的应用程序 ID",
  clientIdLabel: "应用程序 ID",
  clientIdPlaceholder: "粘贴 Azure 应用程序（客户端）ID",
  clientIdSave: "保存并继续",
  clientIdUpdate: "保存 ID",
  clientIdSaved: "应用程序 ID 已更新",
  clientIdRequired: "请先填写应用程序 ID",
  signedOutAction: "用微软账号登录",
  privacyNote:
    "笔记仅在手机与你的微软账号之间直接传输，不经过任何第三方服务器。",
  editClientId: "更改应用程序 ID",
  chooseFolderTitle: "选择笔记文件夹",
  chooseFolderHint: "点开一个文件夹，再点击下方按钮确认同步位置。",
  breadcrumbRoot: "OneDrive",
  emptySubfolders: "该文件夹内没有子文件夹",
  chooseCurrentFolder: "选这个文件夹",
  loadingFolders: "正在读取文件夹…",
  loadFoldersError: "读取文件夹失败",
  fontSizeLabel: "字号",
  fontSizeSmaller: "减小字号",
  fontSizeLarger: "增大字号",
  themeLabel: "主题",
  themeSystem: "跟随系统",
  themeLight: "浅色",
  themeDark: "深色",
  typefaceLabel: "字体",
  typefaceSans: "黑体",
  typefaceSerif: "宋体",
  keepAwakeLabel: "阅读时屏幕常亮",
  offlineImagesLabel: "下载全部图片供离线",
  offlineImagesHint: "关闭时，图片在打开笔记时才下载",
  accountSection: "账号与同步",
  accountUserLabel: "微软账号",
  accountFolderLabel: "当前文件夹",
  accountUnknownFolder: "未选择",
  changeFolder: "更换文件夹",
  signOut: "退出登录",
};

/**
 * Formats a timestamp relative to `now` for the Home sync status line.
 */
export function formatRelativeSync(timestamp, now = Date.now()) {
  if (!timestamp) return "";
  const elapsedMs = Math.max(0, now - Number(timestamp));
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return STRINGS.syncJustNow;
  if (minutes < 60) return STRINGS.syncMinutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return STRINGS.syncHoursAgo(hours);
  const days = Math.floor(hours / 24);
  return STRINGS.syncDaysAgo(days);
}

/**
 * Formats sync progress updates from `account.onProgress`.
 */
export function formatSyncProgress(progress) {
  if (!progress) return STRINGS.syncing;
  if (progress.phase === "listing")
    return STRINGS.syncListing(progress.done ?? 0);
  if (progress.phase === "downloading")
    return STRINGS.syncDownloading(progress.done ?? 0, progress.total ?? 0);
  if (progress.phase === "done") return STRINGS.syncDone;
  if (progress.phase === "error") return STRINGS.syncFailed(progress.message);
  return progress.message || STRINGS.syncing;
}
