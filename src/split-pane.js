// Editor/preview divider: pointer drag and arrow-key resizing between 25% and 75%.
export function wireSplitPane({
  handle,
  panes,
  getSettings,
  capture,
  applySettings,
  restore,
  changed,
}) {
  let resizing = false,
    splitBounds,
    splitFrame = 0,
    pendingSplit;
  // Dragging writes only the split geometry once per frame, not every setting.
  function updateSplit() {
    splitFrame = 0;
    const settings = getSettings();
    if (pendingSplit === undefined || settings.split === pendingSplit) return;
    settings.split = pendingSplit;
    document.documentElement.style.setProperty("--split", settings.split + "%");
    handle.setAttribute("aria-valuenow", String(settings.split));
  }
  handle.onpointerdown = (e) => {
    resizing = true;
    splitBounds = panes.getBoundingClientRect();
    capture();
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove = (e) => {
    if (!resizing) return;
    const r = splitBounds;
    pendingSplit = Math.max(
      25,
      Math.min(75, Math.round(((e.clientX - r.left) / r.width) * 100)),
    );
    if (!splitFrame) splitFrame = requestAnimationFrame(updateSplit);
  };
  handle.onpointerup = handle.onpointercancel = () => {
    resizing = false;
    cancelAnimationFrame(splitFrame);
    updateSplit();
    restore();
    changed();
  };
  handle.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    capture();
    const settings = getSettings();
    settings.split = Math.max(
      25,
      Math.min(75, settings.split + (e.key === "ArrowLeft" ? -5 : 5)),
    );
    applySettings();
    restore();
    changed();
  };
}
