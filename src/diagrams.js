import DOMPurify from "dompurify";
let library,
  initializedTheme,
  counter = 0,
  queue = Promise.resolve();
const pending = new WeakMap();
export function renderDiagrams(host, theme, onLayout) {
  for (const code of host.querySelectorAll("pre > code.language-mermaid")) {
    const pre = code.parentElement;
    if (pre.dataset.diagramTheme === theme) {
      // A quick light → dark → light toggle must cancel the queued dark render.
      pending.delete(pre);
      continue;
    }
    const source = code.textContent;
    if (pending.get(pre)?.theme === theme) continue;
    const request = { theme };
    pending.set(pre, request);
    const stale = () => !pre.isConnected || pending.get(pre) !== request;
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (stale()) return;
        const diagram =
          pre.querySelector(".diagram") || document.createElement("div");
        diagram.className = "diagram";
        const error = pre.querySelector(".diagram-error");
        error?.remove();
        if (source.length > 50000) {
          diagram.textContent = "图表超过 50,000 字符，请缩小后查看";
          pre.append(diagram);
          pre.dataset.diagramTheme = theme;
          return;
        }
        try {
          library ??= (await import("mermaid")).default;
          if (stale()) return;
          if (initializedTheme !== theme) {
            library.initialize({
              startOnLoad: false,
              securityLevel: "strict",
              theme: theme === "dark" ? "dark" : "neutral",
              suppressErrorRendering: true,
              maxTextSize: 50000,
              flowchart: { htmlLabels: false },
              htmlLabels: false,
            });
            initializedTheme = theme;
          }
          const { svg } = await library.render(
            "folio-diagram-" + ++counter,
            source,
          );
          if (stale()) return;
          diagram.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["foreignObject", "image", "script"],
            FORBID_ATTR: ["onload", "onclick"],
          });
          for (const el of diagram.querySelectorAll("[href],[xlink\\:href]")) {
            for (const attr of ["href", "xlink:href"])
              if (
                el.hasAttribute(attr) &&
                !el.getAttribute(attr).startsWith("#")
              )
                el.removeAttribute(attr);
          }
          code.hidden = true;
          pre.classList.add("diagram-host");
          pre.append(diagram);
          pre.dataset.diagramTheme = theme;
          onLayout();
        } catch (e) {
          if (stale()) return;
          code.hidden = false;
          diagram.remove();
          const msg = document.createElement("div");
          msg.className = "diagram-error";
          msg.textContent =
            "图表语法错误：" + String(e.message || e).slice(0, 300);
          pre.append(msg);
          pre.dataset.diagramTheme = theme;
        }
      })
      .finally(() => {
        if (pending.get(pre) === request) pending.delete(pre);
      });
  }
}
