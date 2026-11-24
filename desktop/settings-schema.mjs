// What Marklore keeps of the owner's choices, and how a stored copy is read
// back: the defaults and the normalisation of every field. Pure, with no
// Node, Electron or DOM: the page (src/settings.js) and the main process can
// both import it, and tests/vectors/settings states the same rules as data.
//
// Two stores, kept apart:
// - The user settings (DURABLE_SETTINGS): the `settings` object of the
//   session file in the data folder, written by the page with each session
//   save and read back through normalizeSettings. The main process reads a
//   few of them from the stored copy (theme and language before the window
//   opens, searchExclude and aiLibraries for the library index and AI
//   access).
// - The desktop preferences (DESKTOP_PREFERENCES): desktop-settings.json in
//   the profile folder, Windows integration the main process owns (tray,
//   other formats, update checks).
// Neither holds a flag of a test run or an experiment: those are
// environment variables and page globals (FLAGS below), never stored.
import { normalizeExcluded } from "./excluded.mjs";

// The properties a new note starts with (Settings → Editing): every line is
// `key: value`, a value may hold {title}, {date}, {time} and {datetime}
// (src/properties.js expands them).
export const DEFAULT_TEMPLATE = "title: {title}\ncreated: {datetime}\ntags: []";

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
    showBreadcrumb: true,
    smoothScroll: "off",
    // Link previews on hover: "hover" (restrained), "ctrl" or "off".
    linkPreview: "hover",
    readingFormat: false,
    editSplit: false,
    richEdit: true,
    typeMarkdown: true,
    // Notes made here (Ctrl+N, New note in a folder) start with the
    // template's properties (Settings → Editing).
    newNoteProperties: false,
    propertyTemplate: DEFAULT_TEMPLATE,
    // Saving a changed note sets the modified time it already has.
    stampModified: false,
    cjkEmphasis: false,
    groupCounts: false,
    exportToc: true,
    outlineAnchors: "referenced",
    language: "auto",
    outline: true,
    librarySide: "left",
    outlineSide: "right",
    searchExclude: [],
    // Library folders an AI may read (Settings → AI assistant).
    aiLibraries: [],
  };
}

// The user settings a normalised copy holds: the defaults' keys, and the
// marker of the typography migration (always 1 once normalised). Keys of
// other names are kept as stored (a later version's settings survive an
// earlier one).
export const DURABLE_SETTINGS = Object.freeze([
  ...Object.keys(defaultSettings()),
  "typographyVersion",
]);
// Stored by earlier versions, read once by normalizeSettings and then left
// out: touchpadScroll (unreleased 0.1.35 builds, becomes smoothScroll) and
// aiTarget (an earlier AI setting, dropped).
export const LEGACY_SETTINGS = Object.freeze(["touchpadScroll", "aiTarget"]);

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
  settings.showBreadcrumb = settings.showBreadcrumb !== false;
  settings.readingFormat = settings.readingFormat === true;
  settings.editSplit = settings.editSplit === true;
  settings.richEdit = settings.richEdit !== false;
  settings.typeMarkdown = settings.typeMarkdown !== false;
  settings.newNoteProperties = settings.newNoteProperties === true;
  settings.stampModified = settings.stampModified === true;
  settings.propertyTemplate =
    typeof settings.propertyTemplate === "string"
      ? settings.propertyTemplate.slice(0, 2000)
      : DEFAULT_TEMPLATE;
  settings.cjkEmphasis = settings.cjkEmphasis === true;
  settings.groupCounts = settings.groupCounts === true;
  settings.exportToc = settings.exportToc !== false;
  settings.outlineAnchors = ["off", "all"].includes(settings.outlineAnchors)
    ? settings.outlineAnchors
    : "referenced";
  // Unreleased 0.1.35 builds stored touchpadScroll: "smooth".
  // The app merges stored values over defaults, so "off" here may be a default.
  if (
    settings.touchpadScroll === "smooth" &&
    !["touchpad", "all"].includes(settings.smoothScroll)
  )
    settings.smoothScroll = "touchpad";
  delete settings.touchpadScroll;
  settings.language = ["zh", "en"].includes(settings.language)
    ? settings.language
    : "auto";
  settings.smoothScroll = ["touchpad", "all"].includes(settings.smoothScroll)
    ? settings.smoothScroll
    : "off";
  settings.tableStyle = ["soft", "plain", "grid"].includes(settings.tableStyle)
    ? settings.tableStyle
    : "soft";
  settings.tableWidth = settings.tableWidth === "full" ? "full" : "auto";
  settings.linkPreview = ["ctrl", "off"].includes(settings.linkPreview)
    ? settings.linkPreview
    : "hover";
  settings.navigationSize = clamp(settings.navigationSize, 10, 14, 12);
  settings.tabSize = clamp(settings.tabSize, 10, 13, 11);
  settings.weight = [400, 450, 500, 600].includes(Number(settings.weight))
    ? Number(settings.weight)
    : "auto";
  settings.librarySide = settings.librarySide === "right" ? "right" : "left";
  settings.outlineSide = settings.outlineSide === "left" ? "left" : "right";
  settings.theme = settings.theme === "dark" ? "dark" : "light";
  settings.searchExclude = normalizeExcluded(settings.searchExclude);
  settings.aiLibraries = normalizeExcluded(settings.aiLibraries);
  delete settings.aiTarget;
  return settings;
}

// desktop-settings.json (desktop/integration.mjs): each a choice that is on
// only when stored as true. Launching at sign-in is not stored here: Windows
// keeps it (app.getLoginItemSettings).
export const DESKTOP_PREFERENCES = Object.freeze([
  "closeToTray",
  "otherFormats",
  "checkUpdates",
]);
export const defaultDesktopPreferences = () =>
  Object.fromEntries(DESKTOP_PREFERENCES.map((key) => [key, false]));
export const normalizeDesktopPreferences = (stored) =>
  Object.fromEntries(
    DESKTOP_PREFERENCES.map((key) => [key, stored?.[key] === true]),
  );

// Switches of test runs, development and experiments: read from the
// environment or set on the page, never stored with the settings above.
export const FLAGS = Object.freeze({
  environment: {
    FOLIO_DATA_DIR: "data folder in place of the profile's (tests, dev)",
    FOLIO_PROFILE_DIR: "profile folder in place of the user's (tests)",
    FOLIO_LANG: "interface language before the stored one (tests, media)",
    FOLIO_TEST_INACTIVE: "windows never activate and stay off-screen (tests)",
    FOLIO_TEST_TRAY: "an automated run that still makes the tray icon",
    FOLIO_NO_RELAUNCH: "no relaunch after a portable-mode change (tests)",
    FOLIO_UPDATE_FEED: "update releases read from a local test feed",
    FOLIO_CLAUDE: "the Claude Code program a background run starts (tests)",
    MARKLORE_INDEX: '"js" forces the JavaScript library index',
    MARKLORE_RUN: "the background run an MCP server serves (set by the app)",
  },
  page: {
    __folioIncremental:
      "window.__folioIncremental = { verify: true } checks each partial render against a whole one",
    // Not a setting of its own: a copy of `language` in the page's storage,
    // so the page starts in it before the session is read.
    "folio-language":
      "localStorage copy of settings.language (src/language.js)",
  },
});
