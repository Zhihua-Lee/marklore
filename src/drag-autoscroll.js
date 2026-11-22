// Scrolling a container while something is dragged near its top or bottom
// edge, so places off screen can be reached: faster the closer the pointer
// is to the edge, stopped once the pointer leaves the edge or the drag ends.
//
//   attach(container)  start following the drag (attach on dragstart)
//   detach(container)  stop (also safe when never attached)
//
// The browser keeps firing dragover while the pointer rests (every few
// hundred milliseconds at most), so a pointer held still at the edge keeps
// scrolling; with no dragover for longer than that (dropped elsewhere,
// Esc) the scrolling stops by itself.
const EDGE = 48; // px from the edge where scrolling starts
const MAX_SPEED = 18; // px per frame at the very edge
const STALE = 600; // ms without a dragover: the drag has gone

const attached = new WeakMap();

export function attach(container, { edge = EDGE, maxSpeed = MAX_SPEED } = {}) {
  if (!container || attached.has(container)) return;
  let speed = 0,
    frame = 0,
    seen = 0;
  const step = () => {
    frame = 0;
    if (!speed || performance.now() - seen > STALE) return (speed = 0);
    const before = container.scrollTop;
    container.scrollTop += speed;
    // At the end already: nothing more to scroll.
    if (container.scrollTop === before) return (speed = 0);
    frame = requestAnimationFrame(step);
  };
  const stop = () => {
    speed = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  // Over the whole window: a pointer pushed a little past the edge (onto a
  // toolbar) keeps scrolling at full pace.
  const over = (event) => {
    const box = container.getBoundingClientRect();
    const top = event.clientY - box.top,
      bottom = box.bottom - event.clientY;
    seen = performance.now();
    const reach = Math.min(edge, box.height / 4);
    // Squared: slow near the inner side of the edge, fast at the edge.
    const pace = (d) => Math.ceil(maxSpeed * ((reach - d) / reach) ** 2);
    const across = event.clientX >= box.left && event.clientX <= box.right;
    if (!across || top < -2 * reach || bottom < -2 * reach) speed = 0;
    else if (top < reach) speed = -pace(Math.max(0, top));
    else if (bottom < reach) speed = pace(Math.max(0, bottom));
    else speed = 0;
    if (speed && !frame) frame = requestAnimationFrame(step);
  };
  const listeners = { dragover: over, drop: stop, dragend: stop };
  for (const [type, fn] of Object.entries(listeners))
    document.addEventListener(type, fn, true);
  attached.set(container, () => {
    stop();
    for (const [type, fn] of Object.entries(listeners))
      document.removeEventListener(type, fn, true);
  });
}

export function detach(container) {
  const release = attached.get(container);
  if (!release) return;
  attached.delete(container);
  release();
}
