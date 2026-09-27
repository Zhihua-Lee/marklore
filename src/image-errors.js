// Describe failed local resources without broadening filesystem access on render.
export function wireImageErrors(api, report) {
  const failures = new WeakMap();
  const retry = () => {
    for (const img of document.querySelectorAll('img[src^="folio-asset:"]')) {
      const panel = failures.get(img);
      if (!panel) continue;
      panel.remove();
      img.hidden = false;
      failures.delete(img);
      if (img.isConnected) {
        const url = new URL(img.src);
        url.searchParams.set("retry", String(Date.now()));
        img.src = url.href;
      }
    }
  };
  document.addEventListener(
    "error",
    async (event) => {
      const img = event.target;
      if (
        !(img instanceof HTMLImageElement) ||
        !img.closest("#content,#link-preview") ||
        !img.src.startsWith("folio-asset:") ||
        !api?.imageInfo ||
        failures.has(img)
      )
        return;
      const src = img.src,
        url = new URL(src),
        href = url.searchParams.get("path");
      const panel = document.createElement("span");
      failures.set(img, panel);
      try {
        const info = await api.imageInfo(url.hostname, href);
        if (!img.isConnected || img.src !== src) {
          failures.delete(img);
          return;
        }
        panel.className = "image-problem";
        const label = document.createElement("span"),
          reason = document.createElement("small"),
          button = document.createElement("button");
        label.textContent = img.alt || "图片";
        reason.textContent =
          info.error ||
          (info.authorized
            ? "图片解码失败，请检查文件内容或同步状态。"
            : "图片位于当前授权目录之外。");
        panel.title = info.path || href;
        button.type = "button";
        button.textContent =
          !info.error && !info.authorized ? "授权加载图片…" : "重试";
        button.onclick = async (event) => {
          event.stopPropagation();
          button.disabled = true;
          try {
            if (
              info.error ||
              info.authorized ||
              (await api.allowImage(url.hostname, href))
            )
              retry();
          } catch (error) {
            report(error.message);
          } finally {
            button.disabled = false;
          }
        };
        panel.append(label, reason, button);
        img.hidden = true;
        img.after(panel);
      } catch (error) {
        failures.delete(img);
        report(error.message);
      }
    },
    true,
  );
}
