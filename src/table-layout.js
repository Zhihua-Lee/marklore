import { wireSortableTables } from "./table-sort.js";
import { chooseColumnWidths } from "./table-widths.js";
import { visibleAnchor, restoreAnchor, navigationMoving } from "./positions.js";

const cache = new WeakMap();
function clearWidths(table) {
  table.querySelector(":scope > colgroup[data-reading-widths]")?.remove();
  table.classList.remove("reading-columns");
  table.style.removeProperty("--table-min-width");
}
function applyWidths(table, widths) {
  clearWidths(table);
  const group = document.createElement("colgroup"),
    sum = widths.reduce((a, b) => a + b, 0);
  group.dataset.readingWidths = "";
  for (const width of widths) {
    const col = document.createElement("col");
    col.style.width = (width / sum) * 100 + "%";
    group.append(col);
  }
  table.prepend(group);
  table.classList.add("reading-columns");
  table.style.setProperty("--table-min-width", Math.ceil(sum) + "px");
}

export function optimizeTable(table) {
  if (!table.isConnected || !table.getClientRects().length) return false;
  const wrapper = table.closest(".table-scroll"),
    parent = wrapper?.parentElement;
  if (
    !parent ||
    table.querySelector(
      "table, img, pre, details, [data-folio-math], [colspan]:not([colspan='1']), [rowspan]:not([rowspan='1'])",
    )
  )
    return false;
  // Authored HTML column sizing and merged-cell tables keep their native layout.
  if (table.querySelector(":scope > colgroup:not([data-reading-widths])"))
    return false;
  if (
    table.hasAttribute("width") ||
    table.style.width ||
    [...table.querySelectorAll("th,td")].some(
      (cell) =>
        cell.hasAttribute("width") || cell.style.width || cell.style.minWidth,
    )
  )
    return false;
  const rows = [...table.rows],
    count = rows[0]?.cells.length;
  if (!count || count > 12 || rows.some((r) => r.cells.length !== count))
    return false;
  const parentStyle = getComputedStyle(parent),
    style = getComputedStyle(table);
  const available = Math.floor(
    parent.clientWidth -
      parseFloat(parentStyle.paddingLeft) -
      parseFloat(parentStyle.paddingRight) -
      4,
  );
  if (available < 100) return false;
  const signature = [
    available,
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    document.documentElement.dataset.tableStyle,
    document.documentElement.dataset.tableWidth,
  ].join("|");
  if (cache.get(table) === signature) return false;
  cache.set(table, signature);
  const hadWidths = table.classList.contains("reading-columns");
  clearWidths(table);
  // Sample at most 16 cells per column: first/header, longest and evenly spaced
  // rows. The cost is then checked against the actual complete table's height.
  const cells = Array.from({ length: count }, (_, c) => {
    const all = rows.map((r) => r.cells[c]);
    if (all.length <= 16) return all;
    const selected = new Set([
      all[0],
      ...all
        .map((cell) => ({ cell, length: cell.textContent.length }))
        .sort((a, b) => b.length - a.length)
        .slice(0, 7)
        .map(({ cell }) => cell),
    ]);
    for (let i = 0; i < 8; i++)
      selected.add(all[Math.round((i * (all.length - 1)) / 7)]);
    return [...selected];
  });
  if (
    cells.flat().reduce((sum, cell) => sum + cell.textContent.length, 0) > 50000
  )
    return false;
  const nativeHeight = table.getBoundingClientRect().height;
  const nativeWidths = [...rows[0].cells].map((cell) => cell.offsetWidth);
  const probe = document.createElement("table");
  probe.className = "table-measure";
  probe.setAttribute("aria-hidden", "true");
  probe.inert = true;
  probe.style.cssText =
    "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;display:block;width:0;max-width:none;margin:0;";
  const body = document.createElement("tbody"),
    row = document.createElement("tr");
  probe.append(body);
  body.append(row);
  const probes = cells.map((column) =>
    column.map((cell) => {
      const copy = cell.cloneNode(true);
      copy.removeAttribute("id");
      for (const node of copy.querySelectorAll(
        "[id], [data-from], [data-to], [data-block-from], [data-block-to], [data-text-from], [data-text-to]",
      )) {
        node.removeAttribute("id");
        for (const attribute of [...node.attributes])
          if (attribute.name.startsWith("data-"))
            node.removeAttribute(attribute.name);
      }
      for (const attribute of [...copy.attributes])
        if (attribute.name.startsWith("data-"))
          copy.removeAttribute(attribute.name);
      copy.style.cssText =
        "position:absolute;display:block;box-sizing:border-box;min-width:0;max-width:none;white-space:normal;overflow-wrap:normal;word-break:normal;width:max-content;";
      row.append(copy);
      return copy;
    }),
  );
  wrapper.append(probe);
  try {
    const natural = probes.map(
      (column) => Math.max(...column.map((cell) => cell.offsetWidth)) + 2,
    );
    const bases = probes.map((column) =>
      column.map((cell) => cell.offsetHeight),
    );
    for (const cell of probes.flat()) cell.style.width = "min-content";
    const minimum = probes.map(
      (column) => Math.max(...column.map((cell) => cell.offsetWidth)) + 2,
    );
    const minSum = minimum.reduce((a, b) => a + b, 0),
      naturalSum = natural.reduce((a, b) => a + b, 0);
    if (naturalSum <= available) return hadWidths;
    if (minSum > available) {
      applyWidths(table, minimum);
      return true;
    }
    const step = Math.max(4, Math.ceil(available / 128));
    const choices = minimum.map((min, c) => {
      const max = Math.min(natural[c], available - minSum + min);
      return [
        ...new Set(
          [
            min,
            max,
            nativeWidths[c],
            ...Array.from(
              { length: 15 },
              (_, i) => min + ((max - min) * i) / 14,
            ),
          ]
            .map((v) => Math.ceil(v / step) * step)
            .filter((v) => v >= min && v <= available),
        ),
      ].sort((a, b) => a - b);
    });
    const columns = probes.map(() => []);
    for (let i = 0; i < Math.max(...choices.map((list) => list.length)); i++) {
      probes.forEach((column, c) => {
        if (choices[c][i] != null)
          for (const cell of column) cell.style.width = choices[c][i] + "px";
      });
      probes.forEach((column, c) => {
        if (choices[c][i] == null) return;
        const cost = column.reduce((sum, cell, r) => {
          const line = parseFloat(getComputedStyle(cell).lineHeight) || 24;
          return (
            sum +
            Math.max(0, Math.round((cell.offsetHeight - bases[c][r]) / line))
          );
        }, 0);
        columns[c].push({ width: choices[c][i], cost });
      });
    }
    const widths = chooseColumnWidths(columns, available, step);
    if (!widths) return hadWidths;
    applyWidths(table, widths);
    // Do not trade fewer total line breaks for a taller, less readable table.
    if (table.getBoundingClientRect().height > nativeHeight + 2) {
      clearWidths(table);
      return hadWidths;
    }
    return true;
  } finally {
    probe.remove();
  }
}

