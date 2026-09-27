// Context menu and the export (app) menu share keyboard navigation and dismissal.
export function createMenus({ run, appMenuEntries }) {
  const $ = (s) => document.querySelector(s);
  function showContext(e, actions) {
    const menu = $("#context");
    menu.replaceChildren();
    for (const [name, fn, disabled] of actions) {
      const b = document.createElement("button");
      b.textContent = name;
      b.setAttribute("role", "menuitem");
      b.disabled = !!disabled;
      b.onclick = run(() => {
        menu.hidden = true;
        return fn();
      });
      menu.append(b);
    }
    menu.hidden = false;
    menu.style.left =
      Math.max(8, Math.min(e.clientX, innerWidth - menu.offsetWidth - 8)) +
      "px";
    menu.style.top =
      Math.max(8, Math.min(e.clientY, innerHeight - menu.offsetHeight - 8)) +
      "px";
    menu.querySelector("button:not(:disabled)")?.focus();
  }
  function closeAppMenu({ focus = false } = {}) {
    $("#app-menu").hidden = true;
    $("#app-menu-toggle").setAttribute("aria-expanded", "false");
    if (focus) $("#app-menu-toggle").focus();
  }
  // Escape closes both menus; focus returns to the toggle only for the app menu.
  function dismiss() {
    $("#context").hidden = true;
    if (!$("#app-menu").hidden) closeAppMenu({ focus: true });
  }
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#context")) $("#context").hidden = true;
    if (!e.target.closest("#app-menu, #app-menu-toggle")) closeAppMenu();
  });
  $("#app-menu-toggle").onclick = () => {
    const menu = $("#app-menu");
    if (!menu.hidden) return closeAppMenu();
    menu.replaceChildren();
    for (const [label, shortcut, action, disabled] of appMenuEntries()) {
      const button = document.createElement("button"),
        key = document.createElement("kbd");
      button.textContent = label;
      button.setAttribute("role", "menuitem");
      button.disabled = !!disabled;
      key.textContent = shortcut;
      button.append(key);
      button.onclick = run(() => {
        closeAppMenu();
        return action();
      });
      menu.append(button);
    }
    menu.hidden = false;
    $("#app-menu-toggle").setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus();
  };
  for (const menu of [$("#app-menu"), $("#context")])
    menu.addEventListener("keydown", (event) => {
      const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement);
      const next = {
        ArrowDown: (index + 1) % buttons.length,
        ArrowUp: (index - 1 + buttons.length) % buttons.length,
        Home: 0,
        End: buttons.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      buttons[next]?.focus();
    });
  return { showContext, dismiss };
}
