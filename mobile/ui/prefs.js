export const FONT_SIZE_STEPS = [15, 16, 17, 19, 21];

export const DEFAULT_SETTINGS = Object.freeze({
  size: 17,
  theme: "system",
  typeface: "sans",
  keepAwake: false,
});

const FONT_FAMILIES = {
  sans: '-apple-system, "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif',
  serif: '"Songti SC", "Source Han Serif SC", "Noto Serif SC", "STSong", serif',
};

const THEME_COLORS = {
  light: "#f6f5f1",
  dark: "#202523",
};

/**
 * Normalizes persisted settings against valid bounds.
 */
export function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const size = FONT_SIZE_STEPS.includes(Number(input.size))
    ? Number(input.size)
    : DEFAULT_SETTINGS.size;
  const theme =
    input.theme === "light" ||
    input.theme === "dark" ||
    input.theme === "system"
      ? input.theme
      : DEFAULT_SETTINGS.theme;
  const typeface =
    input.typeface === "serif" || input.typeface === "sans"
      ? input.typeface
      : DEFAULT_SETTINGS.typeface;
  return {
    size,
    theme,
    typeface,
    keepAwake: Boolean(input.keepAwake),
  };
}

/**
 * Applies typography & theme tokens on `:root`, including resolved system theme.
 */
export function applySettings(settings) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolvedTheme =
    settings.theme === "system"
      ? prefersDark
        ? "dark"
        : "light"
      : settings.theme;
  root.dataset.theme = resolvedTheme;
  root.style.setProperty("--note-size", `${settings.size}px`);
  root.style.setProperty(
    "--font-note",
    FONT_FAMILIES[settings.typeface] || FONT_FAMILIES.sans,
  );
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = THEME_COLORS[resolvedTheme];
}

/**
 * Manages Screen Wake Lock while reading notes.
 */
export function createWakeLockController() {
  const supported =
    typeof navigator !== "undefined" &&
    "wakeLock" in navigator &&
    typeof navigator.wakeLock?.request === "function";

  let enabled = false;
  let reading = false;
  let sentinel = null;
  let pending = null;

  async function release() {
    if (!sentinel) return;
    const active = sentinel;
    sentinel = null;
    try {
      await active.release();
    } catch {
      // Ignore release errors on already-inactive sentinels.
    }
  }

  async function sync() {
    if (!supported) return;
    if (!enabled || !reading || document.visibilityState !== "visible") {
      await release();
      return;
    }
    if (sentinel || pending) return;
    pending = navigator.wakeLock
      .request("screen")
      .then((lock) => {
        sentinel = lock;
        lock.addEventListener?.("release", () => {
          if (sentinel === lock) sentinel = null;
        });
      })
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
    await pending;
  }

  function handleVisibilityChange() {
    void sync();
  }

  if (supported) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  return {
    supported,
    setState({ keepAwake, inNote }) {
      enabled = Boolean(keepAwake);
      reading = Boolean(inNote);
      void sync();
    },
    destroy() {
      if (supported) {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
      void release();
    },
  };
}
