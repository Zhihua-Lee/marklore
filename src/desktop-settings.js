import { t } from "../desktop/i18n.mjs";
export const desktopSettingsMarkup = `
<fieldset id="desktop-settings" hidden><legend>${t("后台与系统")}</legend>
  <label for="close-to-tray">${t("关闭窗口后留在托盘")}<input id="close-to-tray" type="checkbox"></label>
  <label for="start-at-login">${t("开机启动到托盘")}<input id="start-at-login" type="checkbox"></label>
  <p class="setting-hint">${t("后台保留标签与草稿，不自动覆盖笔记。托盘菜单可重新打开或完全退出。")}</p>
  <div class="desktop-actions"><button id="hide-to-tray">${t("隐藏到托盘")}</button><button id="quit-app">${t("完全退出")}</button><button id="startup-settings">${t("Windows 启动管理")}</button><button id="update-startup" hidden>${t("更新启动路径为此版本")}</button></div>
  <p id="association-status" class="setting-hint" role="status"></p>
  <div class="desktop-actions"><button id="register-markdown">${t("注册／更新 Markdown 支持")}</button><button id="manage-defaults">${t("选择默认应用…")}</button></div>
  <p class="setting-hint">${t("支持 .md 和 .markdown。默认应用由 Windows 确认；移动或升级便携版后，请重新注册并更新开机启动路径。")}</p>
  <p id="desktop-executable" class="setting-hint"></p>
  <label for="portable-mode">${t("便携模式（数据保存在程序旁的 data 文件夹）")}<input id="portable-mode" type="checkbox"></label>
  <p id="portable-status" class="setting-hint"></p>
</fieldset>`;

export function wireDesktopSettings({ api, close, report, flush }) {
  if (!api?.desktopStatus) return () => {};
  const q = (s) => document.querySelector(s),
    section = q("#desktop-settings");
  section.hidden = false;
  let busy = false,
    status,
    revision = 0;
  function paint() {
    if (!status) return;
    if (!busy) {
      q("#close-to-tray").checked = status.closeToTray;
      q("#start-at-login").checked =
        status.startup || status.startupOtherVersion;
    }
    q("#update-startup").hidden = !status.startupOtherVersion;
    for (const node of section.querySelectorAll("button,input"))
      node.disabled = busy;
    q("#close-to-tray").disabled = busy || !status.trayAvailable;
    q("#hide-to-tray").disabled = busy || !status.trayAvailable;
    for (const id of [
      "start-at-login",
      "register-markdown",
      "manage-defaults",
      "startup-settings",
      "update-startup",
    ])
      q("#" + id).disabled = busy || !status.supported;
    const associations = (status.defaults || [])
      .map((item) =>
        t("{extension}：{owner}", {
          extension: item.extension,
          owner: item.ours
            ? "Folio Notes"
            : item.known
              ? t("其他应用")
              : t("未读取到用户默认项"),
        }),
      )
      .join(t("；"));
    const registration = status.registered
      ? status.registeredHere
        ? t("已注册当前程序。")
        : t("注册指向其他版本，请更新。")
      : t("尚未注册 Markdown 支持。");
    const startupNote = status.startupOtherVersion
      ? " " + t("开机启动指向其他版本，请更新启动路径。")
      : status.startup && !status.startupEnabled
        ? " " + t("开机启动被系统禁用，可在启动管理中检查。")
        : "";
    q("#association-status").textContent = !status.supported
      ? t("系统集成仅在 Windows 打包版可用。")
      : `${registration} ${associations}${startupNote}`;
    q("#desktop-executable").textContent = t("当前程序：{path}", {
      path: status.executable,
    });
    const portable = status.portable || {};
    if (!busy) q("#portable-mode").checked = Boolean(portable.on);
    q("#portable-mode").disabled = busy || !portable.available;
    q("#portable-status").textContent = !portable.available
      ? t("便携模式仅在打包版可用。")
      : status.restarting
        ? t("正在重启 Folio Notes…")
        : portable.on
          ? t(
              "数据保存在 {folder}。停用时数据复制回用户目录，data 文件夹改名保留，不会删除。",
              { folder: portable.folder },
            )
          : t(
              "开启后把标签、草稿、最近文件与后台设置复制到程序旁的 data 文件夹并自动重启，适合放在 U 盘中随身使用。",
            );
  }
  async function refresh() {
    if (busy) return;
    const current = ++revision;
    try {
      const next = await api.desktopStatus();
      if (current === revision) {
        status = next;
        paint();
      }
    } catch (error) {
      if (current === revision) report(error.message);
    }
  }
  async function change(action) {
    if (busy) return;
    revision++;
    busy = true;
    paint();
    try {
      // Switching data folders restarts Folio: save tabs and drafts first.
      if (action.type === "portable") await flush?.();
      status = await api.desktopAction(action);
    } catch (error) {
      report(error.message);
    } finally {
      busy = false;
      paint();
    }
  }
  q("#close-to-tray").onchange = (event) =>
    change({ type: "background", value: event.target.checked });
  q("#start-at-login").onchange = (event) =>
    change({ type: "startup", value: event.target.checked });
  q("#update-startup").onclick = () => change({ type: "startup", value: true });
  q("#portable-mode").onchange = (event) =>
    change({ type: "portable", value: event.target.checked });
  for (const [id, type] of [
    ["register-markdown", "register"],
    ["manage-defaults", "defaults"],
    ["startup-settings", "startupSettings"],
  ])
    q("#" + id).onclick = () => change({ type });
  q("#hide-to-tray").onclick = () =>
    close("hide").catch((error) => report(error.message));
  q("#quit-app").onclick = () =>
    close("quit").catch((error) => report(error.message));
  q("#weight").addEventListener("click", refresh);
  window.addEventListener("focus", () => {
    if (q("#appearance").open) refresh();
  });
  api.on("desktop-settings", () => {
    if (q("#appearance").open) refresh();
  });
  return () => {
    q("#appearance").dispatchEvent(
      new CustomEvent("folio:open-section", { detail: "desktop-settings" }),
    );
    q("#close-to-tray").focus();
    refresh();
  };
}
