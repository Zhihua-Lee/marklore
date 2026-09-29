// Optional smoothing for precision-touchpad scrolling (Aa → 阅读导航).
//
// Chromium (and Edge) apply touchpad deltas as they arrive, about every 8 ms
// and not aligned with the display. On a 60 Hz screen frames then alternate
// between one and two input events, so the page moves unevenly and text is
// hard to follow while it moves. When enabled, the reader takes vertical
// touchpad scrolling over and moves once per frame toward the accumulated
// target (exponential smoothing), trading about two frames of latency for an
// even pace. Mouse-wheel notches, Ctrl (zoom), horizontal pans and nested
// scrollers keep the native path.
const TAU = 34; // ms; the smoothing time constant (~2 frames at 60 Hz)

// Windows wheel notches report wheelDelta in multiples of 120; precision
// touchpads send small, arbitrary pixel deltas.
function fromTouchpad(event) {
  if (event.deltaMode !== 0 || event.ctrlKey) return false;
  const notch = event.wheelDeltaY;
  return !(
    notch &&
    Math.abs(notch) % 120 === 0 &&
    Math.abs(event.deltaY) >= 50
  );
}

// A scroller between the pointer and the reader that can still move this way
// (link preview, overflowing blocks) handles the gesture natively.
function nestedCanScroll(reader, node, dy) {
  for (let el = node; el && el !== reader; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (
      dy < 0
        ? el.scrollTop > 0
        : el.scrollTop + el.clientHeight < el.scrollHeight - 1
    )
      return true;
  }
  return false;
}

export function createSmoothScroll(reader) {
  let enabled = false,
    frame = 0,
    current = 0,
    target = 0,
    last = null,
    placed = null;
  const limit = () => Math.max(0, reader.scrollHeight - reader.clientHeight);
  function step(now) {
    frame = 0;
    // Someone else moved the reader meanwhile (a reading-position correction
    // after content grew, a jump): keep the remaining distance, from there.
    if (placed !== null && Math.abs(reader.scrollTop - placed) > 1) {
      const moved = reader.scrollTop - placed;
      current += moved;
      target += moved;
    }
    // The first frame of a gesture counts as one frame: its timestamp (the
    // frame start) precedes the event, so now - last would be negative.
    const dt =
      last === null ? 1000 / 60 : Math.max(0, Math.min(64, now - last));
    last = now;
    target = Math.min(limit(), Math.max(0, target));
    current += (target - current) * (1 - Math.exp(-dt / TAU));
    if (Math.abs(target - current) < 0.25) current = target;
    reader.scrollTop = current;
    placed = reader.scrollTop;
    if (current !== target) frame = requestAnimationFrame(step);
    else placed = null;
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    placed = null;
  }
  // Registered only while enabled: a non-passive wheel listener makes every
  // wheel event wait for the main thread, which is what v0.1.33 removed.
  const onWheel = (event) => {
    if (
      event.defaultPrevented ||
      !fromTouchpad(event) ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      nestedCanScroll(reader, event.target, event.deltaY)
    )
      return;
    event.preventDefault();
    if (!frame) {
      current = target = reader.scrollTop;
      placed = current;
      last = null;
      frame = requestAnimationFrame(step);
    }
    target += event.deltaY;
  };
  // Grabbing the scrollbar or pressing a key takes over at once.
  for (const name of ["pointerdown", "keydown"])
    reader.addEventListener(name, stop, { passive: true });
  return {
    set(on) {
      on = Boolean(on);
      if (on === enabled) return;
      enabled = on;
      if (on) reader.addEventListener("wheel", onWheel, { passive: false });
      else {
        reader.removeEventListener("wheel", onWheel);
        stop();
      }
    },
  };
}
