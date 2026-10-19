const CACHE_NAME = "vital-assess-v1";
const ASSETS = [
  "index.html",
  "vital.html",
  "ecg.html",
  "terms.html",
  "manifest.json",
  "css/style.css",
  "js/icons.js",
  "js/native.js",
  "js/consent.js",
  "js/sw-register.js",
  "js/va-common.js",
  "js/va-home.js",
  "js/va-vital-engine.js",
  "js/va-vital.js",
  "js/va-ecg-engine.js",
  "js/va-ecg.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

// On a slow connection, fall back to the saved copy instead of making the user wait.
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // "reload" skips the browser's HTTP cache, which could otherwise hand back files from the previous version.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("vital-assess-") && k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Network first: online users always get the latest version; the saved copy is used only offline.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const network = fetch(request, { cache: "no-cache" }).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  });
  event.waitUntil(network.catch(() => {}));

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS));

  event.respondWith(
    Promise.race([network, timeout]).catch(() =>
      caches.match(request, { ignoreSearch: true }).then((cached) => cached || network)
    )
  );
});
