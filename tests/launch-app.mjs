// Every native suite starts Marklore through here, so a suite run on its own
// is an automated run too: its windows open off screen, out of the taskbar and
// without taking the foreground (FOLIO_TEST_INACTIVE), and it makes no tray
// icon unless the suite asks for one (FOLIO_TEST_TRAY). Suites assert Chinese
// interface text whatever the machine's language.
import { _electron as electron } from "@playwright/test";

export function launchApp(options = {}) {
  const env = options.env ?? process.env;
  return electron.launch({
    ...options,
    env: {
      ...env,
      FOLIO_TEST_INACTIVE: "1",
      // A suite may clear it ("") to test the language choice itself.
      FOLIO_LANG: env.FOLIO_LANG ?? "zh",
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });
}
