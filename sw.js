// Offline-Speicher für den Bolusrechner.
// Die Versionsnummer kommt aus app.js (APP_VERSION) über "sw.js?v=...".
// Hier muss bei einer neuen Version nichts geändert werden.
const VERSION = new URL(self.location.href).searchParams.get("v") || "0";
const CACHE = "bolusrechner-v" + VERSION;
const FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./storage.js",
  "./bolus-theme.css",
  "./carb-scanner-v3.js",
  "./carb-dialog-v3.html",
  "./app-beispiel-v3.html",
  "./manifest.webmanifest",
  "./icon-180.png?v=4",
  "./icon-192.png?v=4",
  "./icon-512.png?v=4"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Eigene Dateien: erst Netz (für Updates), sonst Offline-Kopie
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => {
        if (r) return r;
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })));
    return;
  }
});
