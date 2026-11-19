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
// In idle time a slice draws for as long as the page took since the last one
// ended (mostly the frame that laid the note out and painted it again), up to
// this much. That frame costs about the same however few formulas the slice
// drew: with a fixed 8 ms a slow machine drew one group of 8 per frame, and
// the frames took most of the time (measured on 4,400 formulas: ~550 slices
// at 3x CPU slowdown against ~300 at full speed, 80 s against 10-20 s).
const SLICE_MS = 50;
// Formulas a slice takes from, nearest the reading position first.
const AHEAD = 128;
// Input waiting (a pointer moved, a click, a key) ends a slice after its
// current group, and slices keep to the short budget while a button is held
// (selecting text) and for this long after the last click or key (a mark
// chosen, a menu opened). Long slices made a click or a drag wait for them
// (measured at full speed: half the clicks and drags waited 70-90 ms, against
// 20-30 ms with short slices).
const INPUT_QUIET_MS = 500;
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
    direction = 1,
    // Markers not drawn yet, in page order, and when the last slice ended.
    left = null,
    sliceEnd = 0,
    // The last click or key, and whether a button is held.
    lastInput = 0,
    held = false;
  const ready = new Set();
  const onInput = (event) => {
    lastInput = performance.now();
    held =
      event.type === "pointerdown"
        ? true
        : event.type === "keydown"
          ? held
          : false;
  };
  const inputEvents = ["pointerdown", "pointerup", "pointercancel", "keydown"];
  // Input waiting to be handled, a pointer move included: the move to the
  // text comes before the click on it.
  const inputWaiting = () =>
    ownerWindow?.navigator.scheduling?.isInputPending?.({
      includeContinuous: true,
    }) ?? false;
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
      frame = ownerWindow.requestAnimationFrame(() => onScreen());
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
  // (at least one group), or, with `yieldToInput`, input is waiting. Returns
  // how many were drawn.
  function draw(list, limit, inHost = true, yieldToInput = false) {
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
      if (
        performance.now() - start >= limit ||
        (yieldToInput && inputWaiting())
      )
        break;
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
  // What is on screen now, top to bottom (of `all`, in page order).
  function onScreen(all = null) {
    frame = null;
    if (!host?.isConnected || !scroller || !rendererReady()) return;
    // Hidden (Edit or Source mode): nothing is on screen.
    if (!host.getClientRects().length || navigationMoving(scroller)) return;
    const view = scroller.getBoundingClientRect();
    all ??= markers(host);
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
      performance.now() - lastScroll < 250 ||
      inputWaiting();
    if (busy) {
      // The first slice after scrolling or a jump is a short one.
      sliceEnd = 0;
      return scheduleBackfill();
    }
    const all = undrawn();
    if (!all.length) return;
    const split = atTop()
      ? 0
      : firstBelow(all, scroller.getBoundingClientRect().top);
    const below = all.slice(split, split + AHEAD),
      above = all.slice(Math.max(0, split - AHEAD), split).reverse();
    const list =
      (direction < 0 && above.length) || !below.length ? above : below;
    const anchor = anchorFor(list);
    const now = performance.now(),
      // A release missed (outside the window) holds no longer than 10 s.
      quiet = now - lastInput > (held ? 10000 : INPUT_QUIET_MS);
    const budget = Math.max(
      Math.min(budgetMs, deadline ? deadline.timeRemaining() : budgetMs),
      quiet && sliceEnd ? Math.min(SLICE_MS, now - sliceEnd) : 0,
    );
    if (draw(list, Math.max(2, budget), true, true)) changed(anchor);
    sliceEnd = performance.now();
    if (all.some((marker) => marker.isConnected && !failed.has(marker)))
      scheduleBackfill();
  }
  // Kept between slices: looking the markers up in the page each time went
  // through every drawn formula's elements, a fifth of each slice on a long
  // note. A new note (activate) or new blocks (add) look them up again, and
  // so does an empty list, so none is left behind.
  function undrawn() {
    const keep = (marker) =>
      marker.isConnected && !failed.has(marker) && host.contains(marker);
    left = (left ?? markers(host)).filter(keep);
    if (!left.length) left = markers(host).filter(keep);
    return left;
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
    left = null;
    sliceEnd = 0;
    clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
    ready.clear();
    cancelBackfill();
    if (frame !== null) ownerWindow?.cancelAnimationFrame(frame);
    frame = null;
    scroller?.removeEventListener("scroll", onScroll);
    for (const type of inputEvents)
      ownerWindow?.removeEventListener(type, onInput, true);
    host?.removeEventListener("folio:prepare-content", prepare);
    ownerWindow?.removeEventListener("beforeprint", flush);
    ownerWindow = null;
    host = null;
    scroller = null;
  }
  // `shown`: the note was on the page already and is rendered again in place
  // (an edit, a format). Changed blocks come in as TeX placeholders (hydrate),
  // a whole list or table for one word formatted in it.
  function activate(container, { shown = false } = {}) {
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
    for (const type of inputEvents)
      ownerWindow.addEventListener(type, onInput, {
        capture: true,
        passive: true,
      });
    // The observer reports only after a frame is painted: those on screen
    // are drawn before it, or they would show their source for a moment. A
    // note just opened is shown first and drawn as it comes.
    if (shown) frame = ownerWindow.requestAnimationFrame(() => onScreen());
    scheduleBackfill();
  }
  // Blocks put in the page while it is shown (incremental-render.js), after
  // `hydrate`: their formulas join those drawn as they come near, the ones
  // on screen before the next frame is painted.
  function add(nodes) {
    // Not active, or the renderer still loading: activate() finds them.
    if (!observer || !rendererReady()) return;
    const list = nodes.flatMap(markers).filter((marker) => !failed.has(marker));
    if (!list.length) return;
    left = null;
    for (const marker of list) observer.observe(marker);
    if (frame === null)
      frame = ownerWindow.requestAnimationFrame(() => onScreen(list));
    scheduleBackfill();
  }
  return Object.assign(hydrate, { activate, deactivate, flush, add });
}
