import { highlightColors, textColors } from "./text-colors.js";
let readSettings = () => ({}),
  writeSettings = () => {},
  dismiss = null;
const key = (action) =>
  action === "highlight" ? "highlightColor" : "textColor";
const valid = (value) => /^#[\da-f]{6}$/i.test(value || "");
const remembered = (action) =>
  valid(readSettings()[key(action)])
    ? readSettings()[key(action)]
    : (action === "highlight" ? highlightColors : textColors)[0][1];

export function configureColorTools(read, write) {
  readSettings = read;
  writeSettings = write;
}
export function closeColorPicker() {
  dismiss?.();
}
export function refreshColorButtons() {
  for (const button of document.querySelectorAll("button[data-color-action]")) {
    const color = remembered(button.dataset.colorAction);
    button.style.setProperty("--selected-color", color);
    button.title = `${button.getAttribute("aria-label")} · ${color} · 左键应用，右键或 ↓ 选色`;
  }
}
export function wireColorButton(button, action, capture) {
  button.dataset.colorAction = action;
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.onmousedown = (event) => event.preventDefault();
  button.onclick = (event) => {
    event.stopPropagation();
    closeColorPicker();
    capture()?.apply({ color: remembered(action) });
  };
  const open = (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeColorPicker();
    const context = capture();
    if (context) openPalette(button, action, context);
  };
  button.oncontextmenu = open;
  button.addEventListener("keydown", (event) => {
    if (
      event.key === "ArrowDown" ||
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    )
      open(event);
  });
  refreshColorButtons();
}
function openPalette(button, action, context) {
  const colors = action === "highlight" ? highlightColors : textColors;
  const panel = document.createElement("div");
  panel.className = "text-color-picker";
  panel.setAttribute("popover", "auto");
  panel.setAttribute("role", "dialog");
  panel.setAttribute(
    "aria-label",
    action === "highlight" ? "高亮调色板" : "文字调色板",
  );
  panel.innerHTML = `<div class="color-swatches">${colors.map(([name, value]) => `<button type="button" data-color="${value}" aria-label="${name}" title="${name}" aria-pressed="${remembered(action) === value}" style="--swatch:${value}"><span></span></button>`).join("")}</div><form class="custom-color"><label>自定义<input type="color" aria-label="自定义颜色" value="${remembered(action)}"></label><button type="submit">应用</button></form><p role="alert" hidden></p><button type="button" data-clear>${action === "highlight" ? "清除高亮" : "恢复默认颜色"}</button>`;
  document.body.append(panel);
  let closed = false;
  function close(focus = false) {
    if (closed) return;
    closed = true;
    if (dismiss === close) dismiss = null;
    window.removeEventListener("resize", position);
    document.removeEventListener("scroll", scrolled, true);
    button.setAttribute("aria-expanded", "false");
    panel.remove();
    if (focus && button.isConnected) button.focus();
  }
  function position() {
    if (!button.isConnected || !button.getClientRects().length) {
      close();
      return;
    }
    const r = button.getBoundingClientRect(),
      height = panel.offsetHeight;
    const below = r.bottom + 6;
    const top =
      below + height <= innerHeight - 8
        ? below
        : Math.max(8, r.top - height - 6);
    panel.style.left =
      Math.max(8, Math.min(r.left, innerWidth - panel.offsetWidth - 8)) + "px";
    panel.style.top = top + "px";
    panel.dataset.side = top >= r.bottom ? "below" : "above";
  }
  function scrolled(event) {
    if (!panel.contains(event.target)) close();
  }
  function choose(color) {
    try {
      context.apply({ color });
      if (color !== null) {
        writeSettings({ [key(action)]: color });
        refreshColorButtons();
      }
      close();
      context.focus();
    } catch (error) {
      const alert = panel.querySelector('[role="alert"]');
      alert.textContent = error.message;
      alert.hidden = false;
      position();
    }
  }
  panel
    .querySelectorAll("[data-color]")
    .forEach((item) => (item.onclick = () => choose(item.dataset.color)));
  panel.querySelector("[data-clear]").onclick = () => choose(null);
  panel.querySelector("form").onsubmit = (event) => {
    event.preventDefault();
    choose(panel.querySelector("input").value);
  };
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  panel.addEventListener("toggle", () => {
    if (!panel.matches(":popover-open")) close();
  });
  dismiss = close;
  button.setAttribute("aria-expanded", "true");
  panel.showPopover();
  position();
  window.addEventListener("resize", position);
  document.addEventListener("scroll", scrolled, true);
  (
    panel.querySelector('[aria-pressed="true"]') ||
    panel.querySelector("button")
  ).focus({ preventScroll: true });
}
