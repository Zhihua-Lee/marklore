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

// The offline shell exists only in a build (precache.js is written then).
if (!mock && import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
