import path from "node:path";
import fs from "node:fs/promises";
import { markdownPath } from "./files.mjs";

// A note is not a launcher for executable content or shell shortcuts.
const executable =
  /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|cpl|reg|lnk|url|appref-ms|application|scf|hta|dll|pif)$/i;
export function createLinkOpener({ files, dialog, shell, owner, openFile }) {
  return async (id, href) => {
    if (typeof href !== "string" || href.length > 8192) throw Error("无效链接");
    if (/^https?:\/\//i.test(href)) {
      const url = new URL(href);
      const result = await dialog.showMessageBox(owner(), {
        message: "在系统浏览器打开外部链接？",
        detail: url.href,
        buttons: ["取消", "打开"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response === 1) await shell.openExternal(url.href);
      return null;
    }
    const { path: target, authorized } = await files.linkTarget(id, href);
    if (executable.test(target))
      throw Error("不从笔记启动程序、脚本或快捷方式；请在文件夹中自行打开。");
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw Error("链接目标不是普通文件");
    if (!markdownPath(target)) {
      if (
        !/\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|tsv|tex|bib|json|ya?ml|xml|log|ipynb|png|jpe?g|gif|webp|bmp|avif|svg|tiff?|ico|mp[34]|m4[av]|wav|flac|ogg|aac|opus|webm|mov|avi|mkv|zip|7z|rar|html?)$/i.test(
          target,
        )
      )
        throw Error("此文件类型暂不直接启动，请在文件夹中打开。");
      const result = await dialog.showMessageBox(owner(), {
        message: "使用系统默认应用打开附件？",
        detail: target,
        buttons: ["取消", "打开"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return null;
      // Re-resolve after the user confirmation; do not launch a changed symlink.
      if ((await files.linkTarget(id, href)).path !== target)
        throw Error("链接目标已改变，请重新点击");
      const error = await shell.openPath(target);
      if (error) throw Error(`无法打开 ${path.basename(target)}：${error}`);
      return null;
    }
    if (!authorized) {
      const result = await dialog.showMessageBox(owner(), {
        message: "打开当前笔记文件夹之外的文件？",
        detail: target,
        buttons: ["取消", "打开"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return null;
    }
    return openFile(target);
  };
}
