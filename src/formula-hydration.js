import {
  visibleAnchor,
  restoreAnchor,
  navigationMoving,
  isCorrection,
} from "./positions.js";

const selector = "[data-folio-math]";
function markers(node) {
  return [
    ...(node.matches?.(selector) ? [node] : []),
    ...(node.querySelectorAll?.(selector) || []),
  ];
}
// Formulas are drawn a few at a time: each group is sanitized in one pass
// (`warm`), and the time budget is checked between groups.
const GROUP = 8;
// What has come on screen is drawn before that frame is painted, up to this
// much time; the rest follows in the next tasks.
const SCREEN_MS = 24;
const shown = (rect) => rect.width > 0 || rect.height > 0;

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
    warm = null,
  } = {},
) {
  let host = null,
    scroller = null,
    observer = null,
    timer = null,
    ownerWindow = null,
    idle = null,
    frame = null,
    hidden = null,
    lastScroll = 0,
    lastTop = 0,
    direction = 1;
  const ready = new Set();
  // Markers that cannot be drawn (no formula behind them) are not retried.
  const failed = new WeakSet();
  const onScroll = () => {
    if (isCorrection(scroller)) return;
    lastScroll = performance.now();
    const top = scroller.scrollTop,
      jump = Math.abs(top - lastTop) > scroller.clientHeight / 2;
    if (top !== lastTop) direction = top > lastTop ? 1 : -1;
    lastTop = top;
    // Scrolling step by step, formulas ahead were drawn as they came within
    // 600 px; a jump (the scroll bar dragged, Page Down, a scripted move)
    // can land on undrawn ones, drawn then before they are shown.
    if (jump && frame === null && ownerWindow)
      frame = ownerWindow.requestAnimationFrame(onScreen);
  };

  function expand(marker) {
    // Never replace a marker before the math renderer has loaded; activate()
    // retries once it arrives, so the TeX source placeholder is temporary.
    if (!rendererReady()) return false;
    const formula = formulas.get(marker.getAttribute("data-folio-math"));
    if (formula === undefined) {
      failed.add(marker);
      return false;
    }
    marker.replaceWith(render(formula));
    return true;
  }
  // A node about to be put in the page (render-cache.js): all its formulas.
  function hydrate(node) {
    if (!progressive) draw(markers(node), Infinity, false);
  }
  // Draws `list` in order, a group at a time, until `limit` ms have passed
  // (at least one group). Returns how many were drawn.
  function draw(list, limit, inHost = true) {
    const start = performance.now();
    let count = 0;
    for (let at = 0; at < list.length; at += GROUP) {
      const group = [];
      for (const marker of list.slice(at, at + GROUP)) {
        ready.delete(marker);
        observer?.unobserve(marker);
        if (!failed.has(marker) && (!inHost || host?.contains(marker)))
          group.push(marker);
      }
      if (warm && group.length > 1 && rendererReady())
        warm(
          group
            .map((marker) =>
              formulas.get(marker.getAttribute("data-folio-math")),
            )
            .filter(Boolean),
        );
      for (const marker of group) if (expand(marker)) count++;
      if (performance.now() - start >= limit) break;
    }
    return count;
  }
  // The reading position is measured (hit tests) only when a formula about to
  // be drawn lies above the reading line: drawn below it, formulas move
  // nothing that is being read.
  // At the top of the note the top is the reading position, kept as it is
  // without measuring anything.
  const atTop = () => !scroller || scroller.scrollTop < 2;
  function anchorFor(list) {
    if (atTop()) return null;
    const line = scroller.getBoundingClientRect().top + 48;
    for (const marker of list) {
      const rect = marker.getBoundingClientRect();
      if (shown(rect) && rect.top < line) return visibleAnchor(scroller);
    }
    return null;
  }
  function changed(anchor) {
    if (anchor) restoreAnchor(scroller, anchor);
    host?.dispatchEvent(new Event("folio:math-rendered"));
  }
  // Index of the first marker whose box reaches below `y` (markers follow
  // the page from top to bottom; hidden ones, in folded sections, may break
  // the order a little, which only changes what is drawn first and whether
  // the reading position is measured).
  function firstBelow(list, y) {
    let low = 0,
      high = list.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const rect = list[mid].getBoundingClientRect();
      if (shown(rect) && rect.bottom < y) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  // What is on screen now, top to bottom.
  function onScreen() {
    frame = null;
    if (!host?.isConnected || !scroller || !rendererReady()) return;
    if (navigationMoving(scroller)) return;
    const view = scroller.getBoundingClientRect(),
      all = markers(host);
    const list = [];
    for (let i = firstBelow(all, view.top); i < all.length; i++) {
      const rect = all[i].getBoundingClientRect();
      if (!shown(rect)) continue;
      if (rect.top > view.bottom) break;
      if (!failed.has(all[i])) list.push(all[i]);
    }
    if (!list.length) return;
    const anchor = anchorFor(list);
    if (draw(list, SCREEN_MS)) changed(anchor);
  }
  function work() {
    timer = null;
    if (!host?.isConnected || !host.getClientRects().length) return;
    // Do not grow content along an outline/link jump's path; expand on
    // arrival.
    if (scroller && navigationMoving(scroller)) {
      timer = setTimeout(work, 100);
      return;
    }
    const list = [...ready].slice(0, 32);
    const anchor = anchorFor(list);
    if (draw(list, budgetMs)) changed(anchor);
    if (ready.size) timer = setTimeout(work, 0);
  }
  // After the viewport, render the rest of the note in idle time so outline and
  // link jumps glide through finished content instead of placeholders. Slices
  // yield to viewport work, jumps and active scrolling. They go on from the
  // reading position in the direction of the last scroll (formulas drawn below
  // it need no reading position kept), then the other way, nearest first.
  function scheduleBackfill() {
    if (!fillIdle || idle !== null || !ownerWindow) return;
    idle = ownerWindow.requestIdleCallback
      ? ownerWindow.requestIdleCallback(backfill, { timeout: 2000 })
      : ownerWindow.setTimeout(() => backfill(null), 50);
  }
  function cancelBackfill() {
    clearTimeout(hidden);
    hidden = null;
    if (idle === null) return;
    if (ownerWindow?.cancelIdleCallback) ownerWindow.cancelIdleCallback(idle);
    else ownerWindow?.clearTimeout(idle);
    idle = null;
  }
  function backfill(deadline) {
    idle = null;
    if (!host?.isConnected) return;
    // Hidden (Edit or Source mode): go on once the note is shown again, or
    // it would keep undrawn formulas, and no block of it is skipped.
    if (!host.getClientRects().length) {
      clearTimeout(hidden);
      hidden = setTimeout(() => {
        hidden = null;
        scheduleBackfill();
      }, 500);
      return;
    }
    const busy =
      ready.size ||
      timer !== null ||
      frame !== null ||
      (scroller && navigationMoving(scroller)) ||
      performance.now() - lastScroll < 250;
    if (busy) return scheduleBackfill();
    const all = markers(host).filter((marker) => !failed.has(marker));
    if (!all.length) return;
    const split = atTop()
      ? 0
      : firstBelow(all, scroller.getBoundingClientRect().top);
    const below = all.slice(split, split + 32),
      above = all.slice(Math.max(0, split - 32), split).reverse();
    const list =
      (direction < 0 && above.length) || !below.length ? above : below;
    const anchor = anchorFor(list);
    const budget = Math.min(
      budgetMs,
      deadline ? deadline.timeRemaining() : budgetMs,
    );
    if (draw(list, Math.max(2, budget))) changed(anchor);
    if (all.some((marker) => marker.isConnected && !failed.has(marker)))
      scheduleBackfill();
  }
  function flush() {
    if (!host) return;
    clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    ready.clear();
    const anchor = scroller ? visibleAnchor(scroller) : null;
    if (draw(markers(host), Infinity)) changed(anchor);
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
    if (
      draw(
        inRange.map(({ marker }) => marker),
        limit,
      )
    )
      changed(null);
  }
  function deactivate() {
    clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
    ready.clear();
    cancelBackfill();
    if (frame !== null) ownerWindow?.cancelAnimationFrame(frame);
    frame = null;
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
    if (scroller) {
      lastTop = scroller.scrollTop;
      scroller.addEventListener("scroll", onScroll, { passive: true });
    }
    ownerWindow.addEventListener("beforeprint", flush);
    scheduleBackfill();
  }
  return Object.assign(hydrate, { activate, deactivate, flush });
}
