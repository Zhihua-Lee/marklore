// Breadcrumb trail and sibling jump menu rendered identically in Read and
// Edit panes for notes and index views inside a library.
import { t } from "../desktop/i18n.mjs";
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
  let openChevron = null;

  const isFolderKind = (kind) => kind === "root" || kind === "folder";

  function openSegmentOrSibling(entry) {
    if (!entry) return;
    if (isFolderKind(entry.kind)) onOpenFolder(entry);
    else if (entry.kind === "note") onOpenNote(entry);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (menuHost && !menuHost.hidden) {
      menuHost.hidden = true;
      menuHost.replaceChildren();
    }
    const opener = openChevron;
    openChevron = null;
    for (const host of [readHost, richHost]) {
      for (const btn of host?.querySelectorAll(
        ".bc-chevron[aria-expanded='true']",
      ) || []) {
        btn.setAttribute("aria-expanded", "false");
      }
    }
    if (restoreFocus && opener?.isConnected) opener.focus();
  }

  function menuItems() {
    return [...(menuHost?.querySelectorAll('[role="menuitem"]') || [])];
  }

  function showMenu(chevron, siblings) {
    if (!menuHost) return;
    if (openChevron === chevron && !menuHost.hidden) {
      closeMenu();
      return;
    }
    closeMenu();
    openChevron = chevron;
    chevron.setAttribute("aria-expanded", "true");

    menuHost.replaceChildren(
      ...siblings.map((sib) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "bc-menu-item";
        item.setAttribute("role", "menuitem");
        if (sib.current) item.setAttribute("aria-current", "true");

        const label = document.createElement("span");
        label.className = "bc-menu-label";
        label.textContent = sib.name;
        if (isFolderKind(sib.kind)) {
          const slash = document.createElement("span");
          slash.className = "bc-menu-kind";
          slash.textContent = "/";
          label.append(slash);
        }

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
    const anchor = chevron.getBoundingClientRect();
    const box = menuHost.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(anchor.left, window.innerWidth - box.width - 8),
    );
    const fitsBelow = anchor.bottom + 4 + box.height <= window.innerHeight - 8;
    const top = fitsBelow
      ? anchor.bottom + 4
      : Math.max(8, anchor.top - 4 - box.height);
    menuHost.style.left = `${left}px`;
    menuHost.style.top = `${top}px`;
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
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "bc-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "›";
        fragment.append(sep);
      }
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
        if (seg.current) labelEl.setAttribute("aria-current", "page");
      }
      labelEl.textContent = seg.name;
      labelEl.title = seg.name;
      item.append(labelEl);

      const siblings = Array.isArray(seg.siblings) ? seg.siblings : [];
      if (siblings.some((s) => !s.current)) {
        const chevron = document.createElement("button");
        chevron.type = "button";
        chevron.className = "bc-chevron";
        chevron.setAttribute("aria-haspopup", "menu");
        chevron.setAttribute("aria-expanded", "false");
        chevron.setAttribute(
          "aria-label",
          t("{name} 的同级条目", { name: seg.name }),
        );
        chevron.title = t("切换同级条目");
        chevron.onclick = (event) => {
          event.stopPropagation();
          showMenu(chevron, siblings);
        };
        item.append(chevron);
      }

      fragment.append(item);
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

  document.addEventListener("pointerdown", (event) => {
    if (!menuHost || menuHost.hidden) return;
    if (menuHost.contains(event.target) || openChevron?.contains(event.target))
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
