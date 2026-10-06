import { t } from "../desktop/i18n.mjs";
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
    resizeFrame,
    motion = null,
    scrollTarget = null,
    browseFrame = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const svgNS = "http://www.w3.org/2000/svg";
  const curves = document.createElementNS(svgNS, "svg"),
    paths = new Map();
  curves.classList.add("tab-group-lines");
  curves.setAttribute("aria-hidden", "true");
  host.parentElement.append(curves);
  function drawGroups() {
    const viewport = host.getBoundingClientRect(),
      parent = host.parentElement.getBoundingClientRect();
    curves.style.left = viewport.left - parent.left + "px";
    curves.style.top = viewport.top - parent.top + "px";
    curves.style.width = viewport.width + "px";
    curves.style.height = viewport.height + "px";
    curves.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    curves.style.visibility = dragged ? "hidden" : "visible";
    const seen = new Set(),
      ratio = devicePixelRatio || 1;
    const snap = (n) => (Math.round(n * ratio - 0.5) + 0.5) / ratio;
    for (const group of groups()) {
      const header = headers.get(group.id);
      if (!header?.isConnected) continue;
      const members = tabs
        .filter((t) => t.groupId === group.id)
        .map((t) => nodes.get(t.id))
        .filter((n) => n && !n.hidden);
      // The line runs along the tabs' foot, from under the pill to the last
      // tab; a folded group shows only its pill.
      if (!members.length) continue;
      const first = header.getBoundingClientRect(),
        last = members.at(-1).getBoundingClientRect();
      const y = snap(
          members[0].getBoundingClientRect().bottom - viewport.top - 0.5,
        ),
        start = snap(first.left - viewport.left),
        end = snap(last.right - viewport.left);
      const current = members.find((n) => n.dataset.id === active()?.id);
      const currentRect = current?.getBoundingClientRect();
      const outlined = currentRect?.width > 20;
      let d = `M ${start} ${y}`;
      if (outlined) {
        const r = currentRect,
          left = snap(r.left - viewport.left),
          right = snap(r.right - viewport.left),
          top = snap(r.top - viewport.top + 0.5);
        // One continuous path: no CSS border/pseudo-element seams at either foot.
        d += ` H ${left - 3} Q ${left} ${y} ${left} ${y - 3} V ${top + 8} Q ${left} ${top} ${left + 8} ${top} H ${right - 8} Q ${right} ${top} ${right} ${top + 8} V ${y - 3} Q ${right} ${y} ${right + 3} ${y}`;
      }
      d += ` H ${Math.max(end, outlined ? snap(currentRect.right - viewport.left) + 3 : end)}`;
      let path = paths.get(group.id);
      if (!path) {
        path = document.createElementNS(svgNS, "path");
        paths.set(group.id, path);
        curves.append(path);
      }
      path.setAttribute("d", d);
      path.setAttribute("stroke", groupColors[group.color]);
      seen.add(group.id);
    }
    for (const [id, path] of paths)
      if (!seen.has(id)) {
        path.remove();
        paths.delete(id);
      }
  }
  function settleMotion(refresh = true) {
    if (!motion) return;
    const old = motion;
    motion = null;
    cancelAnimationFrame(old.frame);
    for (const animation of old.animations) animation.cancel();
    if (refresh) update();
  }
  function toggleGroup(group) {
    if (motion && motion.groupId !== group.id) settleMotion();
    const closing = !group.collapsed;
    const members = tabs
      .filter((t) => t.groupId === group.id)
      .map((t) => nodes.get(t.id));
    const small = {
      flexBasis: "0px",
      minWidth: "0px",
      maxWidth: "0px",
      opacity: 0,
      marginRight: "-3px",
    };
    const current = members.map((node) => {
      if (node.hidden) return small;
      const width = node.getBoundingClientRect().width + "px";
      const style = getComputedStyle(node);
      return {
        flexBasis: width,
        minWidth: width,
        maxWidth: width,
        opacity: style.opacity,
        marginRight: style.marginRight,
      };
    });
    // Sample rendered geometry before cancelling: reversal has no endpoint jump.
    settleMotion(false);
    group.collapsed = closing;
    if (reducedMotion.matches) {
      changedOrder();
      return;
    }
    const run = { groupId: group.id, animations: [], frame: 0 };
    motion = run;
    update();
    const finalWidths = members.map((n) => n.getBoundingClientRect().width);
    members.forEach((node, i) => {
      const full = {
        flexBasis: finalWidths[i] + "px",
        minWidth: finalWidths[i] + "px",
        maxWidth: finalWidths[i] + "px",
        opacity: 1,
        marginRight: "0px",
      };
      run.animations.push(
        node.animate([current[i], closing ? small : full], {
          duration: 280,
          easing: "cubic-bezier(.22,1,.36,1)",
          fill: "both",
        }),
      );
    });
    const paint = () => {
      if (motion !== run) return;
      overflow();
      run.frame = requestAnimationFrame(paint);
    };
    paint();
    Promise.all(run.animations.map((a) => a.finished))
      .then(() => {
        if (motion === run) settleMotion();
      })
      .catch(() => {});
    changed();
  }
  const changedOrder = () => {
    update();
    changed();
  };
  function reveal(doc) {
    const group = groups().find((g) => g.id === doc?.groupId);
    if (group) {
      if (motion?.groupId === group.id) settleMotion(false);
      group.collapsed = false;
    }
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
            toggleGroup(group);
          };
          header.oncontextmenu = (e) => {
            e.preventDefault();
            context(e, [
              [t("编辑分组…"), () => editGroup(null, group)],
              [
                group.collapsed ? t("展开分组") : t("折叠分组"),
                () => {
                  toggleGroup(group);
                },
              ],
              [
                t("取消分组（保留标签）"),
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
        // Just the name, as wide as it is; a folded group also says how many.
        header.textContent =
          [group.name, group.collapsed ? members.length : ""]
            .filter((part) => part !== "")
            .join(" · ") + (members.some(dirty) ? " ●" : "");
        header.title =
          t("{name} · {count} 篇", {
            name: group.name,
            count: members.length,
          }) + (current ? t(" · 当前：{name}", { name: active().name }) : "");
        header.setAttribute(
          "aria-label",
          t("分组 {name}", { name: group.name }),
        );
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
        // Middle click closes, as in a browser (narrow tabs hide the ×).
        node.onmousedown = (e) => {
          if (e.button === 1) e.preventDefault();
        };
        node.onauxclick = (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          Promise.resolve(close(doc)).catch(report);
        };
        node.oncontextmenu = (e) => {
          e.preventDefault();
          context(e, null, doc);
        };
        nodes.set(doc.id, node);
      }
      node.className =
        "tab" + (active() === doc ? " active" : "") + (group ? " grouped" : "");
      node.hidden = !!group?.collapsed && motion?.groupId !== group.id;
      node.inert = !!group?.collapsed;
      if (group?.collapsed) node.setAttribute("aria-hidden", "true");
      else node.removeAttribute("aria-hidden");
      node.style.setProperty(
        "--group-color",
        group ? groupColors[group.color] : "transparent",
      );
      const label = node.querySelector(".tab-label");
      const text = (dirty(doc) ? "● " : "") + doc.name;
      if (label.textContent !== text) label.textContent = text;
      // A tab shrunk to a circle shows just the name's first character
      // (a dot first when unsaved).
      label.dataset.initial =
        (dirty(doc) ? "●" : "") + (Array.from(doc.name.trim())[0] || "");
      label.title = doc.path || doc.name;
      label.tabIndex = active() === doc ? 0 : -1;
      label.setAttribute("aria-selected", String(active() === doc));
      node
        .querySelector(".tab-close")
        .setAttribute("aria-label", t("关闭 {name}", { name: doc.name }));
      order.push(node);
    }
    order.forEach((node, i) => {
      if (host.children[i] !== node)
        host.insertBefore(node, host.children[i] || null);
    });
    if (visibleId !== active()?.id) {
      stopBrowse();
      visibleId = active()?.id;
      const node = nodes.get(visibleId);
      (node?.hidden ? headers.get(active()?.groupId) : node)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
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
    drawGroups();
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
      [t("新建分组…"), () => editGroup(doc)],
      ...groups()
        .filter((g) => g.id !== doc.groupId)
        .map((g) => [
          t("移入分组 · {name}", { name: g.name }),
          () => assign(doc, g.id),
        ]),
      ...(doc.groupId ? [[t("移出分组"), () => assign(doc, null)]] : []),
    ];
  }
  function editGroup(doc, group) {
    const dialog = document.createElement("dialog");
    dialog.className = "group-dialog";
    dialog.setAttribute("aria-label", group ? t("编辑分组") : t("新建分组"));
    dialog.innerHTML = `<form><h2>${group ? t("编辑分组") : t("新建分组")}</h2><label>${t("名称")}<input name="name" aria-label="${t("分组名称")}" maxlength="40" required></label><label>${t("颜色")}<select name="color" aria-label="${t("分组颜色")}"><option value="green">${t("松绿")}</option><option value="blue">${t("雾蓝")}</option><option value="amber">${t("琥珀")}</option><option value="rose">${t("玫瑰")}</option><option value="violet">${t("紫灰")}</option><option value="gray">${t("中性灰")}</option></select></label><div class="dialog-actions"><button type="button" data-cancel>${t("取消")}</button><button type="submit" class="primary">${t("确定")}</button></div></form>`;
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
      if (drag || motion) return;
      const node = nodes.get(active()?.id);
      (node?.hidden ? headers.get(active()?.groupId) : node)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    });
  }).observe(host);
  host.addEventListener("scroll", overflow, { passive: true });
  function stopBrowse() {
    cancelAnimationFrame(browseFrame);
    browseFrame = 0;
    scrollTarget = null;
  }
  function browse(delta, smooth = true) {
    scrollTarget = Math.max(
      0,
      Math.min(
        host.scrollWidth - host.clientWidth,
        (scrollTarget ?? host.scrollLeft) + delta,
      ),
    );
    if (!smooth || reducedMotion.matches) {
      host.scrollLeft = scrollTarget;
      stopBrowse();
      return;
    }
    if (browseFrame) return;
    let last = performance.now();
    const glide = (now) => {
      const target = Math.min(
        scrollTarget,
        Math.max(0, host.scrollWidth - host.clientWidth),
      );
      const remaining = target - host.scrollLeft;
      if (Math.abs(remaining) < 1 || reducedMotion.matches) {
        host.scrollLeft = target;
        stopBrowse();
        return;
      }
      // Time-based exponential ease-out; repeated input retargets without restarting.
      const step = remaining * (1 - Math.exp(-Math.min(64, now - last) / 65));
      host.scrollLeft += Math.sign(step) * Math.max(1, Math.abs(step));
      last = now;
      browseFrame = requestAnimationFrame(glide);
    };
    browseFrame = requestAnimationFrame(glide);
  }
  for (const [id, direction] of [
    ["tabs-back", -1],
    ["tabs-forward", 1],
  ])
    document.querySelector("#" + id).onclick = () =>
      browse(direction * host.clientWidth * 0.7);
  host.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const delta =
          e.deltaY *
          (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientWidth : 1);
        browse(delta, e.deltaMode !== 0 || Math.abs(e.deltaY) >= 40);
        e.preventDefault();
      } else stopBrowse();
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
    if (motion?.groupId !== node.dataset.groupId) settleMotion();
    stopBrowse();
    host.scrollTo({ left: host.scrollLeft, behavior: "instant" });
    drag = {
      node,
      x: e.clientX,
      current: e.clientX,
      id: e.pointerId,
      left: host.scrollLeft,
    };
    dragged = false;
    // Show the selection on press: the click that activates the tab renders
    // the note first, so a large note would hold the highlight back. A drag,
    // or a release off the tab, puts it back (update() in finish).
    if (node.classList.contains("tab") && !node.classList.contains("active")) {
      for (const n of host.querySelectorAll(".tab.active"))
        n.classList.remove("active");
      node.classList.add("active");
      drag.pressed = true;
    }
  });
  function paint() {
    if (!drag || !dragged) return;
    curves.style.visibility = "hidden";
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
      settleMotion();
      dragged = true;
      if (drag.pressed) update();
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
    setTimeout(() => {
      dragged = false;
      // After the click (if any) has activated the pressed tab.
      if (previous.pressed) update();
      else overflow();
    }, 0);
  }
  window.addEventListener("pointerup", () => finish(true));
  window.addEventListener("pointercancel", () => finish(false));
  window.addEventListener("blur", () => finish(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") finish(false);
  });
  return { update, reveal, actions };
}
