// FILE: public/sw.js
const STATIC_CACHE = "errqr-static-v2";
const STATIC_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest"
  // (optionally add small static assets like icons)
];

// Install: pre-cache offline page & manifest (NOT index.html)
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: require network for navigations; fall back to offline.html
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Page navigations (address bar, link clicks, SPA refresh)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => res) // network-first
        .catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // For other requests (CSS/JS/images), use cache-first as a mild optimization
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Optionally cache small immutable files
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => {
        // As a strict app, we don't provide offline fallbacks for assets
        return new Response("", { status: 504, statusText: "Gateway Timeout" });
      });
    })
  );
});
