import { highlightColors, textColors } from "./text-colors.js";
// One small modal shared by source and local editors; caller retains the selection.
export function openColorPicker(action, apply, onClose) {
  const highlight = action === "highlight",
    colors = highlight ? highlightColors : textColors;
  const dialog = document.createElement("dialog");
  dialog.className = "text-color-picker";
  dialog.setAttribute("aria-label", highlight ? "文字高亮" : "文字颜色");
  dialog.innerHTML = `<form><header><h2>${highlight ? "文字高亮" : "文字颜色"}</h2><button type="button" data-cancel aria-label="关闭颜色选择">×</button></header><div class="color-swatches">${colors.map(([name, value]) => `<button type="button" data-color="${value}" aria-label="${name}" title="${name}" style="--swatch:${value}"><span></span></button>`).join("")}</div><label class="custom-color">自定义<input type="color" aria-label="自定义颜色" value="${colors[0][1]}"><button type="submit">应用</button></label><p role="alert" hidden></p><button type="button" data-clear>${highlight ? "清除高亮" : "恢复默认颜色"}</button></form>`;
  document.body.append(dialog);
  const choose = (color) => {
    try {
      apply({ color });
      dialog.close();
    } catch (error) {
      const alert = dialog.querySelector('[role="alert"]');
      alert.textContent = error.message;
      alert.hidden = false;
    }
  };
  dialog
    .querySelectorAll("[data-color]")
    .forEach((button) => (button.onclick = () => choose(button.dataset.color)));
  dialog.querySelector("[data-clear]").onclick = () => choose(null);
  dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
  dialog.querySelector("form").onsubmit = (event) => {
    event.preventDefault();
    choose(dialog.querySelector("input").value);
  };
  dialog.onclose = () => {
    dialog.remove();
    onClose();
  };
  dialog.showModal();
}
