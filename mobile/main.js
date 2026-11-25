// Entry of the phone reader: picks the back end and mounts the interface.
// `?mock` uses the in-memory sample notebook (development and tests).
import { mountReader } from "./ui/reader.js";

const mock = new URLSearchParams(location.search).has("mock");

const { library, account } = mock
  ? await import("./mock.js").then((m) => m.createMock())
  : await import("./backend.js").then((m) => m.createBackend());

mountReader(document.getElementById("app"), { library, account });
// For tests and troubleshooting from the console.
window.markloreReader = { library, account };

// The offline shell exists only in a build (sw.js is written then).
if (!mock && import.meta.env.PROD && "serviceWorker" in navigator) {
  // A new version took over from an older one (not the first install): load
  // it now rather than on the next launch, after a running sync has finished.
  const updating = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updating) return;
    if (!account.status().syncing) location.reload();
    else
      account.onStatus((s) => {
        if (!s.syncing) location.reload();
      });
  });
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .catch(() => {});
}
