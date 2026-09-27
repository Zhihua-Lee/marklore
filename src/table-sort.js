const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const states = new WeakMap(),
  wired = new WeakSet();

export function numericCell(value) {
  let text = String(value)
    .trim()
    .replace(/\u2212/g, "-");
  if (!text) return null;
  const accounting = /^\(.*\)$/.test(text);
  if (accounting) {
    text = text.slice(1, -1).trim();
    if (/^[+-]/.test(text)) return null;
  }
  text = text.replace(/^([+-]?)[$€£¥]\s*/, "$1").replace(/\s*[$€£¥]$/, "");
  if (
    !/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(
      text,
    )
  )
    return null;
  const percent = text.endsWith("%");
  const number =
    (Number(text.replace(/[,%]/g, "")) * (accounting ? -1 : 1)) /
    (percent ? 100 : 1);
  return Number.isFinite(number) ? number : null;
}

export function sortedIndices(values, direction = "ascending") {
  const indices = values.map((_, index) => index);
  if (direction === "none") return indices;
  const text = values.map((value) => String(value).trim());
  const numbers = text.map(numericCell);
  const numeric = text.every((value, i) => !value || numbers[i] !== null);
  const sign = direction === "descending" ? -1 : 1;
  return indices.sort((a, b) => {
    // Missing values remain at the bottom in either direction.
    if (!text[a] || !text[b])
      return Number(!text[a]) - Number(!text[b]) || a - b;
    const order = numeric
      ? numbers[a] - numbers[b]
      : collator.compare(text[a], text[b]);
    return sign * order || a - b;
  });
}

function cellText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return "";
  if (node.classList.contains("table-sort")) return "";
  // Do not compare both the visual KaTeX text and its MathML accessibility copy.
  if (node.classList.contains("katex"))
    return (
      node.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent || node.textContent
    );
  return [...node.childNodes].map(cellText).join("");
}
function sortable(table) {
  const head = table.tHead;
  if (
    !head ||
    head.rows.length !== 1 ||
    !table.tBodies.length ||
    table.querySelector(
      "table, [colspan]:not([colspan='1']), [rowspan]:not([rowspan='1'])",
    ) ||
    table.parentElement?.closest("table")
  )
    return false;
  const count = head.rows[0].cells.length;
  return (
    count > 0 &&
    [...head.rows[0].cells].every((cell) => cell.tagName === "TH") &&
    [...table.tBodies].every((body) =>
      [...body.rows].every((row) => row.cells.length === count),
    )
  );
}

export function decorateSortableTables(fragment) {
  for (const table of fragment.querySelectorAll("table")) {
    if (!sortable(table)) continue;
    for (const header of table.tHead.rows[0].cells) {
      if (header.querySelector(":scope > .table-sort")) continue;
      header.classList.add("sortable-header");
      header.setAttribute("aria-sort", "none");
      const button = header.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "table-sort";
      const label =
        cellText(header).trim().slice(0, 100) ||
        `第 ${header.cellIndex + 1} 列`;
      button.setAttribute("aria-label", `按${label}排序`);
      button.title = "点击切换：升序 → 降序 → 原始顺序";
      button.textContent = "↕";
      header.append(button);
    }
  }
}

export function sortTable(table, column) {
  if (
    !sortable(table) ||
    !Number.isInteger(column) ||
    column < 0 ||
    column >= table.tHead.rows[0].cells.length
  )
    return;
  let state = states.get(table);
  if (!state) {
    state = {
      column: -1,
      direction: "none",
      bodies: [...table.tBodies].map((body) => ({
        body,
        rows: [...body.rows],
      })),
    };
    states.set(table, state);
  }
  // Ignore stale state if another component replaced rows in place.
  if (
    state.bodies.length !== table.tBodies.length ||
    state.bodies.some(
      ({ body, rows }) =>
        rows.length !== body.rows.length ||
        rows.some((row) => row.parentElement !== body),
    )
  ) {
    states.delete(table);
    return sortTable(table, column);
  }
  const direction =
    state.column !== column || state.direction === "none"
      ? "ascending"
      : state.direction === "ascending"
        ? "descending"
        : "none";
  for (const { body, rows } of state.bodies) {
    const order = sortedIndices(
      rows.map((row) => cellText(row.cells[column])),
      direction,
    );
    const fragment = table.ownerDocument.createDocumentFragment();
    for (const index of order) fragment.append(rows[index]);
    body.append(fragment);
  }
  state.column = column;
  state.direction = direction;
  table.dataset.viewSorted = String(direction !== "none");
  for (const header of table.tHead.rows[0].cells) {
    const sort = header.cellIndex === column ? direction : "none";
    header.setAttribute("aria-sort", sort);
    const button = header.querySelector(":scope > .table-sort");
    if (button)
      button.textContent =
        sort === "ascending" ? "↑" : sort === "descending" ? "↓" : "↕";
  }
}

export function wireSortableTables(host) {
  if (wired.has(host)) return;
  wired.add(host);
  // Only the explicit button sorts: header text stays selectable, and a
  // double-click on it keeps the read-to-edit source location gesture.
  host.addEventListener("click", (event) => {
    const button = event.target.closest?.("th.sortable-header > .table-sort");
    if (!button || !host.contains(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const header = button.parentElement;
    sortTable(header.closest("table"), header.cellIndex);
  });
}
