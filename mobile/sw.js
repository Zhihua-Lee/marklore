// Offline shell for the phone reader. The build (vite.mobile.config.mjs)
// writes this file with self.PRECACHE (every file of the build and its
// version) in place of the line below, so each build changes sw.js itself:
// browsers look for an update by comparing sw.js, and the HTTP cache of
// imported scripts (GitHub Pages: 10 minutes) cannot hide a new version.
// Notes are not here: they live in IndexedDB. Requests to other origins
// (Microsoft sign-in and OneDrive) are never touched.
/* PRECACHE */

const { version, files } = self.PRECACHE;
const CACHE = "marklore-reader-" + version;
const scope = new URL(self.registration.scope);
const INDEX = new URL("./index.html", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(files.map((f) => new URL(f, scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("marklore-reader-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname))
    return;
  // Page loads (also the return from sign-in with ?code=…) get the shell from
  // the cache, so the reader opens without a connection; a new version is
  // picked up by the service worker update, not here.
  if (request.mode === "navigate") {
    event.respondWith(caches.match(INDEX).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(
    caches.match(request, { ignoreSearch: false }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
