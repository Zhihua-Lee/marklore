// After heavy work (a long note's render, its formulas, tables and diagrams),
// ask the app to collect what that work left behind once the page has been
// quiet for a while: no long task and no input (main.mjs decides whether it is
// worth it). Chromium would otherwise keep that memory until it runs short.
import { composing } from "./composing.js";

export function releaseWhenQuiet(release, { quiet = 5000 } = {}) {
  if (!release || typeof PerformanceObserver === "undefined") return;
  if (!PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
  let timer = 0,
    lastInput = 0;
  for (const type of ["keydown", "pointerdown", "wheel"])
    addEventListener(type, () => (lastInput = performance.now()), {
      capture: true,
      passive: true,
    });
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (performance.now() - lastInput < quiet || composing())
        return schedule();
      release().catch(() => {});
    }, quiet);
  };
  new PerformanceObserver((list) => {
    if (list.getEntries().some((entry) => entry.duration > 100)) schedule();
  }).observe({ type: "longtask" });
}
