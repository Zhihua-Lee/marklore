import { t } from "../desktop/i18n.mjs";
// Each group colour is a set of theme variables (tab-bar.css): the hue for
// the line along the group's tabs, and a soft fill with a deep ink of the
// same hue for its pill. A theme switch needs no redraw.
export const groupColors = {
  green: "var(--group-green)",
  blue: "var(--group-blue)",
  amber: "var(--group-amber)",
  rose: "var(--group-rose)",
  violet: "var(--group-violet)",
  gray: "var(--group-gray)",
};
export const groupFill = (color) => `var(--group-${color}-fill)`;
export const groupInk = (color) => `var(--group-${color}-ink)`;

// Only newly created tabs inherit placement; callers deduplicate before this.
export function insertDerivedTab(tabs, groups, doc, opener) {
  const group = groups.find((g) => g.id === opener?.groupId);
  doc.groupId = group?.id || null;
  const parent = tabs.findIndex((t) => t.id === opener?.id);
  const index = group
    ? parent >= 0 && tabs[parent].groupId === group.id
      ? parent + 1
      : tabs.findLastIndex((t) => t.groupId === group.id) + 1
    : -1;
  tabs.splice(index > 0 ? index : tabs.length, 0, doc);
}

export function normalizeGroups(tabs, groups) {
  const seen = new Set();
  groups.splice(
    0,
    groups.length,
    ...groups
      .filter((g) => {
        if (
          !g ||
          typeof g.id !== "string" ||
          seen.has(g.id) ||
          typeof g.name !== "string"
        )
          return false;
        seen.add(g.id);
        g.name = g.name.trim().slice(0, 40) || t("分组");
        g.color = Object.hasOwn(groupColors, g.color) ? g.color : "green";
        g.collapsed = g.collapsed === true;
        return tabs.some((t) => t.groupId === g.id);
      })
      .slice(0, 100),
  );
  for (const tab of tabs)
    if (!groups.some((g) => g.id === tab.groupId)) tab.groupId = null;
  const order = [],
    placed = new Set();
  for (const tab of tabs) {
    if (!tab.groupId) order.push(tab);
    else if (!placed.has(tab.groupId)) {
      placed.add(tab.groupId);
      order.push(...tabs.filter((t) => t.groupId === tab.groupId));
    }
  }
  tabs.splice(0, tabs.length, ...order);
}

export function moveGroupedTab(tabs, id, beforeId, groupId = null) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index < 0 || id === beforeId) return;
  const [tab] = tabs.splice(index, 1);
  tab.groupId = groupId;
  let target = tabs.findIndex((t) => t.id === beforeId);
  if (groupId && (target < 0 || tabs[target].groupId !== groupId)) {
    const last = tabs.findLastIndex((t) => t.groupId === groupId);
    target = last < 0 ? tabs.length : last + 1;
  }
  tabs.splice(target < 0 ? tabs.length : target, 0, tab);
}

// Where a dragged tab lands. `items` are the strip's other shown tabs and
// pills in order ({ id, groupId, header, collapsed, first, left, right }; a
// pill's `first` is its group's first tab), `x` the pointer and `own` the
// dragged tab's group. Over a pill the tab goes to the end of that group;
// between two tabs of a group, or over one of them, into the group at that
// place. In a gap at a group's edge, or over its own old place, it keeps the
// group it had: a tab moved a little does not fall out of its group.
export function dropTarget(items, x, own = null) {
  const hovered = items.find((i) => x >= i.left && x <= i.right);
  const at = items.findIndex((i) => x < (i.left + i.right) / 2);
  const next = at < 0 ? undefined : items[at],
    prev = at < 0 ? items.at(-1) : items[at - 1];
  if (hovered?.header)
    return { beforeId: undefined, into: hovered.groupId, next: undefined };
  const beforeId = next?.header ? next.first : next?.id;
  const prevGroup =
      prev && !(prev.header && prev.collapsed) ? prev.groupId : null,
    nextGroup = next && !next.header ? next.groupId : null;
  let into = null;
  if (prevGroup && prevGroup === nextGroup) into = prevGroup;
  else if (hovered) into = hovered.groupId || null;
  else if (own && (own === prevGroup || own === nextGroup)) into = own;
  return { beforeId, into, next };
}

export function moveGroup(tabs, groupId, beforeId) {
  const members = tabs.filter((t) => t.groupId === groupId);
  if (!members.length || members.some((t) => t.id === beforeId)) return;
  const rest = tabs.filter((t) => t.groupId !== groupId);
  let target = rest.findIndex((t) => t.id === beforeId);
  if (target >= 0 && rest[target].groupId)
    target = rest.findIndex((t) => t.groupId === rest[target].groupId);
  rest.splice(target < 0 ? rest.length : target, 0, ...members);
  tabs.splice(0, tabs.length, ...rest);
}
