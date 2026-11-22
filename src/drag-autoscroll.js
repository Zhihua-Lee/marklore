// Scrolling a list while something is dragged over it: near its top or
// bottom edge it scrolls that way, faster the closer the pointer is to the
// edge, and fastest once the pointer is past it (above or below the list,
// or out of the window while a drag started in the list goes on). Dropping,
// ending the drag or coming back to the middle stops it.
//
//   attach(container, { edge, maxSpeed })  follow drags over it (again: no
//                                           change); edge in px, maxSpeed
//                                           in px per frame
//   detach(container)                       stop (safe when not attached)
//
// The library tree attaches once; the index view attaches on dragstart and
// detaches on dragend. The browser keeps sending dragover while the pointer
// rests, so drop targets under a still pointer follow the scrolled list.

// How near an edge (px) scrolling starts, and its speed (px per frame) at
// the edge and once past it.
const EDGE = 48;
const MIN_SPEED = 2;
const MAX_SPEED = 22;
// The browser sends dragover every few hundred ms at most while the
// pointer rests: longer without one (in the window), the drag has gone.
const STALE = 600;

const attached = new WeakMap();

// Speed for a pointer at y (client px) over a box: negative scrolls up.
export function scrollSpeed(y, top, bottom, edge = EDGE, maxSpeed = MAX_SPEED) {
  const zone = Math.min(edge, (bottom - top) / 3);
  if (zone <= 0) return 0;
  const near = (distance) => {
    // distance into the zone: 0 at its inner border, zone at the edge,
    // more past the edge (counted up to one more zone).
    const t = Math.min(2, distance / zone);
    const ratio = t <= 1 ? t * t : 1;
    const min = Math.min(MIN_SPEED, maxSpeed);
    return Math.round(min + (maxSpeed - min) * ratio);
  };
  if (y < top + zone) return -near(top + zone - y);
  if (y > bottom - zone) return near(y - (bottom - zone));
  return 0;
}

export function attach(container, { edge = EDGE, maxSpeed = MAX_SPEED } = {}) {
  if (!container || attached.has(container)) return;
  let speed = 0;
  let frame = 0;
  // When the last dragover came, and whether the pointer has left the
  // window since (a drag from the list, still going).
  let seen = 0;
  let outside = false;
  // Whether the drag started in the list (its end then comes as dragend).
  // Attached from that drag's own dragstart: it did.
  const current = typeof window !== "undefined" ? window.event : null;
  let own = Boolean(
    current?.type === "dragstart" && container.contains(current.target),
  );
  const step = () => {
    frame = 0;
    if (!speed || !container.isConnected) return;
    // No dragover for a while with the pointer in the window: the drag
    // ended somewhere without telling (Esc, a drop elsewhere).
    if (!outside && performance.now() - seen > STALE) return (speed = 0);
    const before = container.scrollTop;
    container.scrollTop = before + speed;
    // At the end of the list: nothing more to do until the pointer moves.
    if (container.scrollTop === before) return;
    frame = requestAnimationFrame(step);
  };
  const stop = () => {
    speed = 0;
    own = false;
    outside = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const follow = (event) => {
    const box = container.getBoundingClientRect();
    // Beside the list (another panel): not this list's drag.
    if (event.clientX < box.left - edge || event.clientX > box.right + edge) {
      speed = 0;
      return;
    }
    seen = performance.now();
    outside = false;
    speed = scrollSpeed(event.clientY, box.top, box.bottom, edge, maxSpeed);
    if (speed && !frame) frame = requestAnimationFrame(step);
  };
  const start = (event) => {
    if (container.contains(event.target)) own = true;
  };
  // Leaving the window: a drag from the list goes on scrolling at the speed
  // it had; one from elsewhere (files from Explorer) stops.
  const leave = (event) => {
    if (event.relatedTarget !== null) return;
    if (own) outside = true;
    else stop();
  };
  const handlers = [
    ["dragstart", start],
    ["dragover", follow],
    ["dragleave", leave],
    ["drop", stop],
    ["dragend", stop],
  ];
  for (const [name, fn] of handlers) document.addEventListener(name, fn, true);
  attached.set(container, () => {
    stop();
    for (const [name, fn] of handlers)
      document.removeEventListener(name, fn, true);
  });
}

export function detach(container) {
  const off = attached.get(container);
  if (!off) return;
  attached.delete(container);
  off();
}
