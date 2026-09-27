import { icon } from "./icons.js";

// Decorate only sanitized code. Copy the code node, never toolbar text or HTML.
export function decorateCodeBlocks(fragment) {
  for (const pre of fragment.querySelectorAll("pre")) {
    const code = pre.querySelector(":scope > code");
    if (!code) continue;
    const frame = document.createElement("figure");
    frame.className = "code-block";
    const toolbar = document.createElement("figcaption");
    toolbar.className = "code-toolbar";
    const language = document.createElement("span");
    language.textContent = (
      [...code.classList]
        .find((name) => name.startsWith("language-"))
        ?.slice(9) || "text"
    ).slice(0, 40);
    const copy = document.createElement("button");
    copy.className = "code-copy";
    copy.type = "button";
    copy.setAttribute("aria-label", "复制代码");
    copy.title = "复制代码";
    copy.innerHTML = icon("copy") + '<span aria-live="polite">复制</span>';
    toolbar.append(language, copy);
    pre.before(frame);
    frame.append(toolbar, pre);
  }
}

export function wireCodeBlocks(host, report) {
  host.addEventListener("click", async (event) => {
    const button = event.target.closest(".code-copy");
    if (!button || !host.contains(button) || button.disabled) return;
    const code = button.closest(".code-block")?.querySelector("pre > code");
    if (!code) return;
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      if (window.folio?.copyText) await window.folio.copyText(code.textContent);
      else await navigator.clipboard.writeText(code.textContent);
      button.innerHTML =
        icon("check") + '<span aria-live="polite">已复制</span>';
      button.setAttribute("aria-label", "已复制代码");
      setTimeout(() => {
        button.innerHTML =
          icon("copy") + '<span aria-live="polite">复制</span>';
        button.setAttribute("aria-label", "复制代码");
        button.disabled = false;
      }, 1600);
    } catch (error) {
      button.disabled = false;
      report("复制失败：" + error.message);
    }
  });
  host.addEventListener(
    "dblclick",
    (event) => {
      if (event.target.closest(".code-copy")) event.stopImmediatePropagation();
    },
    true,
  );
}
