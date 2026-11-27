import { icon } from "./icons.js";
import { t } from "../desktop/i18n.mjs";

// A diagram in a window of its own: fitted at first, then zoomed with the
// wheel or a pinch (25–400 %), panned by dragging; 0 fits it again and Esc
// closes it.
const MIN = 0.25;
const MAX = 4;
const MARGIN = 24;
const clamp = (s) => Math.min(MAX, Math.max(MIN, s));

function barButton(name, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = icon(name);
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

export function openDiagramViewer(diagram) {
  const source = diagram.querySelector(":scope > svg");
  if (!source) return;
  const w = Number(diagram.dataset.width) || source.viewBox.baseVal.width;
  const h = Number(diagram.dataset.height) || source.viewBox.baseVal.height;
  if (!w || !h) return;
  const dialog = document.createElement("dialog");
  dialog.className = "diagram-viewer";
  dialog.setAttribute("aria-label", t("图表"));
  const stage = document.createElement("div");
  stage.className = "diagram diagram-viewer-stage";
  const svg = source.cloneNode(true);
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;
  stage.append(svg);
  const bar = document.createElement("div");
  bar.className = "diagram-viewer-bar";
  const out = barButton("minus", t("缩小"));
  const zoom = document.createElement("button");
  zoom.type = "button";
  zoom.className = "diagram-viewer-zoom";
  zoom.title = t("适合窗口（0）");
  const inn = barButton("plus", t("放大"));
  const close = barButton("close", t("关闭"));
  bar.append(out, zoom, inn, close);
  dialog.append(stage, bar);

  let s = 1,
    x = 0,
    y = 0;
  const apply = () => {
    svg.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    zoom.textContent = `${Math.round(s * 100)}%`;
    zoom.setAttribute(
      "aria-label",
      t("缩放 {pct}，适合窗口", { pct: zoom.textContent }),
    );
  };
  const fit = () => {
    const room = stage.getBoundingClientRect();
    s = clamp(
      Math.min(
        (room.width - 2 * MARGIN) / w,
        (room.height - 2 * MARGIN) / h,
        1,
      ),
    );
    x = (room.width - w * s) / 2;
    y = (room.height - h * s) / 2;
    apply();
  };
  const zoomAt = (factor, cx, cy) => {
    const next = clamp(s * factor);
    x = cx - ((cx - x) * next) / s;
    y = cy - ((cy - y) * next) / s;
    s = next;
    apply();
  };
  const zoomCentre = (factor) => {
    const room = stage.getBoundingClientRect();
    zoomAt(factor, room.width / 2, room.height / 2);
  };

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const room = stage.getBoundingClientRect();
      // A touchpad pinch arrives as a wheel with Ctrl held.
      const step = event.ctrlKey ? 0.01 : 0.0015;
      zoomAt(
        Math.exp(-event.deltaY * step),
        event.clientX - room.left,
        event.clientY - room.top,
      );
    },
    { passive: false },
  );
  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    x += event.clientX - drag.x;
    y += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    apply();
  });
  const drop = (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    stage.classList.remove("dragging");
  };
  stage.addEventListener("pointerup", drop);
  stage.addEventListener("pointercancel", drop);
  out.addEventListener("click", () => zoomCentre(1 / 1.25));
  inn.addEventListener("click", () => zoomCentre(1.25));
  zoom.addEventListener("click", fit);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "0") fit();
    else if (event.key === "+" || event.key === "=") zoomCentre(1.25);
    else if (event.key === "-") zoomCentre(1 / 1.25);
    else return;
    event.preventDefault();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  fit();
}
