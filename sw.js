// Makes the app open instantly: files are served from the phone first and refreshed in the background.
// Data sync is handled by Firebase.
const CACHE = "settleup-v19";
const SHELL = ["./", "index.html", "style.css", "app.js", "i18n.js", "firebase-config.js", "manifest.webmanifest", "icons/icon-192.png"];
const FIREBASE = /^https:\/\/www\.gstatic\.com\/firebasejs\//;   // versioned, never changes
const FONT_FILES = /^https:\/\/fonts\.gstatic\.com\//;           // versioned, never changes
const FONT_CSS = /^https:\/\/fonts\.googleapis\.com\//;

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil((async () => {
  const keys = await caches.keys();
  const hadOld = keys.some(k => k.startsWith("settleup-") && k !== CACHE);
  // Keep the Firebase and font files from the old cache so they don't download again
  for (const k of keys.filter(k => k.startsWith("settleup-") && k !== CACHE)) {
    const old = await caches.open(k), now = await caches.open(CACHE);
    for (const req of await old.keys()) if (FIREBASE.test(req.url) || FONT_FILES.test(req.url) || FONT_CSS.test(req.url)) {
      const r = await old.match(req); if (r) await now.put(req, r);
    }
    await caches.delete(k);
  }
  await self.clients.claim();
  if (hadOld) (await self.clients.matchAll()).forEach(c => c.postMessage({ type: "updated" }));
})()));

const cacheFirst = async req => {
  const hit = await caches.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
  return r;
};
// Answer from the phone straight away; fetch a fresh copy for next time
const staleWhileRevalidate = async (e, req) => {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r }).catch(() => null);
  if (hit) { e.waitUntil(fresh); return hit }
  return (await fresh) || caches.match("index.html");
};

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (FIREBASE.test(req.url) || FONT_FILES.test(req.url)) return e.respondWith(cacheFirst(req));
  if (FONT_CSS.test(req.url)) return e.respondWith(staleWhileRevalidate(e, req));
  if (url.origin === location.origin) return e.respondWith(staleWhileRevalidate(e, req));
});
