import { visibleAnchor, restoreAnchor, navigationMoving } from "./positions.js";

const selector = "[data-folio-math]";
function markers(node) {
  return [
    ...(node.matches?.(selector) ? [node] : []),
    ...(node.querySelectorAll?.(selector) || []),
  ];
}

// Only authenticated parser markers reach this helper. The renderer supplies a
// sanitized fragment; neither authored HTML nor TeX is assigned to innerHTML here.
export function createFormulaHydrator(
  formulas,
  render,
  {
    progressive = false,
    budgetMs = 8,
    ready: rendererReady = () => true,
    load = null,
  } = {},
) {
  let host = null,
    scroller = null,
    observer = null,
    timer = null,
    ownerWindow = null;
  const ready = new Set();

  function expand(marker) {
    // Never replace a marker before the math renderer has loaded; activate()
    // retries once it arrives, so the TeX source placeholder is temporary.
    if (!rendererReady()) return false;
    const formula = formulas.get(marker.getAttribute("data-folio-math"));
    if (formula === undefined) return false;
    marker.replaceWith(render(formula));
    return true;
  }
  function hydrate(node) {
    if (!progressive) for (const marker of markers(node)) expand(marker);
  }
  function changed(anchor) {
    if (anchor) restoreAnchor(scroller, anchor);
    host?.dispatchEvent(new Event("folio:math-rendered"));
  }
  function work() {
    timer = null;
    if (!host?.isConnected || !host.getClientRects().length) return;
    // Do not grow content along an outline/link jump's path; expand on arrival.
    if (scroller && navigationMoving(scroller)) {
      timer = setTimeout(work, 100);
      return;
    }
    const anchor = scroller ? visibleAnchor(scroller) : null;
    const start = performance.now();
    let count = 0;
    while (ready.size && count < 32) {
      const marker = ready.values().next().value;
      ready.delete(marker);
      observer?.unobserve(marker);
      if (host.contains(marker) && expand(marker)) count++;
      if (performance.now() - start >= budgetMs) break;
    }
    if (count) changed(anchor);
    if (ready.size) timer = setTimeout(work, 0);
  }
  function flush() {
    if (!host) return;
    clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    ready.clear();
    const anchor = scroller ? visibleAnchor(scroller) : null;
    let count = 0;
    for (const marker of markers(host)) if (expand(marker)) count++;
    if (count) changed(anchor);
  }
  // A jump's destination renders before it scrolls (positions.js), so formulas
  // never pop in on arrival. Only markers inside the requested range expand.
  function prepare(event) {
    if (!host || !rendererReady()) return;
    const { top, bottom } = event.detail;
    const inRange = markers(host).filter((marker) => {
      const rect = marker.getBoundingClientRect();
      return rect.bottom >= top && rect.top <= bottom;
    });
    let count = 0;
    for (const marker of inRange) {
      ready.delete(marker);
      observer?.unobserve(marker);
      if (expand(marker)) count++;
    }
    if (count) changed(null);
  }
  function deactivate() {
    clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
    ready.clear();
    host?.removeEventListener("folio:prepare-content", prepare);
    ownerWindow?.removeEventListener("beforeprint", flush);
    ownerWindow = null;
    host = null;
    scroller = null;
  }
  function activate(container) {
    deactivate();
    host = container;
    ownerWindow = container.ownerDocument.defaultView;
    for (
      let parent = container.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (
        /(auto|scroll)/.test(ownerWindow.getComputedStyle(parent).overflowY)
      ) {
        scroller = parent;
        break;
      }
    }
    // Also picks up unresolved markers in reused leaves or a restored cached tab.
    const pending = markers(container);
    if (!pending.length) return;
    if (!rendererReady() && load) {
      load().then(() => {
        if (host === container) activate(container);
      });
      return;
    }
    if (!progressive || !ownerWindow.IntersectionObserver) {
      flush();
      return;
    }
    observer = new ownerWindow.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) ready.add(entry.target);
          else ready.delete(entry.target);
        }
        if (ready.size && timer === null) timer = setTimeout(work, 0);
      },
      { root: scroller, rootMargin: "600px 0px" },
    );
    for (const marker of pending) observer.observe(marker);
    container.addEventListener("folio:prepare-content", prepare);
    ownerWindow.addEventListener("beforeprint", flush);
  }
  return Object.assign(hydrate, { activate, deactivate, flush });
}
