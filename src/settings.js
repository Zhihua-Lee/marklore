// The user settings' defaults and normalisation live in
// desktop/settings-schema.mjs (no DOM, no Electron), shared with the main
// process and stated as data in tests/vectors/settings.
export {
  DEFAULT_TEMPLATE,
  DURABLE_SETTINGS,
  LEGACY_SETTINGS,
  defaultSettings,
  normalizeSettings,
} from "../desktop/settings-schema.mjs";
