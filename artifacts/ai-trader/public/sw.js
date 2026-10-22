// App-shell service worker. NEVER caches /api — prices, positions and controls
// must always be live; a stale cached P&L or kill-switch state would be dangerous.
const CACHE = "trader-shell-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./manifest.webmanifest", "./icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  if (e.request.mode === "navigate") {
    // Network first so new deploys show immediately; cached shell only when offline.
    e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put("./", r.clone())); return r; }).catch(() => caches.match("./")));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok && /\.(js|css|png|svg|woff2?)$/.test(url.pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});
