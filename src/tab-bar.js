import { icon } from "./icons.js";
import {
  groupColors,
  normalizeGroups,
  moveGroupedTab,
  moveGroup,
} from "./tab-groups.js";
import "./tab-bar.css";

export function createTabBar({
  tabs,
  groups,
  active,
  activate,
  close,
  dirty,
  context,
  changed,
  report,
}) {
  const host = document.querySelector("#tabs"),
    nodes = new Map(),
    headers = new Map();
  let visibleId,
    drag = null,
    dragged = false,
    frame,
    resizeFrame;
  const changedOrder = () => {
    update();
    changed();
  };
  function reveal(doc) {
    const group = groups().find((g) => g.id === doc?.groupId);
    if (group) group.collapsed = false;
  }
  function update() {
    normalizeGroups(tabs, groups());
    for (const [id, node] of nodes)
      if (!tabs.some((t) => t.id === id)) {
        node.remove();
        nodes.delete(id);
      }
    for (const [id, node] of headers)
      if (!groups().some((g) => g.id === id)) {
        node.remove();
        headers.delete(id);
      }
    const order = [],
      placed = new Set();
    for (const doc of tabs) {
      const group = groups().find((g) => g.id === doc.groupId);
      if (group && !placed.has(group.id)) {
        placed.add(group.id);
        let header = headers.get(group.id);
        if (!header) {
          header = document.createElement("button");
          header.className = "tab-group";
          header.dataset.groupId = group.id;
          header.onclick = () => {
            if (dragged) return;
            group.collapsed = !group.collapsed;
            changedOrder();
          };
          header.oncontextmenu = (e) => {
            e.preventDefault();
            context(e, [
              ["编辑分组…", () => editGroup(null, group)],
              [
                group.collapsed ? "展开分组" : "折叠分组",
                () => {
                  group.collapsed = !group.collapsed;
                  changedOrder();
                },
              ],
              [
                "取消分组（保留标签）",
                () => {
                  for (const t of tabs)
                    if (t.groupId === group.id) t.groupId = null;
                  changedOrder();
                },
              ],
            ]);
          };
          headers.set(group.id, header);
        }
        const members = tabs.filter((t) => t.groupId === group.id),
          current = members.includes(active());
        header.textContent = `${group.collapsed ? "▸" : "▾"} ${group.name} ${members.length}${members.some(dirty) ? " ●" : ""}`;
        header.title = `${group.name} · ${members.length} 篇${current ? " · 当前：" + active().name : ""}`;
        header.setAttribute("aria-label", "分组 " + group.name);
        header.setAttribute("aria-expanded", String(!group.collapsed));
        header.classList.toggle("contains-active", current);
        header.style.setProperty("--group-color", groupColors[group.color]);
        order.push(header);
      }
      let node = nodes.get(doc.id);
      if (!node) {
        node = document.createElement("div");
        node.dataset.id = doc.id;
        const label = document.createElement("button");
        label.className = "tab-label";
        label.setAttribute("role", "tab");
        label.onclick = () => {
          if (!dragged) activate(doc);
        };
        const x = document.createElement("button");
        x.className = "tab-close";
        x.innerHTML = icon("close");
        x.onclick = () => Promise.resolve(close(doc)).catch(report);
        node.append(label, x);
        node.oncontextmenu = (e) => {
          e.preventDefault();
          context(e, null, doc);
        };
        nodes.set(doc.id, node);
      }
      node.className =
        "tab" + (active() === doc ? " active" : "") + (group ? " grouped" : "");
      node.hidden = !!group?.collapsed;
      node.style.setProperty(
        "--group-color",
        group ? groupColors[group.color] : "transparent",
      );
      const label = node.querySelector(".tab-label");
      const text = (dirty(doc) ? "● " : "") + doc.name;
      if (label.textContent !== text) label.textContent = text;
      label.title = doc.path || doc.name;
      label.tabIndex = active() === doc ? 0 : -1;
      label.setAttribute("aria-selected", String(active() === doc));
      node
        .querySelector(".tab-close")
        .setAttribute("aria-label", "关闭 " + doc.name);
      order.push(node);
    }
    order.forEach((node, i) => {
      if (host.children[i] !== node)
        host.insertBefore(node, host.children[i] || null);
    });
    if (visibleId !== active()?.id) {
      visibleId = active()?.id;
      const node = nodes.get(visibleId);
      (node?.hidden ? headers.get(active()?.groupId) : node)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
    overflow();
  }
  function overflow() {
    document.querySelector(".topbar").dataset.overflow = String(
      host.scrollWidth > host.clientWidth + 1,
    );
    document.querySelector("#tabs-back").disabled = host.scrollLeft < 1;
    document.querySelector("#tabs-forward").disabled =
      host.scrollLeft >= host.scrollWidth - host.clientWidth - 1;
    const viewport = host.getBoundingClientRect();
    for (const tab of nodes.values()) {
      if (tab.hidden) continue;
      const label = tab.querySelector(".tab-label").getBoundingClientRect(),
        x = tab.querySelector(".tab-close").getBoundingClientRect();
      tab.classList.toggle(
        "edge-clipped",
        Math.min(label.right, viewport.right) -
          Math.max(label.left, viewport.left) <
          28 ||
          x.left < viewport.left ||
          x.right > viewport.right,
      );
    }
  }
  function assign(doc, groupId) {
    if (doc.groupId === groupId) return;
    const oldGroup = doc.groupId;
    const after = oldGroup
      ? tabs[tabs.findLastIndex((t) => t.groupId === oldGroup) + 1]?.id
      : undefined;
    moveGroupedTab(tabs, doc.id, groupId ? undefined : after, groupId);
    reveal(doc);
    changedOrder();
  }
  function actions(doc) {
    return [
      ["新建分组…", () => editGroup(doc)],
      ...groups()
        .filter((g) => g.id !== doc.groupId)
        .map((g) => ["移入分组 · " + g.name, () => assign(doc, g.id)]),
      ...(doc.groupId ? [["移出分组", () => assign(doc, null)]] : []),
    ];
  }
  function editGroup(doc, group) {
    const dialog = document.createElement("dialog");
    dialog.className = "group-dialog";
    dialog.setAttribute("aria-label", group ? "编辑分组" : "新建分组");
    dialog.innerHTML = `<form><h2>${group ? "编辑分组" : "新建分组"}</h2><label>名称<input name="name" aria-label="分组名称" maxlength="40" required></label><label>颜色<select name="color" aria-label="分组颜色"><option value="green">松绿</option><option value="blue">雾蓝</option><option value="amber">琥珀</option><option value="rose">玫瑰</option><option value="violet">紫灰</option><option value="gray">中性灰</option></select></label><div class="dialog-actions"><button type="button" data-cancel>取消</button><button type="submit" class="primary">确定</button></div></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form");
    form.elements.name.value = group?.name || "";
    form.elements.color.value = group?.color || "green";
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) {
        form.elements.name.focus();
        return;
      }
      if (group)
        Object.assign(group, { name, color: form.elements.color.value });
      else {
        group = {
          id: crypto.randomUUID(),
          name,
          color: form.elements.color.value,
          collapsed: false,
        };
        groups().push(group);
        doc.groupId = group.id;
      }
      changedOrder();
      dialog.close();
      headers.get(group.id)?.focus();
    };
    dialog.showModal();
    form.elements.name.focus();
  }
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      overflow();
      if (drag) return;
      const node = nodes.get(active()?.id);
      (node?.hidden ? headers.get(active()?.groupId) : node)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    });
  }).observe(host);
  host.addEventListener("scroll", overflow, { passive: true });
  for (const [id, direction] of [
    ["tabs-back", -1],
    ["tabs-forward", 1],
  ])
    document.querySelector("#" + id).onclick = () =>
      host.scrollBy({ left: direction * host.clientWidth * 0.7 });
  host.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        host.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );
  host.addEventListener("keydown", (e) => {
    if (e.altKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
      return;
    const header = e.target.closest(".tab-group");
    if (
      header &&
      e.ctrlKey &&
      e.shiftKey &&
      ["ArrowLeft", "ArrowRight"].includes(e.key)
    ) {
      e.preventDefault();
      const units = [...host.children].filter(
        (n) =>
          n.matches(".tab-group") ||
          (n.matches(".tab") &&
            !tabs.find((t) => t.id === n.dataset.id)?.groupId),
      );
      const at = units.indexOf(header),
        target = units[at + (e.key === "ArrowLeft" ? -1 : 2)];
      if (at === 0 && e.key === "ArrowLeft") return;
      moveGroup(
        tabs,
        header.dataset.groupId,
        target?.dataset.id ||
          tabs.find((t) => t.groupId === target?.dataset.groupId)?.id,
      );
      changedOrder();
      header.focus();
      return;
    }
    if (!e.target.matches(".tab-label")) return;
    e.preventDefault();
    const doc = tabs.find((t) => t.id === e.target.parentElement.dataset.id),
      index = tabs.indexOf(doc);
    if (
      e.ctrlKey &&
      e.shiftKey &&
      ["ArrowLeft", "ArrowRight"].includes(e.key)
    ) {
      const targetIndex = Math.max(
        0,
        Math.min(tabs.length - 1, index + (e.key === "ArrowLeft" ? -1 : 1)),
      );
      if (targetIndex === index) return;
      const target = tabs[targetIndex];
      const beforeId =
        e.key === "ArrowLeft" ? target.id : tabs[targetIndex + 1]?.id;
      moveGroupedTab(tabs, doc.id, beforeId, target.groupId || null);
      reveal(doc);
      changedOrder();
      nodes.get(doc.id)?.querySelector(".tab-label").focus();
      return;
    }
    const visible = tabs.filter((t) => !nodes.get(t.id)?.hidden),
      at = visible.indexOf(doc);
    const next = {
      ArrowLeft: visible[(at - 1 + visible.length) % visible.length],
      ArrowRight: visible[(at + 1) % visible.length],
      Home: visible[0],
      End: visible.at(-1),
    }[e.key];
    if (next) {
      activate(next);
      nodes.get(next.id)?.querySelector(".tab-label").focus();
    }
  });
  host.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".tab-close")) return;
    const node = e.target.closest(".tab,.tab-group");
    if (!node) return;
    drag = {
      node,
      x: e.clientX,
      current: e.clientX,
      id: e.pointerId,
      left: host.scrollLeft,
    };
    dragged = false;
  });
  function paint() {
    if (!drag || !dragged) return;
    const box = host.getBoundingClientRect();
    if (drag.current < box.left + 24) host.scrollLeft -= 8;
    else if (drag.current > box.right - 24) host.scrollLeft += 8;
    drag.node.style.transform = `translateX(${drag.current - drag.x + host.scrollLeft - drag.left}px)`;
    const groupId = drag.node.dataset.groupId;
    const others = [...host.children].filter(
      (n) =>
        !n.hidden &&
        n !== drag.node &&
        (!groupId ||
          tabs.find((t) => t.id === n.dataset.id)?.groupId !== groupId),
    );
    const hovered = others.find((n) => {
      const r = n.getBoundingClientRect();
      return drag.current >= r.left && drag.current <= r.right;
    });
    const before = others.find((n) => {
      const r = n.getBoundingClientRect();
      return drag.current < r.left + r.width / 2;
    });
    drag.beforeId =
      before?.dataset.id ||
      tabs.find((t) => t.groupId === before?.dataset.groupId)?.id;
    drag.into = !groupId
      ? hovered?.dataset.groupId ||
        tabs.find((t) => t.id === hovered?.dataset.id)?.groupId ||
        null
      : null;
    // Dropping on the group name appends; dropping on a member chooses its position.
    if (!groupId && hovered?.dataset.groupId) drag.beforeId = undefined;
    for (const n of host.children)
      n.classList.remove("drop-before", "drop-after", "drop-into");
    if (drag.into) headers.get(drag.into)?.classList.add("drop-into");
    else if (before) before.classList.add("drop-before");
    else others.at(-1)?.classList.add("drop-after");
    frame = requestAnimationFrame(paint);
  }
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.current = e.clientX;
    if (!dragged && Math.abs(drag.current - drag.x) > 5) {
      dragged = true;
      host.setPointerCapture(e.pointerId);
      host.classList.add("dragging");
      drag.node.classList.add("reordering");
      paint();
    }
    if (dragged) e.preventDefault();
  });
  function finish(commit) {
    if (!drag) return;
    cancelAnimationFrame(frame);
    const previous = drag;
    drag = null;
    previous.node.style.transform = "";
    for (const n of host.children)
      n.classList.remove(
        "reordering",
        "drop-before",
        "drop-after",
        "drop-into",
      );
    host.classList.remove("dragging");
    if (host.hasPointerCapture(previous.id))
      host.releasePointerCapture(previous.id);
    if (commit && dragged) {
      if (previous.node.dataset.groupId)
        moveGroup(tabs, previous.node.dataset.groupId, previous.beforeId);
      else
        moveGroupedTab(
          tabs,
          previous.node.dataset.id,
          previous.beforeId,
          previous.into,
        );
      changedOrder();
    }
    setTimeout(() => (dragged = false), 0);
  }
  window.addEventListener("pointerup", () => finish(true));
  window.addEventListener("pointercancel", () => finish(false));
  window.addEventListener("blur", () => finish(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") finish(false);
  });
  return { update, reveal, actions };
}
