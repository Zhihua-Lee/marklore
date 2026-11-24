// Breadcrumb trail and sibling jump menu rendered identically in Read and
// Edit panes for notes and index views inside a library.
import { t } from "../desktop/i18n.mjs";
import { icon } from "./icons.js";
import "./breadcrumb.css";

export function createBreadcrumb({
  readHost,
  richHost,
  menuHost,
  scrollers = [],
  onOpenFolder = () => {},
  onOpenNote = () => {},
}) {
  let currentData = null;
  let openTrigger = null;
  let pinned = false;
  let closeTimer = 0;

  const isFolderKind = (kind) => kind === "root" || kind === "folder";

  function openSegmentOrSibling(entry) {
    if (!entry) return;
    if (isFolderKind(entry.kind)) onOpenFolder(entry);
    else if (entry.kind === "note") onOpenNote(entry);
  }

  function clearCloseTimer() {
    if (!closeTimer) return;
    clearTimeout(closeTimer);
    closeTimer = 0;
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = 0;
      if (!pinned) closeMenu();
    }, 180);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    clearCloseTimer();
    if (menuHost && !menuHost.hidden) {
      menuHost.hidden = true;
      menuHost.replaceChildren();
    }
    const opener = openTrigger;
    openTrigger = null;
    pinned = false;
    for (const host of [readHost, richHost]) {
      for (const btn of host?.querySelectorAll(
        ".bc-sep-btn[aria-expanded='true']",
      ) || []) {
        btn.setAttribute("aria-expanded", "false");
      }
    }
    if (restoreFocus && opener?.isConnected) opener.focus();
  }

  function menuItems() {
    return [...(menuHost?.querySelectorAll('[role="menuitem"]') || [])];
  }

  function showMenu(trigger, siblings, { pin = false, focus = false } = {}) {
    if (!menuHost) return;
    clearCloseTimer();
    if (openTrigger !== trigger || menuHost.hidden) {
      closeMenu();
      openTrigger = trigger;
      pinned = pin;
      trigger.setAttribute("aria-expanded", "true");

      const hasFolders = siblings.some((s) => isFolderKind(s.kind));
      menuHost.replaceChildren(
        ...siblings.map((sib) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "bc-menu-item";
          item.dataset.kind = sib.kind;
          item.setAttribute("role", "menuitem");
          if (sib.current) item.setAttribute("aria-current", "true");

          if (hasFolders) {
            const kindIcon = document.createElement("span");
            kindIcon.className = "bc-menu-icon";
            kindIcon.setAttribute("aria-hidden", "true");
            if (isFolderKind(sib.kind)) kindIcon.innerHTML = icon("folder");
            item.append(kindIcon);
          }

          const label = document.createElement("span");
          label.className = "bc-menu-label";
          label.textContent = sib.name;

          const mark = document.createElement("span");
          mark.className = "bc-menu-mark";
          mark.setAttribute("aria-hidden", "true");
          mark.textContent = sib.current ? "✓" : "";

          item.append(label, mark);
          item.title = sib.name;
          item.onclick = () => {
            closeMenu();
            if (!sib.current) openSegmentOrSibling(sib);
          };
          return item;
        }),
      );

      menuHost.hidden = false;
      menuHost.style.left = "0px";
      menuHost.style.top = "0px";
      const anchor = trigger.getBoundingClientRect();
      const box = menuHost.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(anchor.left, window.innerWidth - box.width - 8),
      );
      const fitsBelow =
        anchor.bottom + 4 + box.height <= window.innerHeight - 8;
      const top = fitsBelow
        ? anchor.bottom + 4
        : Math.max(8, anchor.top - 4 - box.height);
      menuHost.style.left = `${left}px`;
      menuHost.style.top = `${top}px`;
    } else if (pin) {
      pinned = true;
    }

    if (focus) menuItems()[0]?.focus();
  }

  function renderInto(host, data) {
    if (!host) return;
    if (!data?.segments?.length) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const fragment = document.createDocumentFragment();
    data.segments.forEach((seg, index) => {
      const item = document.createElement("span");
      item.className = "bc-item";
      item.dataset.kind = seg.kind;

      let labelEl;
      if (seg.clickable) {
        labelEl = document.createElement("button");
        labelEl.type = "button";
        labelEl.className = "bc-link";
        labelEl.onclick = () => {
          closeMenu();
          openSegmentOrSibling(seg);
        };
      } else {
        labelEl = document.createElement("span");
        labelEl.className = "bc-current";
        labelEl.tabIndex = 0;
        if (seg.current) labelEl.setAttribute("aria-current", "page");
      }
      labelEl.textContent = seg.name;
      labelEl.title = seg.name;
      item.append(labelEl);
      fragment.append(item);

      const siblings = Array.isArray(seg.siblings) ? seg.siblings : [];
      const hasSiblings = siblings.some((s) => !s.current);
      if (hasSiblings) {
        const sep = document.createElement("button");
        sep.type = "button";
        sep.className = "bc-sep bc-sep-btn";
        sep.textContent = "›";
        sep.setAttribute("aria-haspopup", "menu");
        sep.setAttribute("aria-expanded", "false");
        sep.setAttribute(
          "aria-label",
          t("{name} 的同级条目", { name: seg.name }),
        );
        sep.title = t("切换同级条目");
        sep.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "touch") return;
          clearCloseTimer();
          if (openTrigger === sep && !menuHost?.hidden) return;
          showMenu(sep, siblings, { pin: false, focus: false });
        });
        sep.addEventListener("pointerleave", () => {
          if (!pinned && openTrigger === sep) scheduleClose();
        });
        sep.addEventListener("click", (event) => {
          event.stopPropagation();
          clearCloseTimer();
          const fromKey = event.detail === 0;
          if (openTrigger === sep && !menuHost?.hidden) {
            if (!pinned) showMenu(sep, siblings, { pin: true, focus: fromKey });
            else closeMenu();
            return;
          }
          showMenu(sep, siblings, { pin: true, focus: fromKey });
        });
        sep.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          showMenu(sep, siblings, { pin: true, focus: true });
        });
        fragment.append(sep);
      } else if (index < data.segments.length - 1) {
        const sep = document.createElement("span");
        sep.className = "bc-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "›";
        fragment.append(sep);
      }
    });
    host.replaceChildren(fragment);
    host.hidden = false;
  }

  function render(data) {
    closeMenu();
    currentData = data?.segments?.length ? data : null;
    renderInto(readHost, currentData);
    renderInto(richHost, currentData);
  }

  function clear() {
    render(null);
  }

  menuHost?.addEventListener("pointerenter", () => clearCloseTimer());
  menuHost?.addEventListener("pointerleave", () => {
    if (!pinned && openTrigger) scheduleClose();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!menuHost || menuHost.hidden) return;
    if (menuHost.contains(event.target) || openTrigger?.contains(event.target))
      return;
    closeMenu();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!menuHost || menuHost.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ restoreFocus: true });
        return;
      }
      const items = menuItems();
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(at + 1) % items.length].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(at <= 0 ? items.length : at) - 1].focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0].focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items.at(-1).focus();
      }
    },
    true,
  );

  for (const scroller of scrollers) {
    scroller?.addEventListener("scroll", () => closeMenu(), { passive: true });
  }
  window.addEventListener("resize", () => closeMenu());

  return {
    render,
    clear,
    closeMenu,
    current: () => currentData,
  };
}
