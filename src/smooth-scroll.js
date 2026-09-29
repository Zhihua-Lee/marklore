// Optional smooth scrolling for the reader (Aa → 阅读导航 → 平滑滚动).
//
// Chromium (and Edge) move the page as input arrives: touchpad deltas about
// every 8 ms and scrollbar drags with each mouse move (~125 Hz), neither
// aligned with the display. On a 60 Hz screen frames then alternate between
// one and two inputs, so the page moves unevenly and text is hard to follow.
// Wheel notches animate one by one, so several in a row pulse. When enabled,
// the reader collects the input and moves once per frame toward the target
// (exponential smoothing), trading a frame or two of latency for an even pace.
//
// "touchpad" smooths precision-touchpad scrolling only; "all" also mouse-wheel
// notches and the scrollbar, which is then drawn by the page (the native one
// is handled inside the browser and cannot be paced). Ctrl (zoom), horizontal
// pans and nested scrollers always keep the native path.
// Touchpad input is dense: exponential smoothing evens it out. Wheel notches
// and scrollbar drags arrive as sparse jumps; a critically damped spring keeps
// the speed continuous across them, so a series of notches merges into one
// even glide instead of pulsing once per notch.
// Tuned with local benchmarks (notches every 90 ms, drags at 125 Hz): the
// wheel glide changes speed between frames less than Chromium's own wheel
// animation, and the drag about 40 times less than the native scrollbar.
const MOTION = {
  touchpad: { spring: false, tau: 34 },
  wheel: { spring: true, tau: 70 },
  scrollbar: { spring: true, tau: 30 },
}; // tau in ms
const THUMB_MIN = 32,
  INSET = 2,
  BAR = 8; // px, the native scrollbar width in style.css

