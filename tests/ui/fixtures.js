// Shared window.folio harness for UI specs. Each spec keeps its own behaviour
// (disk, images, links) but wraps it with folioTest.mock(...), which:
// - fills the defaults every spec used to copy (on/ready/read/list/session),
// - mirrors the main process's session semantics (keepDraft references the
//   draft received earlier, exactly as desktop/main.mjs does),
// - rejects methods that desktop/preload.cjs does not expose, so mocks cannot
//   silently drift from the real bridge.
// tests/preload-api.test.mjs keeps FOLIO_API in sync with preload.cjs.
export const FOLIO_API = [
  "ready",
  "pickFiles",
  "pickFolder",
  "pickImage",
  "imageInfo",
  "allowImage",
  "currentFolder",
  "list",
  "search",
  "openChild",
  "read",
  "preview",
  "save",
  "saveAs",
  "link",
  "reveal",
  "session",
  "closeReady",
  "desktopStatus",
  "desktopAction",
  "exportNote",
  "copyText",
  "on",
  "openDroppedFiles",
  "insertImages",
  "recentFiles",
  "openRecent",
  "clearRecent",
  "backlinks",
  "linkStatus",
  "linkTargets",
  "windowState",
  "windowAction",
  "language",
];

function harness(api) {
  const drafts = new Map();
  // Same contract as the "session" handler in desktop/main.mjs.
  function receiveSession(value) {
    const tabs = value.tabs.map(({ keepDraft, ...tab }) => {
      if (keepDraft) {
        const kept = drafts.get(tab.id);
        if (!kept) throw Error("恢复草稿需要重新发送");
        Object.assign(tab, kept);
      }
      return tab;
    });
    drafts.clear();
    for (const tab of tabs)
      if (typeof tab.draft === "string")
        drafts.set(tab.id, {
          draft: tab.draft,
          base: tab.base,
          version: tab.version,
        });
    return { ...value, tabs };
  }
  window.mock ??= {};
  window.mock.handlers ??= {};
  window.folioTest = {
    mock(overrides = {}) {
      const unknown = Object.keys(overrides).filter(
        (name) => !api.includes(name),
      );
      if (unknown.length)
        throw Error(
          "Mocked methods missing from preload.cjs: " + unknown.join(", "),
        );
      const custom = overrides.session;
      return {
        // Specs may replace window.mock wholesale; resolve it at call time.
        on: (name, fn) => ((window.mock.handlers ??= {})[name] = fn),
        ready: async () => ({
          incoming: [],
          restored: [],
          roots: [],
          settings: {},
        }),
        read: async () => ({ unchanged: true }),
        list: async () => [],
        ...overrides,
        // Specs receive what main would persist: complete drafts, never references.
        session: async (value) => {
          const persisted = receiveSession(value);
          window.mock.session = persisted;
          return custom ? custom(persisted) : undefined;
        },
      };
    },
  };
}

export async function installFolio(page) {
  await page.addInitScript(harness, FOLIO_API);
}
