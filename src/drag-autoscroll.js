// Scrolling a list while something is dragged over it: near its top or
// bottom edge it scrolls that way, faster the closer the pointer is to the
// edge, and fastest once the pointer is past it (above or below the list,
// or out of the window while a drag started in the list goes on). Dropping,
// ending the drag or coming back to the middle stops it.
//
//   attach(container)  start following drags over it (again: no change)
//   detach(container)  stop
//
// Used by the library tree and the index view. The browser keeps sending
// dragover while the pointer rests, so drop targets under a still pointer
// follow the scrolled list.

// How near an edge (px) scrolling starts, and its speed (px per frame) at
// the edge and once past it.
const EDGE = 48;
const MIN_SPEED = 2;
const MAX_SPEED = 22;

const attached = new WeakMap();

// Speed for a pointer at y (client px) over a box: negative scrolls up.
export function scrollSpeed(y, top, bottom, edge = EDGE) {
  const zone = Math.min(edge, (bottom - top) / 3);
  if (zone <= 0) return 0;
  const near = (distance) => {
    // distance into the zone: 0 at its inner border, zone at the edge,
    // more past the edge (counted up to one more zone).
    const t = Math.min(2, distance / zone);
    const ratio = t <= 1 ? t * t : 1;
    return Math.round(MIN_SPEED + (MAX_SPEED - MIN_SPEED) * ratio);
  };
  if (y < top + zone) return -near(top + zone - y);
  if (y > bottom - zone) return near(y - (bottom - zone));
  return 0;
}

export function attach(container) {
  if (!container || attached.has(container)) return;
  let speed = 0;
  let frame = 0;
  // Whether the drag started in the list (its end then comes as dragend).
  let own = false;
  const step = () => {
    frame = 0;
    if (!speed || !container.isConnected) return;
    const before = container.scrollTop;
    container.scrollTop = before + speed;
    // At the end of the list: nothing more to do until the pointer moves.
    if (container.scrollTop === before) return;
    frame = requestAnimationFrame(step);
  };
  const stop = () => {
    speed = 0;
    own = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const follow = (event) => {
    const box = container.getBoundingClientRect();
    // Beside the list (another panel): not this list's drag.
    if (event.clientX < box.left - EDGE || event.clientX > box.right + EDGE) {
      speed = 0;
      return;
    }
    speed = scrollSpeed(event.clientY, box.top, box.bottom);
    if (speed && !frame) frame = requestAnimationFrame(step);
  };
  const start = (event) => {
    if (container.contains(event.target)) own = true;
  };
  // Leaving the window: a drag from the list goes on scrolling at the speed
  // it had; one from elsewhere (files from Explorer) stops.
  const leave = (event) => {
    if (event.relatedTarget === null && !own) stop();
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
