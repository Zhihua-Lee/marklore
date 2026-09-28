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
    backfill: fillIdle = true,
    ready: rendererReady = () => true,
    load = null,
  } = {},
) {
  let host = null,
    scroller = null,
    observer = null,
    timer = null,
    ownerWindow = null,
    idle = null,
    queue = null,
    lastScroll = 0;
  const ready = new Set();
  const onScroll = () => (lastScroll = performance.now());

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
  // After the viewport, render the rest of the note in idle time so outline and
  // link jumps glide through finished content instead of placeholders. Slices
  // yield to viewport work, jumps and active scrolling, and keep the reading
  // position when formulas above it grow.
  function scheduleBackfill() {
    if (!fillIdle || idle !== null || !ownerWindow) return;
    idle = ownerWindow.requestIdleCallback
      ? ownerWindow.requestIdleCallback(backfill, { timeout: 2000 })
      : ownerWindow.setTimeout(() => backfill(null), 50);
  }
  function cancelBackfill() {
    if (idle === null) return;
    if (ownerWindow?.cancelIdleCallback) ownerWindow.cancelIdleCallback(idle);
    else ownerWindow?.clearTimeout(idle);
    idle = null;
  }
  function backfill(deadline) {
    idle = null;
    if (!host?.isConnected || !host.getClientRects().length) return;
    const busy =
      ready.size ||
      timer !== null ||
      (scroller && navigationMoving(scroller)) ||
      performance.now() - lastScroll < 250;
    if (busy) return scheduleBackfill();
    queue ??= markers(host);
    const anchor = scroller ? visibleAnchor(scroller) : null;
    const start = performance.now(),
      budget = Math.min(
        budgetMs,
        deadline ? deadline.timeRemaining() : budgetMs,
      );
    let count = 0;
    while (queue.length && performance.now() - start < Math.max(2, budget)) {
      const marker = queue.shift();
      if (!marker.isConnected) continue;
      observer?.unobserve(marker);
      if (expand(marker)) count++;
    }
    if (count) changed(anchor);
    if (queue.length) scheduleBackfill();
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
    const {
      top,
      bottom,
      target = top,
      budgetMs: limit = Infinity,
    } = event.detail;
    // Nearest the destination first, so a capped pass covers what lands on screen.
    const inRange = markers(host)
      .map((marker) => ({ marker, rect: marker.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom >= top && rect.top <= bottom)
      .sort(
        (a, b) => Math.abs(a.rect.top - target) - Math.abs(b.rect.top - target),
      );
    const start = performance.now();
    let count = 0;
    for (const { marker } of inRange) {
      if (performance.now() - start >= limit) break;
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
    cancelBackfill();
    queue = null;
    scroller?.removeEventListener("scroll", onScroll);
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
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    ownerWindow.addEventListener("beforeprint", flush);
    scheduleBackfill();
  }
  return Object.assign(hydrate, { activate, deactivate, flush });
}
