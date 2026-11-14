// Automated runs (FOLIO_TEST_INACTIVE) must never put a window in front of
// whoever is using the computer. Every window the app makes opens off every
// display and out of the taskbar, and is moved back there if something (a
// centre, a resize, a restore) brings it onto a display. It is still shown
// (inactive), so it paints and tests can capture, hover and resize it.
export const automated = Boolean(process.env.FOLIO_TEST_INACTIVE);

const away = { x: -20000, y: -20000 };

// Spread into every BrowserWindow's options.
export const automatedWindow = automated ? { ...away, skipTaskbar: true } : {};

const meets = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

// Keeps an automated run's window off every display. A maximised or full
// screen window fills a display by definition; no automated run makes one.
export function keepOffScreen(win, screen) {
  if (!automated) return;
  const check = () => {
    if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
    const bounds = win.getBounds();
    if (
      screen.getAllDisplays().some((display) => meets(bounds, display.bounds))
    )
      win.setPosition(away.x, away.y);
  };
  for (const event of ["move", "resize", "show", "restore"])
    win.on(event, check);
  check();
}
