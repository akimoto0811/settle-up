// Keeps one complete copy of the app on the phone so it opens instantly.
// Each new version (a new CACHE name) is downloaded in full, bypassing any stale copies,
// and replaces the old one in one go. Data sync is handled by Firebase.
const CACHE = "settleup-v20";
const SHELL = ["./", "index.html", "style.css", "app.js", "i18n.js", "firebase-config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
const FIREBASE = /^https:\/\/www\.gstatic\.com\/firebasejs\//;   // versioned, never changes
const FONT_FILES = /^https:\/\/fonts\.gstatic\.com\//;           // versioned, never changes
const FONT_CSS = /^https:\/\/fonts\.googleapis\.com\//;

self.addEventListener("install", e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // cache: "reload" skips the browser's own short-term copies, so every file is the new version
  await Promise.all(SHELL.map(async url => {
    const r = await fetch(new Request(url, { cache: "reload" }));
    if (!r.ok) throw new Error("Couldn't download " + url);
    await cache.put(url, r);
  }));
  await self.skipWaiting();
})()));

self.addEventListener("activate", e => e.waitUntil((async () => {
  const keys = await caches.keys();
  for (const k of keys.filter(k => k.startsWith("settleup-") && k !== CACHE)) {
    // Keep Firebase and font files from the old copy so they don't download again
    const old = await caches.open(k), now = await caches.open(CACHE);
    for (const req of await old.keys()) if (FIREBASE.test(req.url) || FONT_FILES.test(req.url) || FONT_CSS.test(req.url)) {
      const r = await old.match(req); if (r) await now.put(req, r);
    }
    await caches.delete(k);
  }
  await self.clients.claim();
})()));

const cacheFirst = async req => {
  const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && (r.type === "basic" || r.type === "cors")) (await caches.open(CACHE)).put(req, r.clone());
  return r;
};

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (FIREBASE.test(req.url) || FONT_FILES.test(req.url) || FONT_CSS.test(req.url)) return e.respondWith(cacheFirst(req));
  if (url.origin !== location.origin) return;
  // The app's own files: always the complete copy saved with this version
  if (req.mode === "navigate") return e.respondWith(caches.match("index.html").then(r => r || fetch(req)));
  e.respondWith(cacheFirst(req));
});
