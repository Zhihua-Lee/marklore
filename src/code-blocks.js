import { icon } from "./icons.js";

function action(document, className, text, label) {
  const button = document.createElement("button");
  button.className = `code-action ${className}`;
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}
// Decorate only sanitized code. Copy the code node, never toolbar text or HTML.
export function decorateCodeBlocks(fragment) {
  for (const pre of fragment.querySelectorAll("pre")) {
    const code = pre.querySelector(":scope > code");
    if (!code || pre.parentElement?.classList.contains("code-block")) continue;
    const document = pre.ownerDocument;
    const frame = document.createElement("figure");
    frame.className = "code-block";
    const toolbar = document.createElement("figcaption");
    toolbar.className = "code-toolbar";
    const language = document.createElement("span");
    const name = [...code.classList].find((value) => value.startsWith("language-"))?.slice(9) || "text";
    language.textContent = name.slice(0, 40);
    const actions = document.createElement("span");
    actions.className = "code-actions";
    if (name.toLowerCase() !== "mermaid") {
      frame.classList.add("code-wrap");
      const wrap = action(document, "code-wrap-toggle", "换行", "自动换行");
      wrap.setAttribute("aria-pressed", "true");
      actions.append(wrap);
      const source = code.textContent;
      const lines = source.replace(/\r?\n$/, "").split("\n").length;
      if (lines > 30 || source.length > 4000) {
        frame.classList.add("code-collapsed");
        const fold = action(document, "code-fold", `展开 · ${lines} 行`, "展开完整代码");
        fold.dataset.lines = String(lines);
        fold.setAttribute("aria-expanded", "false");
        actions.append(fold);
      }
    }
    const copy = action(document, "code-copy", "", "复制代码");
    copy.innerHTML = icon("copy") + '<span aria-live="polite">复制</span>';
    actions.append(copy);
    toolbar.append(language, actions);
    pre.before(frame);
    frame.append(toolbar, pre);
  }
}

export function setCodeCollapsed(frame, collapsed) {
  frame.classList.toggle("code-collapsed", collapsed);
  const button = frame.querySelector(".code-fold");
  if (!button) return;
  button.setAttribute("aria-expanded", String(!collapsed));
  button.textContent = collapsed ? `展开 · ${button.dataset.lines} 行` : "收起";
  button.setAttribute("aria-label", collapsed ? "展开完整代码" : "收起长代码");
  button.title = button.getAttribute("aria-label");
}

export function wireCodeBlocks(host, report) {
  host.addEventListener("click", async (event) => {
    const button = event.target.closest?.(".code-action,.code-copy");
    if (!button || !host.contains(button) || button.disabled) return;
    const frame = button.closest(".code-block");
    const code = frame?.querySelector("pre > code");
    if (!code) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.classList.contains("code-wrap-toggle")) {
      button.setAttribute("aria-pressed", String(frame.classList.toggle("code-wrap")));
      return;
    }
    if (button.classList.contains("code-fold")) {
      setCodeCollapsed(frame, !frame.classList.contains("code-collapsed"));
      return;
    }
    button.disabled = true;
    try {
      if (window.folio?.copyText) await window.folio.copyText(code.textContent);
      else await navigator.clipboard.writeText(code.textContent);
      button.innerHTML = icon("check") + '<span aria-live="polite">已复制</span>';
      button.setAttribute("aria-label", "已复制代码");
      setTimeout(() => {
        button.innerHTML = icon("copy") + '<span aria-live="polite">复制</span>';
        button.setAttribute("aria-label", "复制代码");
        button.disabled = false;
      }, 1600);
    } catch (error) {
      button.disabled = false;
      report("复制失败：" + error.message);
    }
  });
  host.addEventListener("dblclick", (event) => {
    if (event.target.closest?.(".code-action,.code-copy")) event.stopImmediatePropagation();
  }, true);
}