// Windows wheel notches report wheelDelta in multiples of 120; precision
// touchpads send small, arbitrary pixel deltas.
function isNotch(event) {
  const notch = event.wheelDeltaY;
  return Boolean(
    notch && Math.abs(notch) % 120 === 0 && Math.abs(event.deltaY) >= 50,
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

function createSmoother(reader, moved) {
  let frame = 0,
    current = 0,
    target = 0,
    motion = MOTION.touchpad,
    velocity = 0, // px per ms
    last = null,
    placed = null;
  const limit = () => Math.max(0, reader.scrollHeight - reader.clientHeight);
  const clamp = (top) => Math.min(limit(), Math.max(0, top));
  function step(now) {
    frame = 0;
    // Someone else moved the reader meanwhile (a reading-position correction
    // after content grew, a jump): keep the remaining distance, from there.
    if (placed !== null && Math.abs(reader.scrollTop - placed) > 1) {
      const shift = reader.scrollTop - placed;
      current += shift;
      target += shift;
    }
    // The first frame of a gesture counts as one frame: its timestamp (the
    // frame start) precedes the event, so now - last would be negative.
    const dt =
      last === null ? 1000 / 60 : Math.max(0, Math.min(64, now - last));
    last = now;
    target = clamp(target);
    const before = current;
    if (motion.spring) {
      // Exact step of a critically damped spring towards the target.
      const w = 1 / motion.tau,
        e = current - target,
        decay = Math.exp(-w * dt),
        drive = velocity + w * e;
      current = target + (e + drive * dt) * decay;
      velocity = (velocity - w * drive * dt) * decay;
    } else {
      current += (target - current) * (1 - Math.exp(-dt / motion.tau));
      velocity = dt ? (current - before) / dt : 0;
    }
    if (Math.abs(target - current) < 0.25 && Math.abs(velocity) < 0.02) {
      current = target;
      velocity = 0;
    }
    reader.scrollTop = current;
    placed = reader.scrollTop;
    moved();
    if (current !== target) frame = requestAnimationFrame(step);
    else placed = null;
  }
  function start(source) {
    motion = MOTION[source];
    if (frame) return;
    velocity = 0;
    current = target = reader.scrollTop;
    placed = current;
    last = null;
    frame = requestAnimationFrame(step);
  }
  return {
    by(delta, source) {
      start(source);
      target = clamp(target + delta);
    },
    to(top, source) {
      start(source);
      target = clamp(top);
    },
    // Where the reader is heading (the scrollbar thumb follows this).
    get target() {
      return frame ? target : reader.scrollTop;
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      placed = null;
    },
  };
}

// The page-drawn scrollbar for "all": same look as the native one (8 px,
// rounded, darker on hover); dragging and track clicks go through the
// smoother, and the thumb stays under the pointer while the page catches up.
function createScrollbar(reader, smoother) {
  const bar = document.createElement("div"),
    thumb = document.createElement("div");
  bar.className = "reader-scrollbar";
  bar.hidden = true;
  bar.setAttribute("aria-hidden", "true");
  thumb.className = "reader-scrollbar-thumb";
  bar.append(thumb);
  reader.after(bar);
  let enabled = false,
    drag = null,
    frame = 0;
  function geometry() {
    const track = reader.clientHeight - INSET * 2,
      max = reader.scrollHeight - reader.clientHeight;
    if (max <= 0 || track <= THUMB_MIN) return null;
    const length = Math.max(
      THUMB_MIN,
      Math.round((track * reader.clientHeight) / reader.scrollHeight),
    );
    return { max, length, range: track - length };
  }
  function place() {
    frame = 0;
    const g = enabled && reader.getClientRects().length && geometry();
    bar.hidden = !g;
    if (!g) return;
    const box = reader.getBoundingClientRect(),
      parent = bar.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    bar.style.top = box.top - parent.top + reader.clientTop + "px";
    bar.style.left =
      box.left -
      parent.left +
      reader.clientLeft +
      reader.clientWidth -
      BAR +
      "px";
    bar.style.height = reader.clientHeight + "px";
    // Dragging: under the pointer. Otherwise: where the page actually is.
    const top = drag ? drag.to : reader.scrollTop;
    thumb.style.height = g.length + "px";
    thumb.style.transform = `translateY(${INSET + (g.range * Math.min(g.max, Math.max(0, top))) / g.max}px)`;
  }
  const schedule = () => {
    if (enabled && !frame) frame = requestAnimationFrame(place);
  };
  reader.addEventListener("scroll", schedule, { passive: true });
  new ResizeObserver(schedule).observe(reader);
  const content = reader.querySelector("#content");
  if (content) new ResizeObserver(schedule).observe(content);
  window.addEventListener("resize", schedule);
  thumb.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    thumb.setPointerCapture(event.pointerId);
    drag = { y: event.clientY, from: smoother.target, to: smoother.target };
    bar.classList.add("dragging");
  });
  thumb.addEventListener("pointermove", (event) => {
    const g = drag && geometry();
    if (!g) return;
    drag.to = Math.min(
      g.max,
      Math.max(0, drag.from + ((event.clientY - drag.y) * g.max) / g.range),
    );
    smoother.to(drag.to, "scrollbar");
    place();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    thumb.addEventListener(name, () => {
      drag = null;
      bar.classList.remove("dragging");
    });
  // Track click: a page towards the pointer, like the native scrollbar.
  bar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target !== bar) return;
    event.preventDefault();
    const above = event.clientY < thumb.getBoundingClientRect().top ? -1 : 1;
    smoother.by(above * reader.clientHeight * 0.875, "wheel");
  });
  return {
    set(on) {
      enabled = on;
      reader.classList.toggle("own-scrollbar", on);
      if (on) schedule();
      else bar.hidden = true;
    },
    place: schedule,
  };
}

export function createSmoothScroll(reader) {
  let mode = "off";
  let scrollbar = null;
  const smoother = createSmoother(reader, () => scrollbar?.place());
  scrollbar = createScrollbar(reader, smoother);
  // Registered only while enabled: a non-passive wheel listener makes every
  // wheel event wait for the main thread, which is what v0.1.33 removed.
  const onWheel = (event) => {
    if (
      event.defaultPrevented ||
      event.deltaMode !== 0 ||
      event.ctrlKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return;
    const notch = isNotch(event);
    if (notch && mode !== "all") return;
    if (nestedCanScroll(reader, event.target, event.deltaY)) return;
    event.preventDefault();
    smoother.by(event.deltaY, notch ? "wheel" : "touchpad");
  };
  // Clicking into the note or pressing a key takes over at once.
  for (const name of ["pointerdown", "keydown"])
    reader.addEventListener(name, () => smoother.stop(), { passive: true });
  return {
    set(next) {
      next = ["touchpad", "all"].includes(next) ? next : "off";
      if (next === mode) return;
      if (mode === "off")
        reader.addEventListener("wheel", onWheel, { passive: false });
      if (next === "off") {
        reader.removeEventListener("wheel", onWheel);
        smoother.stop();
      }
      mode = next;
      scrollbar.set(mode === "all");
    },
  };
}
