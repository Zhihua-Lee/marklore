import { t } from "../desktop/i18n.mjs";
// Rows like the rest of Settings: name and a short status on the left,
// switch or buttons on the right.
const setting = (name, note, control) =>
  `<div class="setting"><span class="setting-text">${name}${note}</span>${control}</div>`;
export const desktopSettingsMarkup = `
<fieldset id="desktop-settings" hidden><legend>${t("后台与系统")}</legend>
  ${setting(`<label for="close-to-tray">${t("关闭窗口后留在托盘")}</label>`, `<small>${t("后台保留标签与草稿")}</small>`, '<input id="close-to-tray" type="checkbox" class="switch">')}
  ${setting(`<label for="start-at-login">${t("开机启动到托盘")}</label>`, '<small id="startup-status"></small>', `<span class="setting-actions"><button id="update-startup" hidden>${t("更新路径")}</button><button id="startup-settings">${t("启动管理")}</button><input id="start-at-login" type="checkbox" class="switch"></span>`)}
  ${setting(`<span>${t("Markdown 文件关联")}</span>`, '<small id="association-status" role="status"></small>', `<span class="setting-actions"><button id="register-markdown">${t("注册")}</button><button id="manage-defaults">${t("默认应用…")}</button></span>`)}
  ${setting(`<label for="portable-mode">${t("便携模式")}</label>`, '<small id="portable-status"></small>', '<input id="portable-mode" type="checkbox" class="switch">')}
  ${setting(`<span>${t("托盘")}</span>`, "", `<span class="setting-actions"><button id="hide-to-tray">${t("隐藏到托盘")}</button><button id="quit-app">${t("完全退出")}</button></span>`)}
  <p id="desktop-executable" class="setting-footnote"></p>
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
            ? "Marklore"
            : item.known
              ? t("其他应用")
              : t("未读取到用户默认项"),
        }),
      )
      .join(t("；"));
    const registration = status.registered
      ? status.registeredHere
        ? t("已注册")
        : t("注册指向其他版本")
      : t("未注册");
    q("#register-markdown").textContent = status.registered
      ? t("更新")
      : t("注册");
    q("#association-status").textContent = !status.supported
      ? t("仅 Windows 打包版可用")
      : `${registration} · ${associations}`;
    q("#startup-status").textContent = status.startupOtherVersion
      ? t("指向其他版本，请更新路径")
      : status.startup && !status.startupEnabled
        ? t("已被系统禁用")
        : "";
    q("#desktop-executable").textContent = t("当前程序：{path}", {
      path: status.executable,
    });
    const portable = status.portable || {};
    if (!busy) q("#portable-mode").checked = Boolean(portable.on);
    q("#portable-mode").disabled = busy || !portable.available;
    q("#portable-status").textContent = portable.installed
      ? t("安装版不支持；需要随身携带请使用 zip 版")
      : !portable.available
        ? t("仅打包版可用")
        : status.restarting
          ? t("正在重启 Marklore…")
          : portable.on
            ? t("数据在 {folder}", { folder: portable.folder })
            : t("数据存到程序旁的 data 文件夹，可随 U 盘携带");
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
