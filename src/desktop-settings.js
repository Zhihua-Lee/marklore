export const desktopSettingsMarkup = `
<fieldset id="desktop-settings" hidden><legend>后台与系统</legend>
  <label for="close-to-tray">关闭窗口后留在托盘<input id="close-to-tray" type="checkbox"></label>
  <label for="start-at-login">开机启动到托盘<input id="start-at-login" type="checkbox"></label>
  <p class="setting-hint">后台保留标签与草稿，不自动覆盖笔记。托盘菜单可重新打开或完全退出。</p>
  <div class="desktop-actions"><button id="hide-to-tray">隐藏到托盘</button><button id="quit-app">完全退出</button><button id="startup-settings">Windows 启动管理</button><button id="update-startup" hidden>更新启动路径为此版本</button></div>
  <p id="association-status" class="setting-hint" role="status"></p>
  <div class="desktop-actions"><button id="register-markdown">注册／更新 Markdown 支持</button><button id="manage-defaults">选择默认应用…</button></div>
  <p class="setting-hint">支持 .md 和 .markdown。默认应用由 Windows 确认；移动或升级便携版后，请重新注册并更新开机启动路径。</p>
  <p id="desktop-executable" class="setting-hint"></p>
</fieldset>`;

export function wireDesktopSettings({ api, close, report }) {
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
      .map(
        (item) =>
          `${item.extension}：${item.ours ? "Folio Notes" : item.known ? "其他应用" : "未读取到用户默认项"}`,
      )
      .join("；");
    q("#association-status").textContent = !status.supported
      ? "系统集成仅在 Windows 打包版可用。"
      : `${status.registered ? (status.registeredHere ? "已注册当前程序。" : "注册指向其他版本，请更新。") : "尚未注册 Markdown 支持。"} ${associations}${status.startupOtherVersion ? " 开机启动指向其他版本，请更新启动路径。" : status.startup && !status.startupEnabled ? " 开机启动被系统禁用，可在启动管理中检查。" : ""}`;
    q("#desktop-executable").textContent = "当前程序：" + status.executable;
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
    if (!q("#appearance").open) q("#appearance").showModal();
    section.scrollIntoView({ block: "nearest" });
    q("#close-to-tray").focus();
    refresh();
  };
}
