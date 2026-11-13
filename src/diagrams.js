import { t } from "../desktop/i18n.mjs";
import DOMPurify from "dompurify";
import { settled } from "./composing.js";
let compiled,
  counter = 0,
  queue = Promise.resolve();
const pending = new WeakMap();

// Diagrams are drawn by Ondine (Mermaid's syntax compiled to SVG by a Rust
// module): tens of times faster and far lighter than mermaid.js. Its
// colors come from CSS variables (diagrams.css), so a theme change needs no
// new drawing. What it cannot read shows its error under the source.
async function draw(source) {
  if (!compiled) {
    const [{ create }, { wasm }] = await Promise.all([
      import("ondine/compiler/wasm"),
      import("ondine/compiler/wasm/all"),
    ]);
    compiled = create({ modules: { all: wasm } });
  }
  return compiled.render(source, {
    autoDirection: false,
    idPrefix: `folio-diagram-${++counter}-`,
    limit: 50000,
  }).svg;
}
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
          diagram.textContent = t("图表超过 50,000 字符，请缩小后查看");
          pre.append(diagram);
          pre.dataset.diagramTheme = theme;
          return;
        }
        try {
          const svg = await draw(source);
          if (stale()) return;
          // Not while an input method composes (see composing.js).
          await settled();
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
          onLayout?.();
        } catch (e) {
          if (stale()) return;
          code.hidden = false;
          diagram.remove();
          const msg = document.createElement("div");
          msg.className = "diagram-error";
          msg.textContent = t("图表语法错误：{message}", {
            message: String(e.message || e).slice(0, 300),
          });
          pre.append(msg);
          pre.dataset.diagramTheme = theme;
        }
      })
      .finally(() => {
        if (pending.get(pre) === request) pending.delete(pre);
      });
  }
}
