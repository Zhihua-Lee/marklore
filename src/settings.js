// A fresh object each call: tab groups are mutated in place by the tab bar.
export function defaultSettings() {
  return {
    zoom: 100,
    previewZoom: 100,
    theme: "light",
    sidebar: true,
    split: 50,
    weight: "auto",
    navigationSize: 12,
    tabSize: 11,
    typeface: "literata",
    wide: false,
    tableStyle: "soft",
    tableWidth: "auto",
    tabGroups: [],
    navigationScope: "all",
    showHistoryButtons: false,
    touchpadScroll: "system",
    outline: true,
    librarySide: "left",
    outlineSide: "right",
  };
}

const clamp = (value, min, max, fallback) =>
  Math.max(min, Math.min(max, Number(value) || fallback));

// Stored settings come from older versions or hand edits; coerce every field.
export function normalizeSettings(saved = {}) {
  const settings = { ...defaultSettings(), ...saved };
  // The old automatic sans-serif preset becomes the bundled reading preset.
  // Preserve alternatives explicitly stored by earlier versions.
  if (!settings.typographyVersion && settings.typeface === "balanced")
    settings.typeface = "literata";
  settings.typographyVersion = 1;
  settings.zoom = clamp(settings.zoom, 50, 200, 100);
  settings.previewZoom = clamp(settings.previewZoom, 50, 200, 100);
  settings.typeface = ["literata", "balanced", "classic", "book"].includes(
    settings.typeface,
  )
    ? settings.typeface
    : "literata";
  settings.wide = settings.wide === true;
  settings.tabGroups = Array.isArray(settings.tabGroups)
    ? settings.tabGroups
    : [];
  settings.navigationScope =
    settings.navigationScope === "current" ? "current" : "all";
  settings.showHistoryButtons = settings.showHistoryButtons === true;
  settings.touchpadScroll =
    settings.touchpadScroll === "smooth" ? "smooth" : "system";
  settings.tableStyle = ["soft", "plain", "grid"].includes(settings.tableStyle)
    ? settings.tableStyle
    : "soft";
  settings.tableWidth = settings.tableWidth === "full" ? "full" : "auto";
  settings.navigationSize = clamp(settings.navigationSize, 10, 14, 12);
  settings.tabSize = clamp(settings.tabSize, 10, 13, 11);
  settings.weight = [400, 450, 500, 600].includes(Number(settings.weight))
    ? Number(settings.weight)
    : "auto";
  settings.librarySide = settings.librarySide === "right" ? "right" : "left";
  settings.outlineSide = settings.outlineSide === "left" ? "left" : "right";
  settings.theme = settings.theme === "dark" ? "dark" : "light";
  return settings;
}