export function watchTableLayout(host, scroller) {
  wireSortableTables(host);
  let timer,
    idle = null,
    lastScroll = 0,
    measuredWidth = -1;
  // Tables beyond the viewport are sized in idle time, so jumps glide through
  // finished layout. Yields to jumps and active scrolling; keeps the reading line.
  const backfill = (deadline) => {
    idle = null;
    if (!host.getClientRects().length) return;
    if (
      navigationMoving(scroller) ||
      performance.now() - lastScroll < 250 ||
      timer !== null
    )
      return scheduleBackfill();
    const anchor = visibleAnchor(scroller),
      start = performance.now(),
      budget = Math.max(2, Math.min(8, deadline?.timeRemaining() ?? 8));
    let changed = false,
      done = true;
    for (const table of host.querySelectorAll(
      ".table-scroll > table:not(.table-measure)",
    )) {
      if (performance.now() - start >= budget) {
        done = false;
        break;
      }
      changed = optimizeTable(table) || changed;
    }
    if (changed) restoreAnchor(scroller, anchor);
    if (!done) scheduleBackfill();
  };
  const scheduleBackfill = () => {
    if (idle !== null) return;
    idle = window.requestIdleCallback
      ? requestIdleCallback(backfill, { timeout: 3000 })
      : setTimeout(() => backfill(null), 100);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!host.getClientRects().length) return;
      // Measure tables where a jump lands, not the ones it flies past.
      if (navigationMoving(scroller)) {
        schedule();
        return;
      }
      const pending = [
        ...host.querySelectorAll(".table-scroll > table:not(.table-measure)"),
      ];
      let cursor = 0;
      const viewport = scroller.getBoundingClientRect();
      function work() {
        if (cursor >= pending.length || !host.getClientRects().length) return;
        const anchor = visibleAnchor(scroller),
          start = performance.now();
        let changed = false;
        do {
          const table = pending[cursor++];
          if (host.contains(table)) {
            const rect = table.getBoundingClientRect();
            if (
              rect.bottom >= viewport.top - 600 &&
              rect.top <= viewport.bottom + 600
            )
              changed = optimizeTable(table) || changed;
          }
        } while (cursor < pending.length && performance.now() - start < 12);
        if (changed) restoreAnchor(scroller, anchor);
        if (cursor < pending.length) timer = setTimeout(work, 0);
        else {
          timer = null;
          scheduleBackfill();
        }
      }
      work();
    }, 80);
  };
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === measuredWidth) return;
    measuredWidth = width;
    schedule();
  }).observe(host);
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "style",
      "data-typeface",
      "data-table-style",
      "data-table-width",
    ],
  });
  host.addEventListener("folio:math-rendered", schedule);
  // Size tables at a jump's destination before it scrolls (see positions.js).
  host.addEventListener(
    "folio:prepare-layout",
    ({ detail: { top, bottom } }) => {
      for (const table of host.querySelectorAll(
        ".table-scroll > table:not(.table-measure)",
      )) {
        const rect = table.getBoundingClientRect();
        if (rect.bottom >= top && rect.top <= bottom) optimizeTable(table);
      }
    },
  );
  scroller.addEventListener(
    "scroll",
    () => {
      lastScroll = performance.now();
      schedule();
    },
    { passive: true },
  );
  host.addEventListener("toggle", schedule, true);
  host.addEventListener("click", (event) => {
    if (event.target.closest(".fold,.section-rail,.section-summary"))
      schedule();
  });
  document.fonts.ready.then(schedule);
  document.fonts.addEventListener("loadingdone", () => {
    for (const table of host.querySelectorAll("table")) cache.delete(table);
    schedule();
  });
  return schedule;
}
