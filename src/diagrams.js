import { t } from "../desktop/i18n.mjs";
import DOMPurify from "dompurify";
import { settled } from "./composing.js";
import { icon } from "./icons.js";
import { openDiagramViewer } from "./diagram-viewer.js";
let compiled,
  counter = 0,
  queue = Promise.resolve();
const pending = new WeakMap();

// A diagram is a figure, not a page: its text a little smaller than the
// note's, and no taller than CAP (or 60 % of the window). One that fits by
// shrinking to MIN_SCALE or more is shrunk; a taller one is drawn at
// MIN_SCALE and cut off with a fade, the whole of it a click away in the
// viewer. Never drawn larger than Ondine made it.
const TEXT_RATIO = 0.8;
const CAP = 480;
const CAP_SHARE = 0.6;
const MIN_SCALE = 0.8;

// Diagrams are drawn by Ondine (Mermaid's syntax compiled to SVG by a Rust
// module): tens of times faster and far lighter than mermaid.js. Its
// colors come from CSS variables (diagrams.css), so a theme change needs no
// new drawing. What it cannot read shows its error under the source.
async function draw(source, fontSize, maxWidth) {
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
    fontSize,
    responsive: false,
    ...(maxWidth > 0 ? { maxWidth } : {}),
  });
}

function textSize(host) {
  const prose = host.closest?.(".prose") || host.querySelector?.(".prose");
  const base = parseFloat(getComputedStyle(prose || host).fontSize) || 16;
  return Math.round(base * TEXT_RATIO);
}

// The scale a diagram of natural size w × h is drawn at in a column `room`
// wide under a height cap, and whether it is cut off.
export function fitScale(w, h, room, cap) {
  const across = Math.min(1, room / w);
  if (h * across <= cap) return { scale: across, clipped: false };
  const down = cap / h;
  if (down >= MIN_SCALE) return { scale: down, clipped: false };
  return { scale: Math.min(across, MIN_SCALE), clipped: true };
}

const lastFit = new WeakMap();
const tracked = new Set();
let observer, refitting;
function fitDiagram(diagram) {
  const svg = diagram.querySelector(":scope > svg");
  const w = Number(diagram.dataset.width);
  const h = Number(diagram.dataset.height);
  const room = diagram.clientWidth;
  if (!svg || !w || !h || !room) return;
  const cap = Math.min(CAP, window.innerHeight * CAP_SHARE);
  const key = `${room}/${cap}`;
  if (lastFit.get(diagram) === key) return;
  lastFit.set(diagram, key);
  const { scale, clipped } = fitScale(w, h, room, cap);
  svg.style.width = `${w * scale}px`;
  diagram.classList.toggle("diagram-clipped", clipped);
  diagram.style.maxHeight = clipped ? `${Math.floor(cap)}px` : "";
  diagram.parentElement?.classList.toggle(
    "diagram-reduced",
    clipped || scale < 1,
  );
}
function track(diagram) {
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const diagram = entry.target.querySelector(":scope > .diagram");
        if (diagram) fitDiagram(diagram);
      }
    });
    // A window only made shorter changes the cap, not any column's width.
    window.addEventListener("resize", () => {
      if (refitting) return;
      refitting = requestAnimationFrame(() => {
        refitting = 0;
        for (const diagram of tracked)
          if (!diagram.isConnected) {
            tracked.delete(diagram);
            observer.unobserve(diagram.parentElement || diagram);
          } else fitDiagram(diagram);
      });
    });
  }
  tracked.add(diagram);
  observer.observe(diagram.parentElement);
}

function viewButton(diagram) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diagram-view";
  button.setAttribute("aria-label", t("放大查看图表"));
  button.title = t("放大查看图表");
  button.innerHTML = icon("fullScreen");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDiagramViewer(diagram);
  });
  return button;
}

// `fit: false` (an export) draws each diagram whole, without the viewer.
export function renderDiagrams(host, theme, onLayout, { fit = true } = {}) {
  const fontSize = textSize(host);
  const key = `${theme}/${fontSize}`;
  for (const code of host.querySelectorAll("pre > code.language-mermaid")) {
    const pre = code.parentElement;
    if (pre.dataset.diagramTheme === key) {
      // A quick light → dark → light toggle must cancel the queued dark render.
      pending.delete(pre);
      continue;
    }
    const source = code.textContent;
    if (pending.get(pre)?.key === key) continue;
    const request = { key };
    pending.set(pre, request);
    const stale = () => !pre.isConnected || pending.get(pre) !== request;
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (stale()) return;
        const diagram =
          pre.querySelector(".diagram") || document.createElement("div");
        diagram.className = "diagram";
        diagram.removeAttribute("style");
        lastFit.delete(diagram);
        const error = pre.querySelector(".diagram-error");
        error?.remove();
        pre.querySelector(":scope > .diagram-view")?.remove();
        pre.classList.remove("diagram-reduced");
        if (source.length > 50000) {
          diagram.textContent = t("图表超过 50,000 字符，请缩小后查看");
          pre.append(diagram);
          pre.dataset.diagramTheme = key;
          return;
        }
        try {
          // The column's width, less the frame's padding (diagrams.css).
          const room = Math.max(0, pre.clientWidth - 24);
          const drawn = await draw(source, fontSize, room);
          if (stale()) return;
          // Not while an input method composes (see composing.js).
          await settled();
          if (stale()) return;
          diagram.innerHTML = DOMPurify.sanitize(drawn.svg, {
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
          pre.dataset.diagramTheme = key;
          if (fit && diagram.querySelector(":scope > svg")) {
            diagram.dataset.width = String(drawn.width);
            diagram.dataset.height = String(drawn.height);
            pre.append(viewButton(diagram));
            track(diagram);
            fitDiagram(diagram);
          }
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
          pre.dataset.diagramTheme = key;
        }
      })
      .finally(() => {
        if (pending.get(pre) === request) pending.delete(pre);
      });
  }
}
